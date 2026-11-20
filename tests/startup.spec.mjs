import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('loads with no errors or warnings', async ({page}) => {
    const problems = await startGame(page);
    await page.waitForTimeout(300);
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('starts with the core at the origin, centred in its quadrant, and 3 enemies', async ({page}) => {
    await startGame(page);
    const s = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        return {x:c.x, y:c.y, rank:c.rank, hp:c.hp, chunk:hc.GRID.chunkOf(0, 0).join(), enemies:g.piecesOf('enemy').length};
    });
    expect(s).toEqual({x:0, y:0, rank:1, hp:2, chunk:'0,0', enemies:3});
});
