import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

for (const grid of ['hex', 'square']) {
    test(`loads with no errors or warnings (${grid})`, async ({page}) => {
        const problems = await startGame(page, {grid});
        await page.waitForTimeout(300);
        expect(problems.pageErrors).toEqual([]);
        expect(problems.errors).toEqual([]);
        expect(problems.warnings).toEqual([]);
        expect(await page.evaluate(() => hc.GRID.kind)).toBe(grid);
    });
}

test('starts with the core at the origin, centred in its quadrant, and 3 enemies', async ({page}) => {
    await startGame(page);
    const s = await page.evaluate(() => {
        const g = hc.app.game, c = g.playerCore;
        return {x:c.x, y:c.y, rank:c.rank, hp:c.hp, chunk:hc.GRID.chunkOf(0, 0).join(), enemies:g.piecesOf('enemy').length};
    });
    expect(s).toEqual({x:0, y:0, rank:1, hp:2, chunk:'0,0', enemies:3});
});

test('defaults to the hex grid on a first visit', async ({page}) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.hc?.app?.game != null);
    expect(await page.evaluate(() => hc.GRID.kind)).toBe('hex');
});
