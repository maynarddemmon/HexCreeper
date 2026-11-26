import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('the golden path records every cell the core moves to, in order, retraced steps too', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, [a, b] = hc.hex.dirs;
        g.playerAct(g.getPlayerCore(), a[0], a[1]);
        g.playerWait();
        g.playerAct(g.getPlayerCore(), a[0] + b[0], a[1] + b[1]);
        g.playerWait();
        g.playerAct(g.getPlayerCore(), a[0], a[1]);
        return {path:g.corePath, expected:[[0, 0], a, [a[0] + b[0], a[1] + b[1]], a]};
    });
    expect(r.path).toEqual(r.expected);
});

test('the golden path keeps only the core\'s last corePathLength steps; with 0, none', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, [a, b] = hc.hex.dirs, out = [];
        for (const length of [3, 0]) {
            g.rules.corePathLength = length;
            g.corePath = [[0, 0]];
            // Back and forth: a, a + b, a, a + b, a.
            for (const [dx, dy] of [a, b, [-b[0], -b[1]], b, [-b[0], -b[1]]]) {
                const c = g.getPlayerCore();
                g.playerAct(c, c.x + dx, c.y + dy);
                g.playerWait();
            }
            const c = g.getPlayerCore();
            out.push(g.corePath, [c.x, c.y]);
        }
        return {out, ab:[a[0] + b[0], a[1] + b[1]], a};
    });
    const [three, at, none, end] = r.out;
    expect([three, at]).toEqual([[r.ab, r.a, r.ab, r.a], r.a]);
    expect(none).toEqual([end]); // just where the core is
});

test('moving another piece leaves the golden path alone', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [a, b] = hc.hex.dirs;
        g.gold = 100;
        g.playerPlace(a[0], a[1], c);
        g.playerWait();
        const child = g.pieceAt(a[0], a[1]);
        g.playerAct(child, a[0] + b[0], a[1] + b[1]);
        return g.corePath;
    });
    expect(r).toEqual([[0, 0]]);
});
