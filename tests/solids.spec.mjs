import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, cellOnPage} from './helpers.mjs';

// Puts a solid of the given subtype at (x, y).
const putSolid = (page, x, y, subtype) => page.evaluate(([x, y, subtype]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', subtype));
}, [x, y, subtype]);

test('materials and solid subtypes come from init.json5; a subtype\'s DR is its material\'s hardness', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const s = hc.solids.get('stone_wall');
        return [hc.solids.list().map(t => t.id), s.name, s.composition, s.hp, s.dr, s.material.name, hc.solids.getMaterial('tin').name];
    });
    expect(r).toEqual([
        ['stone_wall', 'boulder', 'sandstone_wall', 'wooden_barricade', 'iron_bars', 'fungus', 'wall_of_flesh'],
        'Stone wall', 'granite', 30, 13, 'granite', 'tin'
    ]);
});

test('a material or subtype that isn\'t usable is left out', async ({page}) => {
    const errors = await startGame(page);
    const ids = await page.evaluate(() => {
        hc.solids.define(
            {rock:{name:'rock', hardness:2}, mush:{name:'mush', hardness:-1}, goo:{hardness:1}},
            {a:{name:'A', composition:'rock', hp:5}, b:{name:'B', composition:'mush', hp:5}, c:{name:'C', composition:'rock', hp:0}, d:{name:'D', composition:'rock', hp:2.5}}
        );
        return [hc.solids.list().map(s => s.id), hc.solids.get('a').dr, !!hc.solids.getMaterial('goo')];
    });
    expect(ids).toEqual([['a'], 2, false]);
    expect(errors.errors.filter(e => /^Bad (material|solid)/.test(e)).length).toBe(5);
});

test('walls and clumps are made of the subtypes the settings choose, with their HP', async ({page}) => {
    await startGame(page);
    const kinds = await page.evaluate(() => {
        const g = hc.app.game, T = hc.cfg.TILES;
        T.wallChance = 100;
        T.wallHoleChance = 0;
        T.solidMin = T.solidMax = 4;
        T.holeMax = 0;
        T.wallSolid = 'iron_bars';
        T.clumpSolid = 'fungus';
        g.reset();
        const solids = [...g.tiles.values()].filter(t => t.kind === 'solid');
        return [...new Set(solids.map(t => t.subtype + ':' + t.hp))].sort();
    });
    expect(kinds).toEqual(['fungus:3', 'iron_bars:15']);
});

test('a piece whose rank beats a solid\'s DR breaks it, a rank less the DR at a time, then advances', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'fungus');   // DR 0, 3 HP
    const hit = () => page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), move = g.legalMoves(core).find(m => m.x === 1 && m.y === 0);
        g.playerAct(core, 1, 0);
        g.acted.clear();
        return [move?.attack, g.tiles.get('1,0')?.hp ?? null, core.x];
    });
    expect(await hit()).toEqual([true, 2, 0]);
    expect(await hit()).toEqual([true, 1, 0]);
    expect(await hit()).toEqual([true, null, 1]); // broken: open floor, and the core moves in
    
    await page.evaluate(() => {hc.app.game.getPlayerCore().rank = 3;});
    await putSolid(page, 2, 0, 'wall_of_flesh'); // DR 0, 6 HP: 3 a hit at rank 3
    expect((await page.evaluate(() => {
        const g = hc.app.game;
        g.playerAct(g.getPlayerCore(), 2, 0);
        return g.tiles.get('2,0').hp;
    }))).toBe(3);
});

test('a solid whose DR is at least the piece\'s rank blocks it, as before', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'wooden_barricade'); // pine: DR 4
    const moves = () => page.evaluate(() => {
        const g = hc.app.game;
        return g.legalMoves(g.getPlayerCore()).some(m => m.x === 1 && m.y === 0);
    });
    expect(await moves()).toBe(false);
    await page.evaluate(() => {hc.app.game.getPlayerCore().rank = 4;});
    expect(await moves()).toBe(false);
    await page.evaluate(() => {hc.app.game.getPlayerCore().rank = 5;});
    expect(await moves()).toBe(true);
});

test('enemies can\'t attack solids', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putSolid(page, 6, 0, 'fungus');
    expect(await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 5, 0);
        return [g.canBreak(e, g.tiles.get('6,0')), g.legalMoves(e).some(m => m.x === 6 && m.y === 0)];
    })).toEqual([false, false]);
});

test('a damaged solid keeps its HP through a save', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'fungus');
    const kept = await page.evaluate(() => {
        const g = hc.app.game;
        g.playerAct(g.getPlayerCore(), 1, 0);
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return copy.tiles.get('1,0');
    });
    expect(kept).toMatchObject({kind:'solid', subtype:'fungus', hp:2});
});

test('pointing at a solid says what it is and how tough', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'stone_wall');
    await page.mouse.move(...await cellOnPage(page, 1, 0));
    await expect(page.getByText('Stone wall (granite) · HP 30/30 · DR 13', {exact:true})).toBeVisible();
});

test('Settings chooses what walls and clumps are made of', async ({page}) => {
    await startGame(page);
    await button(page, 'Settings').click();
    const select = page.locator('select[data-setting="wallSolid"]').filter({visible:true});
    await expect(select).toHaveValue('stone_wall');
    await select.selectOption('wooden_barricade');
    expect(await page.evaluate(() => [hc.cfg.TILES.wallSolid, JSON.parse(localStorage.getItem('hc.settings')).endless.wallSolid])).toEqual(['wooden_barricade', 'wooden_barricade']);
    expect(await page.locator('select[data-setting="clumpSolid"]').filter({visible:true}).locator('option').allTextContents()).toEqual(
        ['Stone wall', 'Boulder', 'Sandstone wall', 'Wooden barricade', 'Iron bars', 'Fungus', 'Wall of flesh']
    );
});
