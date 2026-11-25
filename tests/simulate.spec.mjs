import {test, expect} from '@playwright/test';
import {startGame, waitForGame} from './helpers.mjs';

test('the combat simulator is only loaded with ?dev', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => typeof hc.simulate)).toBe('undefined');
});

test('the combat simulator plays fights out and sums them up', async ({page}) => {
    await startGame(page);
    await page.goto('/index.html?dev');
    await waitForGame(page);
    await page.waitForFunction(() => typeof hc.simulate === 'function');
    const rows = await page.evaluate(() => new Promise(done => hc.simulate({groups:['goblin', 'goblin_horde'], fights:6, level:4}, done)));
    expect(rows.map(r => [r.name, r.fights, r.wins + r.losses + r.timeouts, r.groups])).toEqual([
        ['goblin', 6, 6, {goblin:6}],
        ['goblin_horde', 6, 6, {goblin_horde:6}]
    ]);
    // A level-4 hero beats a lone goblin, and fights hit and miss both ways.
    expect(rows[0].wins).toBeGreaterThan(3);
    expect(rows[0].dealt).toBeGreaterThan(0);
    expect(rows[1].taken).toBeGreaterThan(rows[0].taken);
    // The game you're playing is left as it was.
    expect(await page.evaluate(() => hc.app.game.piecesOf('player').length)).toBe(1);
});
