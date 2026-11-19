import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

for (const grid of ['hex', 'square']) {
    test.describe(grid, () => {
        test.beforeEach(async ({page}) => {
            await startGame(page, {grid});
            await clearBoard(page);
        });
        
        test('rank needs two children; it sets max HP, moves and place cost', async ({page}) => {
            const r = await page.evaluate(() => {
                const g = hc.app.game, c = g.playerCore, [d0, d1] = [hc.GRID.dirs[0], hc.GRID.dirs[3]];
                g.score = 100;
                const before = {rank:c.rank, hp:c.hp, max:c.maxHp, moves:g.moveLimit(), cost:g.placeCost()};
                g.playerPlace(d0[0], d0[1], c);
                const oneChild = c.rank;
                g.playerPlace(d1[0], d1[1], c);
                return {before, oneChild, after:{rank:c.rank, hp:c.hp, max:c.maxHp, moves:g.moveLimit(), cost:g.placeCost()}, score:g.score};
            });
            expect(r.before).toEqual({rank:1, hp:2, max:2, moves:1, cost:5});
            expect(r.oneChild).toBe(1);
            // Rank 2: max HP 4, but ranking up doesn't add HP.
            expect(r.after).toEqual({rank:2, hp:2, max:4, moves:2, cost:10});
            expect(r.score).toBe(90);
        });
        
        test('moves per turn follow the highest rank of any piece, not the core', async ({page}) => {
            const r = await page.evaluate(() => {
                const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                g.score = 1000;
                g.playerPlace(D[0][0], D[0][1], c);
                const a = g.pieceAt(D[0][0], D[0][1]);
                const free = g.placeSquares().filter(q => hc.cheb(q, a) === 1 && hc.cheb(q, c) > 1);
                g.playerPlace(free[0].x, free[0].y, a);
                g.playerPlace(free[1].x, free[1].y, a);
                return {core:c.rank, child:a.rank, moves:g.moveLimit(), cost:g.placeCost()};
            });
            expect(r).toEqual({core:1, child:2, moves:2, cost:5});
        });
        
        test('each piece moves at most once per turn; new pieces wait a turn', async ({page}) => {
            const r = await page.evaluate(() => {
                const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                g.score = 100;
                g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
                const a = g.pieceAt(D[0][0], D[0][1]);
                const freshCanMove = g.legalMoves(a).length > 0;
                g.playerWait();
                const t = g.turn, m = g.legalMoves(a).find(m => !m.attack);
                const first = g.playerAct(a, m.x, m.y);
                const again = g.legalMoves(a).length;
                return {freshCanMove, first, again, turn:g.turn === t, left:g.movesLeft()};
            });
            expect(r).toEqual({freshCanMove:false, first:true, again:0, turn:true, left:1});
        });
        
        test('destroying a piece destroys everything linked below it and lowers ranks', async ({page}) => {
            const r = await page.evaluate(() => {
                const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                g.score = 1000;
                g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
                const a = g.pieceAt(D[0][0], D[0][1]);
                const kids = g.placeSquares().filter(q => hc.cheb(q, a) === 1 && hc.cheb(q, c) > 1).slice(0, 2);
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
                g.damage(g.playerCore, 99, e);
                return g.over;
            });
            expect(over).toBe(true);
        });
    });
}
