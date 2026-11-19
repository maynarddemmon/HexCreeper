import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('the golden path records every cell the core moves to, in order, retraced steps too', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, [a, b] = hc.GRID.dirs;
        g.playerAct(g.playerCore, a[0], a[1]);
        g.playerWait();
        g.playerAct(g.playerCore, a[0] + b[0], a[1] + b[1]);
        g.playerWait();
        g.playerAct(g.playerCore, a[0], a[1]);
        return {path:g.corePath, expected:[[0, 0], a, [a[0] + b[0], a[1] + b[1]], a]};
    });
    expect(r.path).toEqual(r.expected);
});

test('moving another piece leaves the golden path alone', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.playerCore, [a, b] = hc.GRID.dirs;
        g.score = 100;
        g.playerPlace(a[0], a[1], c);
        g.playerWait();
        const child = g.pieceAt(a[0], a[1]);
        g.playerAct(child, a[0] + b[0], a[1] + b[1]);
        return g.corePath;
    });
    expect(r).toEqual([[0, 0]]);
});

test('a save without a golden path starts one where the core is', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, [a] = hc.GRID.dirs;
        g.playerAct(g.playerCore, a[0], a[1]);
        const data = g.exportToObj();
        delete data.corePath;
        g.importFromObj(data);
        return {path:g.corePath, at:[g.playerCore.x, g.playerCore.y]};
    });
    expect(r.path).toEqual([r.at]);
});
