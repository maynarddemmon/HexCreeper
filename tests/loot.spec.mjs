import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putTile} from './helpers.mjs';

// The tiles made when the game is restarted with these settings (and a fixed seed).
const tilesWith = (page, settings) => page.evaluate(settings => {
    const g = hc.app.game, T = hc.cfg.TILES;
    Object.assign(T, {healPerQuad:3, harmPerQuad:2}, settings);
    g.seed = 99;
    g.reset();
    return [...g.tiles.values()].filter(t => ['heal', 'harm', 'loot'].includes(t.kind)).map(t => ({...t}));
}, settings);

// Puts a loot tile you know of, holding value, at (x, y).
const putLoot = (page, x, y, value) => putTile(page, x, y, 'loot', 'loot', {pool:value});

test('lootChance turns heal tiles into loot tiles of the lootType subtype, their pools rolled from the seed', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        hc.loots.define({test:{name:'Test loot', pool:{min:7, max:9}}});
        hc.cfg.TILES.lootType = 'test';
    });
    const none = await tilesWith(page, {lootChance:0}),
        all = await tilesWith(page, {lootChance:100});
    expect(none.some(t => t.kind === 'loot')).toBe(false);
    expect(all.some(t => t.kind === 'heal')).toBe(false);
    const loot = all.filter(t => t.kind === 'loot');
    expect(loot.length).toBe(none.filter(t => t.kind === 'heal').length);
    expect(loot.every(t => t.subtype === 'test' && t.pool >= 7 && t.pool <= 9)).toBe(true);
    expect(new Set(loot.map(t => t.pool)).size).toBeGreaterThan(1);
    // Loot doesn't move the other tiles: the same cells, heal or loot, and the same harm tiles.
    const cells = list => list.map(t => t.x + ',' + t.y + (t.kind === 'harm' ? 'h' : '')).sort();
    expect(cells(all)).toEqual(cells(none));
    
    const some = await tilesWith(page, {lootChance:50}),
        again = await tilesWith(page, {lootChance:50});
    expect(again).toEqual(some); // from the seed
});

test('a player piece landing on loot takes it: its score is earned and the tile is gone', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 1, 0, 25);
    const r = await page.evaluate(() => {
        const g = hc.app.game, before = [g.score, g.scoreEarned];
        g.playerAct(g.getPlayerCore(), 1, 0);
        return [before, [g.score, g.scoreEarned], g.tiles.has('1,0')];
    });
    expect(r[1]).toEqual([r[0][0] + 25, r[0][1] + 25]);
    expect(r[2]).toBe(false);
});

test('placing a piece on loot takes it too', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 1, 0, 12);
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        g.score = 100;
        g.playerPlace(1, 0, g.getPlayerCore());
        return [g.score, g.tiles.has('1,0')];
    });
    expect(r).toEqual([100 - 5 + 12, false]);
});

test('enemies leave loot where it is', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 6, 0, 10);
    const r = await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 5, 0), score = g.score;
        g.moveGroup(e, 1, 0);
        g.landOnTiles([e]);
        return [e.x, g.tiles.get('6,0')?.kind, g.score === score];
    });
    expect(r).toEqual([6, 'loot', true]);
});

test('loot tiles are saved as they are', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const tile = await putLoot(page, 2, 0, 17);
    const kept = await page.evaluate(() => {
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(hc.app.game.exportToObj())));
        return copy.tiles.get('2,0');
    });
    expect(kept).toEqual(tile);
    expect(kept.pool).toBe(17);
});

test('opening loot tiles counts toward goals, and the count is saved', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 1, 0, 5);
    await putLoot(page, 2, 0, 5);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.gameMap = {...g.gameMap, objectives:hc.goals.fromMap({goals:[{name:'Looter', expression:'lootOpened >= 2', progress:'{lootOpened}/2'}]})};
        g.objectives = [{value:false, locked:false, progress:''}];
        g.playerAct(core, 1, 0);
        const after1 = [g.lootOpened, g.objectives[0].progress, g.outcome];
        g.playerWait();
        g.playerAct(core, 2, 0);
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return [after1, [g.lootOpened, g.objectives[0].progress, g.outcome], copy.lootOpened, [g.lootTaken, copy.lootTaken]];
    });
    expect(r).toEqual([[1, '1/2', null], [2, '2/2', 'won'], 2, [10, 10]]);
});
