import {test, expect} from '@playwright/test';
import {startGame, button, waitForGame} from './helpers.mjs';

const levelsTitle = page => page.getByText('Levels', {exact:true}).filter({visible:true});

test('with no save, the default level from init.json5 is played', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => [hc.app.game.level.id, hc.app.game.level.name, hc.app.game.level.attrs.fog])).toEqual(['endless', 'Endless Play', {pref:true}]);
});

test('the Levels dialog lists every level in init.json5 and marks the one being played', async ({page}) => {
    await startGame(page);
    await button(page, 'Levels').click();
    await expect(levelsTitle(page)).toBeVisible();
    for (const name of ['Endless Play (playing)', '1. Open Ground', '2. The Warrens']) {
        await expect(page.getByText(name, {exact:true}).filter({visible:true})).toBeVisible();
    }
    await expect(button(page, 'Play The Warrens')).toBeVisible();
});

test('playing a level starts a new game with its values in effect, and the save keeps them', async ({page}) => {
    await startGame(page);
    await button(page, 'Levels').click();
    await button(page, 'Play The Warrens').click();
    await page.waitForFunction(() => hc.app.game.level?.id === 'warrens');
    const inWarrens = () => page.evaluate(() => ({
        level:hc.app.game.level.id, turn:hc.app.game.turn,
        wallChance:hc.cfg.TILES.wallChance, quadRadius:hc.GRID.chunkRadius, vision:hc.cfg.VISION.radius
    }));
    expect(await inWarrens()).toEqual({level:'warrens', turn:1, wallChance:90, quadRadius:4, vision:8});
    
    // Saved, then reloaded: the level and its values come back with the game.
    await page.evaluate(() => {hc.app.game.playerWait();});
    await button(page, 'Save').click();
    await button(page, '✓ Confirm').click();
    await button(page, 'Acknowledge').click();
    await page.reload();
    await waitForGame(page);
    expect(await inWarrens()).toEqual({level:'warrens', turn:2, wallChance:90, quadRadius:4, vision:8});
});

test('switching levels mid-game asks first; values the new level doesn\'t set go back', async ({page}) => {
    await startGame(page);
    await button(page, 'Levels').click();
    await button(page, 'Play The Warrens').click();
    await page.waitForFunction(() => hc.app.game.level?.id === 'warrens');
    await page.evaluate(() => {hc.app.game.playerWait();});
    
    await button(page, 'Levels').click();
    await button(page, 'Play Open Ground').click();
    await expect(page.getByText('Abandon this game and start that level?')).toBeVisible();
    await button(page, '✓ Confirm').click();
    await page.waitForFunction(() => hc.app.game.level?.id === 'open_ground');
    expect(await page.evaluate(() => [hc.cfg.TILES.wallChance, hc.cfg.SPAWN.every, hc.cfg.VISION.radius, hc.app.game.turn])).toEqual([0, 2, 12, 1]);
});

test('a level file that can\'t be loaded says so and the game carries on', async ({page}) => {
    await startGame(page);
    await page.route('**/data/levels/open_ground.json5', route => route.fulfill({status:404, body:''}));
    await page.evaluate(() => {hc.app.game.playerWait();});
    await button(page, 'Levels').click();
    await button(page, 'Play Open Ground').click();
    await button(page, '✓ Confirm').click();
    await expect(page.getByText('Level Not Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await page.evaluate(() => [hc.app.game.level.id, hc.app.game.turn])).toEqual(['endless', 2]);
});

const playLevel = async (page, name, id) => {
    await button(page, 'Levels').click();
    await button(page, 'Play ' + name).click();
    await page.waitForFunction(id => hc.app.game.level?.id === id, id);
};

test('Settings shows only what the level shows; the level\'s values are used, and are what Reset goes back to', async ({page}) => {
    await startGame(page);
    await playLevel(page, 'Open Ground', 'open_ground');
    await button(page, 'Settings').click();
    const shown = await page.locator('input[data-setting]').filter({visible:true}).evaluateAll(inputs => inputs.map(i => i.dataset.setting));
    expect(shown.sort()).toEqual(['solidMax', 'spawnEvery', 'visionRadius']);
    await expect(page.getByText('Fog of war', {exact:true}).filter({visible:true})).toHaveCount(0);
    
    const spawn = page.locator('input[data-setting="spawnEvery"]');
    await expect(spawn).toHaveValue('2'); // the level's value
    await spawn.fill('4');
    await spawn.press('Enter');
    expect(await page.evaluate(() => [hc.cfg.SPAWN.every, hc.settings.set('wallChance', 50), hc.cfg.TILES.wallChance])).toEqual([4, undefined, 0]); // not shown: can't be set
    await button(page, 'Reset to Defaults').click();
    await expect(spawn).toHaveValue('2');
});

test('a level that shows nothing says so', async ({page}) => {
    await startGame(page);
    await playLevel(page, 'The Warrens', 'warrens');
    await button(page, 'Settings').click();
    await expect(page.getByText('This level has no settings you can change.')).toBeVisible();
    await expect(button(page, 'Reset to Defaults')).toHaveCount(0);
});

test('changes to settings are kept per level', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {hc.settings.set('spawnEvery', 7);});
    await playLevel(page, 'Open Ground', 'open_ground');
    expect(await page.evaluate(() => hc.cfg.SPAWN.every)).toBe(2);
    await page.evaluate(() => {hc.settings.set('spawnEvery', 5);});
    await playLevel(page, 'Endless Play', 'endless');
    expect(await page.evaluate(() => [hc.cfg.SPAWN.every, JSON.parse(localStorage.getItem('hc.settings'))])).toEqual([7, {endless:{spawnEvery:7}, open_ground:{spawnEvery:5}}]);
});

