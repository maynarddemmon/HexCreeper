import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

// The tiles made when the game is restarted with these settings (and a fixed seed).
const tilesWith = (page, settings) => page.evaluate(settings => {
    const g = hc.app.game, T = hc.cfg.TILES;
    Object.assign(T, {healPerQuad:3, harmPerQuad:2}, settings);
    g.seed = 99;
    g.reset();
    return [...g.tiles.values()].filter(t => ['heal', 'harm', 'loot'].includes(t.kind)).map(t => ({...t}));
}, settings);

// Puts an active loot tile worth value at (x, y).
const putLoot = (page, x, y, value) => page.evaluate(([x, y, value]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), {x, y, kind:'loot', timer:0, value});
}, [x, y, value]);

test('lootChance turns heal tiles into loot tiles, active at once, worth lootMin to lootMax', async ({page}) => {
    await startGame(page);
    const none = await tilesWith(page, {lootChance:0}),
        all = await tilesWith(page, {lootChance:100, lootMin:7, lootMax:9});
    expect(none.some(t => t.kind === 'loot')).toBe(false);
    expect(all.some(t => t.kind === 'heal')).toBe(false);
    const loot = all.filter(t => t.kind === 'loot');
    expect(loot.length).toBe(none.filter(t => t.kind === 'heal').length);
    expect(loot.every(t => t.timer === 0 && t.value >= 7 && t.value <= 9)).toBe(true);
    expect(new Set(loot.map(t => t.value)).size).toBeGreaterThan(1);
    // Loot doesn't move the other tiles: the same cells, heal or loot, and the same harm tiles.
    const cells = list => list.map(t => t.x + ',' + t.y + (t.kind === 'harm' ? 'h' : '')).sort();
    expect(cells(all)).toEqual(cells(none));
    
    const some = await tilesWith(page, {lootChance:50, lootMin:7, lootMax:9}),
        again = await tilesWith(page, {lootChance:50, lootMin:7, lootMax:9});
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

test('loot tiles are saved with their value', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 2, 0, 17);
    const kept = await page.evaluate(() => {
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(hc.app.game.exportToObj())));
        return copy.tiles.get('2,0');
    });
    expect(kept).toEqual({x:2, y:0, kind:'loot', timer:0, value:17});
});
