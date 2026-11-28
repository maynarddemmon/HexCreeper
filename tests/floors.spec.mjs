import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putFixture, cellOnPage} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

// Mud costs 2 here, whatever init.json5 says.
const mudCosts2 = page => page.evaluate(() => {
    hc.floors.get('mud').moveCost = 2;
});

// Floor tiles of kind subtype at the cells given, [[x, y], ...]
const putFloors = (page, subtype, cells) => page.evaluate(([subtype, cells]) => {
    const g = hc.app.game;
    for (const [x, y] of cells) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'floor', subtype));
}, [subtype, cells]);

test('floor kinds come from init.json5, with a moveCost; bad ones are refused', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    expect(await page.evaluate(() => hc.floors.list().map(f => [f.id, f.moveCost]))).toEqual([
        ['stone_floor', 1], ['cave_floor', 1], ['dirt_floor', 1], ['frozen_floor', 1], ['loose_stone', 1.5], ['mud', 1.75], ['ice', 1.5], ['stream', 1.5], ['stream_frozen', 1.5], ['pool', 2]
    ]);
    expect(await page.evaluate(() => {
        hc.floors.define({ok:{name:'Ok'}, free:{name:'Free', moveCost:0}, odd:{name:'Odd', moveCost:'lots'}});
        const out = hc.floors.list().map(f => [f.id, f.moveCost]);
        return new Promise(done => hc.maps.loadIndex(data => {
            hc.floors.define(data.floors);
            done(out);
        }));
    })).toEqual([['ok', 1]]);
    expect(errors.filter(e => /^Bad floor/.test(e)).sort()).toEqual(['Bad floor free', 'Bad floor odd']);
});

test('a floor blocks neither sight nor movement, and a fixture can sit on it', async ({page}) => {
    await putFloors(page, 'mud', [[1, 0]]);
    await putFixture(page, 1, 0, 'loot', {pool:5});
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), gold = g.goldHeld();
        return [g.isOpen(1, 0), g.seeThrough(1, 0), g.playerAct(c, 1, 0), c.x, g.goldHeld() - gold];
    })).toEqual([true, 1, true, 1, 5]);
});

test('a step onto dear going costs its moveCost times an action; a group pays for its dearest cell', async ({page}) => {
    await mudCosts2(page);
    await putFloors(page, 'mud', [[1, 0], [1, -1]]);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.apPool = '4';
        g.setGold(100);
        c.ap = 400;
        g.playerAct(c, 1, 0);                    // onto mud: 2
        out.push(c.ap);
        g.playerAct(c, 2, 0);                    // onto plain floor: 1
        out.push(c.ap);
        // Back, with a piece below it that lands on mud: the group pays 2.
        g.playerPlace(3, 0, c);
        g.pieceAt(3, 0).ap = 0;
        c.ap = 400;
        g.moveMode = 'fixed';
        g.playerAct(c, 1, 0);                    // the core onto mud, its child onto (2, 0)
        out.push(c.ap, g.pieceAt(2, 0) ? 'moved' : 'not');
        g.playerAct(c, 0, 0);                    // the core onto plain floor, the child onto mud
        out.push(c.ap);
        return out;
    })).toEqual([200, 100, 200, 'moved', 0]);
});

test('dear going never costs more than a piece\'s whole pool, but needs all of it', async ({page}) => {
    await mudCosts2(page);
    await putFloors(page, 'mud', [[1, 0]]);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.apPool = '1.5';
        g.rules.apRecovery = '0';   // (so the turn ending, once it's spent, gives nothing back)
        c.ap = 140;
        out.push(g.findMove(c, 1, 0), g.moveCost(c, g.findMove(c, 1, 0, 'fixed', false)));
        c.ap = 150;
        out.push(g.playerAct(c, 1, 0), c.ap);
        return out;
    })).toEqual([null, 150, true, 0]);
});

test('enemies count dear going on their way to you', async ({page}) => {
    await mudCosts2(page);
    // A corridor along y = 0, walled in, with mud at (1, 0)
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        for (const {x, y} of hc.hex.disk(0, 0, 4)) {
            if (y !== 0) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'stone_wall'));
        }
        g.tiles.set('1,0', g.makeTile(1, 0, 'floor', 'mud'));
        const field = g.distanceField(g.piecesOf('player'));
        // (1, 0) steps onto your core's plain cell: 1; (2, 0) onto the mud first: 2 more.
        return [field.get('1,0'), field.get('2,0'), field.get('3,0')];
    })).toEqual([1, 3, 4]);
});

test('Go to goes round dear going when that\'s cheaper', async ({page}) => {
    await mudCosts2(page);
    await putFloors(page, 'mud', [[1, 0], [2, 0], [3, 0]]);
    const route = await page.evaluate(() => {
        hc.cfg.VISION.fog = false;
        return hc.app.game.routeTo(hc.app.game.getPlayerCore(), 4, 0);
    });
    expect(route.at(-1)).toEqual([4, 0]);
    expect(route.some(([x, y]) => y === 0 && x >= 1 && x <= 3)).toBe(false);
});

test('pointing at a floor says what it is and what a step onto it costs', async ({page}) => {
    await mudCosts2(page);
    await putFloors(page, 'mud', [[2, 0]]);
    await page.evaluate(() => {
        hc.app.centerOn(false);
        hc.view.draw();
    });
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText('Mud (a step onto it costs ×2) · Thick mud that sucks at your feet.')).toBeVisible();
});

test('a cell with no tile is the map\'s base floor, and costs what it does', async ({page}) => {
    await mudCosts2(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game, out = [g.baseFloor().id, g.moveCostAt(5, 5)];
        g.tileGenerator.attrs.baseFloor = 'mud';
        out.push(g.baseFloor().id, g.moveCostAt(5, 5));
        return out;
    })).toEqual(['stone_floor', 1, 'mud', 2]);
});

test('the proximity generator puts a clump of floor in each quadrant, which solids and holes may land on', async ({page}) => {
    expect(await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator.attrs, out = [];
        Object.assign(T, {wallChance:0, floorMin:6, floorMax:6, floorType:'ice', solidMin:0, solidMax:0, holeMin:0, holeMax:0});
        const make = () => {
            g.tiles.clear();
            g.fixtures.clear();
            g.tileGenerator.borders.clear();
            g.tileGenerator.terrainQuads.delete('0,0');
            g.tileGenerator.generateTerrain(0, 0);
            return [...g.tiles.values()];
        };
        const floors = make();
        out.push(floors.length, floors.every(t => t.kind === 'floor' && t.subtype === 'ice'));
        // Solids over all of it: on the floors too.
        T.solidMin = T.solidMax = 1000;
        out.push(make().filter(t => t.kind === 'floor').length);
        return out;
    })).toEqual([6, true, 0]);
});

test('the caverns generator puts patches of floor on open cells, from its floorTable, under heals and the like', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        g.gameMap = {...g.gameMap, tileGenerator:{type:'caverns', attrs:{floorFrequency:40, floorTable:{mud:1}, healFrequency:60}}};
        g.seed = 3;
        g.reset();
        for (const b of hc.hex.disk(0, 0, 3)) g.tileGenerator.makeBlock(b.x, b.y);
        const floors = [...g.tiles.values()].filter(t => t.kind === 'floor');
        return {
            base:g.baseFloor().id,
            some:floors.length > 20,
            kinds:[...new Set(floors.map(t => t.subtype))],
            onFloors:[...g.fixtures.values()].some(f => g.tiles.get(g.key(f.x, f.y))?.kind === 'floor'),
            // (On open floor: what's under it, since a fixture may be in the way itself.)
            fixturesOpen:[...g.fixtures.values()].every(f => ['floor', undefined].includes(g.tiles.get(g.key(f.x, f.y))?.kind))
        };
    });
    expect(r).toEqual({base:'cave_floor', some:true, kinds:['mud'], onFloors:true, fixturesOpen:true});
});

test('pointing at plain ground says what the map\'s base floor is, with no cost when it\'s 1', async ({page}) => {
    await putFixture(page, 2, 0, 'loot', {pool:5});
    await page.evaluate(() => {
        hc.app.centerOn(false);
        hc.view.draw();
    });
    await page.mouse.move(...await cellOnPage(page, 0, -2));
    await expect(page.getByText('Stone floor · Plain stone.', {exact:true})).toBeVisible();
    // After a fixture on it
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText('Loot · Gold for the taking. · Stone floor', {exact:true})).toBeVisible();
});
