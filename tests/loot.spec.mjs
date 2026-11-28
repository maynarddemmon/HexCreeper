import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putFixture, setComponentAttrs} from './helpers.mjs';

// The fixtures made when the game is restarted with these tile generator attrs (and a fixed seed).
const fixturesWith = async (page, attrs) => {
    await setComponentAttrs(page, {tile:{healPerQuad:3, harmPerQuad:2, ...attrs}});
    return page.evaluate(() => {
        const g = hc.app.game;
        g.seed = 99;
        g.reset();
        return [...g.fixtures.values()].map(f => ({...f}));
    });
};

// Puts loot you know of, holding value, at (x, y).
const putLoot = (page, x, y, value) => putFixture(page, x, y, 'loot', {pool:value});

test('lootChance turns heals into loot of the lootType kind, their pools rolled from the seed', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        hc.maps.loadIndex(data => hc.fixtures.define({...data.fixtures, test:{type:'loot', name:'Test loot', pool:{min:7, max:9}}}));
    });
    await setComponentAttrs(page, {tile:{lootType:'test'}});
    const none = await fixturesWith(page, {lootChance:0}),
        all = await fixturesWith(page, {lootChance:100});
    expect(none.some(t => t.type === 'loot')).toBe(false);
    expect(all.some(t => t.type === 'heal')).toBe(false);
    const loot = all.filter(t => t.type === 'loot');
    expect(loot.length).toBe(none.filter(t => t.type === 'heal').length);
    expect(loot.every(t => t.subtype === 'test' && t.pool >= 7 && t.pool <= 9)).toBe(true);
    expect(new Set(loot.map(t => t.pool)).size).toBeGreaterThan(1);
    // Loot doesn't move the others: the same cells, heal or loot, and the same harms.
    const cells = list => list.map(t => t.x + ',' + t.y + (t.type === 'harm' ? 'h' : '')).sort();
    expect(cells(all)).toEqual(cells(none));
    
    const some = await fixturesWith(page, {lootChance:50}),
        again = await fixturesWith(page, {lootChance:50});
    expect(again).toEqual(some); // from the seed
});

test('a player piece landing on loot takes it: its gold is yours and the loot is gone', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 1, 0, 25);
    const r = await page.evaluate(() => {
        const g = hc.app.game, before = [g.goldHeld(), g.lootTaken];
        g.playerAct(g.getPlayerCore(), 1, 0);
        return [before, [g.goldHeld(), g.lootTaken], g.fixtures.has('1,0')];
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
        g.setGold(100);
        g.playerPlace(1, 0, g.getPlayerCore());
        return [g.goldHeld(), g.fixtures.has('1,0')];
    });
    expect(r).toEqual([100 - 5 + 12, false]);
});

test('enemies leave loot where it is', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putLoot(page, 6, 0, 10);
    const r = await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 5, 0), gold = g.goldHeld();
        g.moveGroup(e, 1, 0);
        g.landOnFixtures([e]);
        return [e.x, g.fixtures.get('6,0')?.type, g.goldHeld() === gold];
    });
    expect(r).toEqual([6, 'loot', true]);
});

test('loot is saved as it is', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const loot = await putLoot(page, 2, 0, 17);
    const kept = await page.evaluate(() => {
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(hc.app.game.exportToObj())));
        return copy.fixtures.get('2,0');
    });
    expect(kept).toEqual(loot);
    expect(kept.pool).toBe(17);
});

test('opening loot counts toward goals, and the count is saved', async ({page}) => {
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
