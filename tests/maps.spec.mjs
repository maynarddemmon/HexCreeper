import {test, expect} from '@playwright/test';
import {startGame, button, waitForGame} from './helpers.mjs';

const mapsTitle = page => page.getByText('Maps', {exact:true}).filter({visible:true});

test('with no save, the default map from init.json5 is played', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => [hc.app.game.gameMap.id, hc.app.game.gameMap.name, hc.app.game.gameMap.attrs])).toEqual(['endless', 'Endless Play', {}]);
});

test('the Maps dialog lists every map in init.json5 and marks the one being played', async ({page}) => {
    await startGame(page);
    await button(page, 'Maps').click();
    await expect(mapsTitle(page)).toBeVisible();
    for (const name of ['Endless Play (playing)', '1. Open Ground', '2. The Warrens']) {
        await expect(page.getByText(name, {exact:true}).filter({visible:true})).toBeVisible();
    }
    // Each map's name is the button that plays it; there's no separate Play button.
    await expect(button(page, 'Play The Warrens')).toHaveText('2. The Warrens');
    await expect(page.getByRole('button', {name:'Play', exact:true}).filter({visible:true})).toHaveCount(0);
});

test('playing a map starts a new game with its values in effect, and the save keeps them', async ({page}) => {
    await startGame(page);
    await button(page, 'Maps').click();
    await button(page, 'Play The Warrens').click();
    await button(page, '✓ Start').click();
    await page.waitForFunction(() => hc.app.game.gameMap?.id === 'warrens');
    const seed = await page.evaluate(() => hc.app.game.seed);
    const inWarrens = () => page.evaluate(() => ({
        gameMap:hc.app.game.gameMap.id, turn:hc.app.game.turn, seed:hc.app.game.seed,
        wallChance:hc.cfg.TILES.wallChance, quadRadius:hc.GRID.chunkRadius, vision:hc.cfg.VISION.radius
    }));
    expect(await inWarrens()).toEqual({gameMap:'warrens', turn:1, seed, wallChance:90, quadRadius:4, vision:8});
    
    // Saved, then reloaded: the map and its values come back with the game.
    await page.evaluate(() => {hc.app.game.playerWait();});
    await button(page, 'Save').click();
    await button(page, '✓ Confirm').click();
    await button(page, 'Acknowledge').click();
    await page.reload();
    await waitForGame(page);
    expect(await inWarrens()).toEqual({gameMap:'warrens', turn:2, seed, wallChance:90, quadRadius:4, vision:8});
});

const seedInput = page => page.getByRole('textbox', {name:'Seed', exact:true}).filter({visible:true}),
    // The map as made so far: tiles, and where the enemies are.
    mapOf = page => page.evaluate(() => {
        const g = hc.app.game;
        return {tiles:[...g.tiles].sort(), enemies:g.piecesOf('enemy').map(e => e.x + ',' + e.y).sort()};
    });

test('the brief shows the map\'s description and a seed (no settings), and starts with them', async ({page}) => {
    await startGame(page);
    await button(page, 'Maps').click();
    await button(page, 'Play Open Ground').click();
    await expect(page.getByText('1. Open Ground', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.getByText('Wide open country with nowhere to hide, and the enemy comes often.').filter({visible:true})).toBeVisible();
    await expect(page.locator('[data-setting]').filter({visible:true})).toHaveCount(0);
    await expect(seedInput(page)).toHaveValue(/^\d+$/);
    
    await seedInput(page).fill('1234');
    await button(page, '✓ Start').click();
    await page.waitForFunction(() => hc.app.game.gameMap?.id === 'open_ground');
    expect(await page.evaluate(() => [hc.app.game.seed, hc.cfg.SPAWN.every])).toEqual([1234, 2]);
    await expect(page.getByText('1234', {exact:true}).filter({visible:true})).toBeVisible(); // the info panel
});

test('the same seed makes the same map; an empty seed makes a random one', async ({page}) => {
    await startGame(page);
    const play = async seed => {
        await button(page, 'New game').click();
        await seedInput(page).fill(seed);
        await button(page, '✓ Start').click();
        return mapOf(page);
    };
    const first = await play('42');
    expect(first.tiles.length).toBeGreaterThan(0);
    expect(await play('42')).toEqual(first);
    expect(await play('43')).not.toEqual(first);
    await play('');
    expect(await page.evaluate(() => Number.isInteger(hc.app.game.seed))).toBe(true);
});

test('a map\'s own seed fills in the brief', async ({page}) => {
    await page.route('**/data/gamemap/warrens.json5', route => route.fulfill({status:200, body:'{"seed":777, "attrs":{}}'}));
    await startGame(page);
    await button(page, 'Maps').click();
    await button(page, 'Play The Warrens').click();
    await expect(seedInput(page)).toHaveValue('777');
});

test('cancelling the brief keeps the game, and its map\'s values', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {hc.app.game.playerWait();});
    const before = await page.evaluate(() => [hc.app.game.gameMap.id, hc.app.game.seed, hc.app.game.turn, hc.cfg.TILES.wallChance]);
    await button(page, 'Maps').click();
    await button(page, 'Play The Warrens').click();
    await expect(seedInput(page)).toBeVisible();
    expect(await page.evaluate(() => hc.cfg.TILES.wallChance)).toBe(90); // the brief's map, while it's open
    await button(page, '✗ Cancel').click();
    expect(await page.evaluate(() => [hc.app.game.gameMap.id, hc.app.game.seed, hc.app.game.turn, hc.cfg.TILES.wallChance])).toEqual(before);
});

test('switching maps mid-game warns in the brief; values the new map doesn\'t set go back', async ({page}) => {
    await startGame(page);
    await button(page, 'Maps').click();
    await button(page, 'Play The Warrens').click();
    await button(page, '✓ Start').click();
    await page.waitForFunction(() => hc.app.game.gameMap?.id === 'warrens');
    await page.evaluate(() => {hc.app.game.playerWait();});
    
    await button(page, 'Maps').click();
    await button(page, 'Play Open Ground').click();
    await expect(page.getByText('Starting abandons the game in progress.')).toBeVisible();
    await button(page, '✓ Start').click();
    await page.waitForFunction(() => hc.app.game.gameMap?.id === 'open_ground');
    expect(await page.evaluate(() => [hc.cfg.TILES.wallChance, hc.cfg.SPAWN.every, hc.cfg.VISION.radius, hc.app.game.turn])).toEqual([0, 2, 12, 1]);
});

test('a map file that can\'t be loaded says so and the game carries on', async ({page}) => {
    await startGame(page);
    await page.route('**/data/gamemap/open_ground.json5', route => route.fulfill({status:404, body:''}));
    await page.evaluate(() => {hc.app.game.playerWait();});
    await button(page, 'Maps').click();
    await button(page, 'Play Open Ground').click();
    await expect(page.getByText('Map Not Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await page.evaluate(() => [hc.app.game.gameMap.id, hc.app.game.turn])).toEqual(['endless', 2]);
});

const playMap = async (page, name, id) => {
    await button(page, 'Maps').click();
    await button(page, 'Play ' + name).click();
    await button(page, '✓ Start').click();
    await page.waitForFunction(id => hc.app.game.gameMap?.id === id, id);
};

test('Settings shows only the preferences, whatever the map', async ({page}) => {
    await startGame(page);
    await playMap(page, 'Open Ground', 'open_ground');
    await button(page, 'Settings').click();
    await expect(page.getByText('Animate pieces', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.locator('[data-setting]').filter({visible:true})).toHaveCount(0); // no number or choice rows
    await expect(page.getByText('Fog of war', {exact:true}).filter({visible:true})).toHaveCount(0);
    await expect(button(page, 'Reset to Defaults')).toHaveCount(0);
});

test('a map\'s attrs are rounded and clamped, those it can\'t use are skipped, and the rest are at their defaults', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const clean = hc.settings.applyMap({linkRange:99, spawnEvery:2.4, advance:'yes', fog:false, nonsense:1});
        return [clean, hc.cfg.LINK.range, hc.cfg.SPAWN.every, hc.cfg.COMBAT.advance, hc.cfg.TILES.wallChance];
    })).toEqual([{linkRange:20, spawnEvery:2}, 20, 2, true, 50]);
});

