import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  Builds a row of three player pieces (left child, core, right child) and moves to the next
    turn so they can all act. Returns the direction perpendicular to the row as [dx, dy]. */
const setupRow = page => page.evaluate(() => {
    const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
    // Pick a direction pair (d, -d) for the row and a "forward" direction not along it.
    const row = D.find(([dx, dy]) => dx === 1 && dy === 0);
    const fwd = D.find(([dx, dy]) => dy === -1 && dx === 1);
    g.score = 100;
    g.playerPlace(row[0], row[1], c); g.playerPlace(-row[0], -row[1], c);
    g.playerWait();
    return fwd;
});

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('a group attack hits with every member in line; n kills score n squared', async ({page}) => {
    const fwd = await setupRow(page);
    const r = await page.evaluate(fwd => {
        const g = hc.app.game, c = g.getPlayerCore();
        for (const p of g.piecesOf('player')) g.addPiece('core', 'enemy', p.x + fwd[0], p.y + fwd[1]);
        hc.app.game.rules.advance = false;
        const s0 = g.score, m = g.findMove(c, c.x + fwd[0], c.y + fwd[1]);
        g.playerAct(c, m.x, m.y);
        return {hits:m.hits.length, gained:g.score - s0, left:g.piecesOf('enemy').length, moved:c.x !== 0 || c.y !== 0};
    }, fwd);
    expect(r).toEqual({hits:3, gained:9, left:0, moved:false});
});

test('killing a squad leader destroys the squad and every piece counts toward the combo', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs, d = D[0];
        hc.app.game.rules.advance = false;
        const lead = g.addPiece('core', 'enemy', d[0], d[1]);
        const far = D.map(([dx, dy]) => ({x:lead.x + dx, y:lead.y + dy})).filter(q => hc.hexDist(q, c) > 1 && !g.pieceAt(q.x, q.y));
        g.addPiece('core', 'enemy', far[0].x, far[0].y, lead.id);
        g.addPiece('core', 'enemy', far[1].x, far[1].y, lead.id);
        g.recomputeRanks();
        lead.hp = 1;
        const s0 = g.score;
        g.playerAct(c, lead.x, lead.y);
        return {gained:g.score - s0, left:g.piecesOf('enemy').length};
    });
    expect(r).toEqual({gained:9, left:0});
});

test('after a kill the attacker advances, unless that would land on harm', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1];
        hc.app.game.rules.advance = true;
        g.addPiece('core', 'enemy', d[0], d[1]);
        g.playerAct(c, d[0], d[1]);
        const advanced = c.x === d[0] && c.y === d[1];
        g.playerWait();
        const tx = c.x + d[0], ty = c.y + d[1];
        g.addPiece('core', 'enemy', tx, ty);
        g.tiles.set(g.key(tx, ty), {...g.makeTile(tx, ty, 'harm', 'harm'), revealedAt:g.turn});
        const hp = c.hp;
        g.playerAct(c, tx, ty);
        return {advanced, stayed:c.x === d[0] && c.y === d[1], hp:c.hp === hp};
    });
    expect(r).toEqual({advanced:true, stayed:true, hp:true});
});

test('with advance off, the attacker stays put', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1];
        hc.app.game.rules.advance = false;
        g.addPiece('core', 'enemy', d[0], d[1]);
        g.playerAct(c, d[0], d[1]);
        return [c.x, c.y];
    });
    expect(r).toEqual([0, 0]);
});

test('moving a parent carries its subtree, keeping its shape', async ({page}) => {
    const fwd = await setupRow(page);
    const r = await page.evaluate(fwd => {
        const g = hc.app.game, c = g.getPlayerCore();
        const shape = () => g.piecesOf('player').map(p => [p.x - c.x, p.y - c.y].join()).sort().join('|');
        const before = shape();
        g.playerAct(c, c.x + fwd[0], c.y + fwd[1]);
        return {same:shape() === before, moved:c.x === fwd[0] && c.y === fwd[1]};
    }, fwd);
    expect(r).toEqual({same:true, moved:true});
});

test('a linked piece must stay within link range of its parent', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1];
        g.score = 100; g.playerPlace(d[0], d[1], c);
        const a = g.pieceAt(d[0], d[1]);
        let steps = 0;
        for (let t = 0; t < 6; t++) {
            g.playerWait();
            if (!g.playerAct(a, a.x + d[0], a.y + d[1])) break;
            steps++;
        }
        return {dist:hc.hexDist(a, c), steps, range:hc.app.game.rules.linkRange};
    });
    // It starts 1 step away, so it can take (range - 1) steps outward and no more.
    expect(r).toEqual({dist:r.range, steps:r.range - 1, range:3});
});

test('score earned is kept as a total; spending only lowers what you have', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [a, b] = hc.hex.dirs;
        g.addPiece('core', 'enemy', a[0], a[1]);
        g.playerAct(c, a[0], a[1]);           // a kill: +1
        const afterKill = [g.score, g.scoreEarned];
        g.score += 10; g.scoreEarned += 10;   // as if earned elsewhere
        g.playerWait();
        g.playerPlace(c.x + b[0], c.y + b[1], c); // costs 5
        return {afterKill, afterPlace:[g.score, g.scoreEarned]};
    });
    expect(r).toEqual({afterKill:[1, 1], afterPlace:[6, 11]});
});

