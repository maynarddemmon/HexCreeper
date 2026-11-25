import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('rank needs two children; it sets neither max HP (level does) nor action points', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [d0, d1] = [hc.hex.dirs[0], hc.hex.dirs[3]];
        g.score = 100;
        const before = {rank:c.rank, hp:c.hp, max:c.maxHp, pool:g.apMax(c), cost:g.placeCost()};
        g.playerPlace(d0[0], d0[1], c);
        const oneChild = c.rank;
        g.playerPlace(d1[0], d1[1], c);
        return {before, oneChild, after:{rank:c.rank, hp:c.hp, max:c.maxHp, pool:g.apMax(c), cost:g.placeCost()}, score:g.score};
    });
    expect(r.before).toEqual({rank:1, hp:2, max:2, pool:100, cost:5});
    expect(r.oneChild).toBe(1);
    // Rank 2, but the same max HP and pool. Place cost follows the 3 pieces' levels.
    expect(r.after).toEqual({rank:2, hp:2, max:2, pool:100, cost:6});
    expect(r.score).toBe(90);
});

test('placing costs 4, plus 1 for every 2 of your pieces (rounded up), whatever their ranks', async ({page}) => {
    const costs = await page.evaluate(() => {
        const g = hc.app.game, out = [g.placeCost()];
        g.score = 1000;
        for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1]]) {
            g.playerPlace(x, y, g.getPlayerCore());
            out.push(g.placeCost());
        }
        g.playerWait();
        g.playerDetach(g.pieceAt(1, 0));       // detaching changes ranks, not the cost
        out.push(g.getPlayerCore().rank, g.placeCost());
        return out;
    });
    expect(costs).toEqual([5, 5, 6, 6, 7, 7, 2, 7]);
});

test('a piece acts while it has the action points (here, once a turn); new pieces start with none', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
        g.score = 100;
        g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
        const a = g.pieceAt(D[0][0], D[0][1]);
        const freshCanMove = g.legalMoves(a).length > 0;
        g.playerWait();
        const t = g.turn, m = g.legalMoves(a).find(m => !m.attack);
        const first = g.playerAct(a, m.x, m.y);
        const again = g.legalMoves(a).length;
        return {freshCanMove, first, again, turn:g.turn === t, ap:a.ap, core:g.canMove(c)};
    });
    expect(r).toEqual({freshCanMove:false, first:true, again:0, turn:true, ap:0, core:true});
});

test('destroying a piece destroys everything linked below it and lowers ranks', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
        g.score = 1000;
        g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
        const a = g.pieceAt(D[0][0], D[0][1]);
        const kids = g.placeCells().filter(q => hc.hexDist(q, a) === 1 && hc.hexDist(q, c) > 1).slice(0, 2);
        for (const q of kids) g.playerPlace(q.x, q.y, a);
        const before = {pieces:g.piecesOf('player').length, core:c.rank};
        const e = g.addPiece('core', 'enemy', 50, 50);
        const lost = g.damage(a, 99, e);
        return {before, lost:lost.length, after:{pieces:g.piecesOf('player').length, core:c.rank, max:c.maxHp}};
    });
    expect(r.before).toEqual({pieces:5, core:2});
    expect(r.lost).toBe(3);
    expect(r.after).toEqual({pieces:2, core:1, max:2});
});

test('losing the core ends the game', async ({page}) => {
    const over = await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        return g.over;
    });
    expect(over).toBe(true);
});
