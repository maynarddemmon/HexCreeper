import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putTile, putFixture, cellOnPage} from './helpers.mjs';

// Fixture kinds for these tests, made as init.json5's are (Subtypes.define's parse), so
// they don't depend on its data. Each a feature unless it says.
const KINDS = {
    wall:{name:'Wall', composition:'flesh', hp:2, moveCost:0, coverage:100, destroyInto:'rubbish', floor:'mud'},
    rubbish:{name:'Rubbish', moveCost:1.5},
    gate:{name:'Gate', composition:'flesh', state:{open:false}, moveCost:'open ? 1 : 0', coverage:'open ? 0 : 50'},
    hard:{name:'Hard', composition:'pinewood', hp:5, moveCost:0},
    chest:{name:'Chest', type:'loot', pool:5, destroyInto:'rubbish'}
};

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(kinds => {
        const F = hc.fixtures;
        for (const [id, k] of Object.entries(kinds)) {
            const entry = {type:'feature', description:'', ...k};
            F.byId.set(id, {id, name:entry.name, description:'', ...F.parse(entry, id)});
        }
        hc.floors.get('mud').moveCost = 2;
        hc.app.game.rules.apPool = hc.app.game.rules.apRecovery = '3';
        hc.app.game.getPlayerCore().ap = 300;
    }, KINDS);
});

test('a fixture kind has a solid\'s properties, state, and formulas of it that make sense', async ({page}) => {
    const r = await page.evaluate(() => {
        const ok = e => !!hc.fixtures.parse({type:'feature', ...e}, 'x');
        return {
            feature:ok({}),
            gate:ok({state:{open:false, locks:2}, moveCost:'open && locks < 1 ? 1 : 0', coverage:'hp > 0 ? 100 : 0', composition:'oakwood', hp:4, floor:'mud', destroyInto:'wall'}),
            bad:[
                {state:{hp:1}}, {state:{open:'yes'}}, {state:[1]}, {composition:'cheese'}, {hp:0}, {hp:1.5},
                {moveCost:'shut ? 0 : 1'}, {coverage:150}, {coverage:'open +'}, {floor:3}, {type:'trap'}
            ].map(ok),
            // Heals, harms and loot still need a pool.
            loot:[ok({type:'loot'}), ok({type:'loot', pool:3})]
        };
    });
    expect(r).toEqual({feature:true, gate:true, bad:Array(11).fill(false), loot:[false, true]});
});

test('a step onto a fixture costs its moveCost times the floor\'s', async ({page}) => {
    await putTile(page, 1, 0, 'floor', 'mud');
    await putFixture(page, 1, 0, 'rubbish');
    await putFixture(page, 0, 1, 'rubbish');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [g.moveCostAt(1, 0), g.moveCostAt(0, 1)];
        g.rules.apRecovery = '0';   // (so the turn ending when it's spent gives nothing back)
        g.playerAct(c, 1, 0);
        out.push(c.ap);
        return out;
    });
    expect(r).toEqual([3, 1.5, 0]);
});

test('a fixture whose moveCost is 0 or less is in the way, as a solid is', async ({page}) => {
    await putFixture(page, 1, 0, 'gate');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = {};
        g.score = 100;
        const shut = () => [g.isOpen(1, 0), g.legalMoves(c).some(m => m.x === 1 && m.y === 0), g.placeCells(c).some(q => q.x === 1 && q.y === 0),
            g.jumpTargets(c).some(q => q.x === 2 && q.y === 0)];
        out.shut = shut();
        g.fixtures.get('1,0').state.open = true;
        out.open = shut();
        return out;
    });
    // Shut: no step, place or jump over it (2, 0 is straight over); open: all of them.
    expect(r).toEqual({shut:[false, false, false, false], open:[true, true, true, true]});
});

test('a fixture blocks as much sight as its material\'s opacity times its coverage', async ({page}) => {
    await putFixture(page, 1, 0, 'gate');
    await putFixture(page, 0, 1, 'wall');
    const r = await page.evaluate(() => {
        const g = hc.app.game, out = [g.seeThrough(1, 0), g.seeThrough(0, 1)];
        g.fixtures.get('1,0').state.open = true;
        out.push(g.seeThrough(1, 0));
        // Behind the wall, out of sight.
        g._sightKey = null;
        out.push(g.cellsInSight().has('0,3'), g.cellsInSight().has('3,0'));
        return out;
    });
    expect(r).toEqual([0.5, 0, 1, false, true]);
});

test('a fixture with HP in the way can be broken, as a solid can; it leaves its floor and destroyInto, which the piece advances onto', async ({page}) => {
    await putFixture(page, 1, 0, 'wall');
    await putFixture(page, 0, 1, 'hard');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        // The hard one's DR is more than the core can do (sure combat: 1 damage).
        out.push(g.legalMoves(c).some(m => m.x === 0 && m.y === 1));
        g.playerAct(c, 1, 0);
        out.push(g.fixtures.get('1,0').hp);
        g.playerAct(c, 1, 0);
        const f = g.fixtures.get('1,0');
        out.push(f.subtype, f.revealedAt === g.turn, g.tiles.get('1,0')?.subtype, g.isOpen(1, 0), [c.x, c.y]);
        return out;
    });
    expect(r).toEqual([false, 1, 'rubbish', true, 'mud', true, [1, 0]]);
});

test('a fixture used up or run out leaves its destroyInto too', async ({page}) => {
    await putFixture(page, 1, 0, 'chest');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.playerAct(c, 1, 0);
        return [g.fixtures.get('1,0')?.subtype, g.score > 0];
    });
    expect(r).toEqual(['rubbish', true]);
});

test('a fixture in the way shows once it\'s in sight, whatever its kind\'s revealMode', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, F = hc.fixtures;
        F.byId.set('hidden_wall', {...F.get('wall'), id:'hidden_wall', reveal:{mode:'hidden', range:0}});
        F.byId.set('hidden_rubbish', {...F.get('rubbish'), id:'hidden_rubbish', reveal:{mode:'hidden', range:0}});
        g.fixtures.set('2,0', g.makeFixture(2, 0, 'hidden_wall'));
        g.fixtures.set('0,2', g.makeFixture(0, 2, 'hidden_rubbish'));
        g.revealFixtures();
        return [g.fixtureAt(2, 0)?.subtype ?? null, g.fixtureAt(0, 2)];
    });
    expect(r).toEqual(['hidden_wall', null]);
});

test('a fixture\'s HP and state are saved with it', async ({page}) => {
    await putFixture(page, 1, 0, 'gate');
    await putFixture(page, 0, 1, 'wall', {hp:1});
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        g.fixtures.get('1,0').state.open = true;
        const data = JSON.parse(JSON.stringify(g.exportToObj()));
        g.fixtures.get('1,0').state.open = false;
        g.importFromObj(data);
        return [g.fixtures.get('1,0').state, g.fixtures.get('0,1').hp, g.isOpen(1, 0)];
    });
    expect(r).toEqual([{open:true}, 1, true]);
});

test('pointing at a fixture that can be broken says how tough it is', async ({page}) => {
    await putFixture(page, 2, 0, 'wall');
    await page.evaluate(() => hc.app.centerOn(false));
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText(/^Wall \(flesh\) · HP 2\/2 · DR 0/)).toBeVisible();
});

// A new game with the tile generator type and attrs, made out to r blocks or quadrants
// around the start: where its fixtures are, {x,y: [type, subtype]}.
const generated = (page, type, attrs, r) => page.evaluate(([type, attrs, r]) => {
    const g = hc.app.game;
    g.gameMap = {...g.gameMap, tileGenerator:{type, attrs}};
    g.seed = 7;
    g.reset();
    const T = g.tileGenerator;
    if (type === 'caverns') {
        for (const b of hc.hex.disk(0, 0, r)) T.makeBlock(b.x, b.y);
    } else {
        for (const q of hc.hex.disk(0, 0, r)) T.generateTiles(q.x, q.y);
    }
    return Object.fromEntries([...g.fixtures.values()].map(f => [f.x + ',' + f.y, [f.type, f.subtype]]));
}, [type, attrs, r]);

test('the caverns put features (featureTable) on cavern floor, off the tunnels\' paths; the rest are where they were', async ({page}) => {
    const none = await generated(page, 'caverns', {featureFrequency:0}, 5),
        some = await generated(page, 'caverns', {featureFrequency:60, featureTable:{wall:1}, streamChance:10}, 5),
        features = Object.keys(some).filter(k => some[k][0] === 'feature');
    expect(features.length).toBeGreaterThan(20);
    expect(features.every(k => some[k][1] === 'wall')).toBe(true);
    expect(Object.fromEntries(Object.entries(some).filter(([, f]) => f[0] !== 'feature'))).toEqual(none);
    expect(await page.evaluate(keys => {
        const T = hc.app.game.tileGenerator;
        return keys.every(k => {
            const [x, y] = k.split(',').map(Number);
            return T.isCavernFloor(x, y, T.near(...T.blocks.of(x, y)));
        });
    }, features)).toBe(true);
});

// Steps from the start to cell key k.
const stepsFromStart = k => {
    const [x, y] = k.split(',').map(Number);
    return (Math.abs(x) + Math.abs(y) + Math.abs(x + y)) / 2;
};

test('the proximity generator puts features (featureTable) on free cells, not by the start; the rest are where they were', async ({page}) => {
    const none = await generated(page, 'proximity', {featureFrequency:0}, 3),
        some = await generated(page, 'proximity', {featureFrequency:100, featureTable:{wall:1}}, 3),
        features = Object.keys(some).filter(k => some[k][0] === 'feature');
    expect(features.length).toBeGreaterThan(20);
    expect(features.every(k => some[k][1] === 'wall' && stepsFromStart(k) > 1)).toBe(true);
    expect(Object.fromEntries(Object.entries(some).filter(([, f]) => f[0] !== 'feature'))).toEqual(none);
});

test('Attack hits a cell next to the piece, for an action, without stepping: a fixture with HP even if you could step onto it', async ({page}) => {
    await page.evaluate(() => {
        const F = hc.fixtures;
        F.byId.set('bush', {id:'bush', name:'Bush', description:'', ...F.parse({type:'feature', composition:'flesh', hp:2, moveCost:1.5, destroyInto:'rubbish'}, 'bush')});
    });
    await putFixture(page, 1, 0, 'bush');
    await putFixture(page, 0, 1, 'hard');
    await putFixture(page, -1, 1, 'rubbish');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), e = g.addPiece('core', 'enemy', -1, 0), out = {};
        // The bush (passable, HP) and the enemy; not the hard one (its DR is too much) or
        // the rubbish (no HP).
        out.targets = g.attackTargets(c).map(q => q.x + ',' + q.y).sort();
        out.hit = [g.playerAttack(c, 1, 0), g.fixtures.get('1,0').hp, c.ap, [c.x, c.y]];
        g.playerAttack(c, 1, 0);
        out.broken = g.fixtures.get('1,0').subtype;
        out.enemy = [g.playerAttack(c, -1, 0), g.pieces.has(e.id)];
        out.not = g.playerAttack(c, 0, 1);
        return out;
    });
    expect(r).toEqual({targets:['-1,0', '1,0'], hit:[true, 1, 200, [0, 0]], broken:'rubbish', enemy:[true, false], not:false});
});

test('Attack in the menu (or F) highlights what the piece can attack; a click attacks it', async ({page}) => {
    await putFixture(page, 1, 0, 'wall');
    await page.evaluate(() => {
        hc.app.game.selectedId = hc.app.game.playerCoreId;
        hc.app.centerOn(false);
    });
    await page.keyboard.press('f');
    await expect(page.getByText('Attack: click a highlighted cell for the selected piece to attack. Esc cancels.')).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, 1, 0));
    expect(await page.evaluate(() => [hc.app.game.fixtures.get('1,0').hp, hc.view.attackMode])).toEqual([1, false]);
});

test('a damaged feature shows its HP bar', async ({page}) => {
    await putFixture(page, 1, 0, 'wall', {hp:1});
    await putFixture(page, 0, 1, 'wall');
    const colours = await page.evaluate(() => {
        const V = hc.view;
        V.cam.size = 80;
        hc.app.centerOn(false);
        hc.app.game.selectedId = null;  // (nothing tinted round it)
        V.stopPan();
        V.render(performance.now());
        // Near the left end of where the bar goes: --dmg, if it's there.
        return [[1, 0], [0, 1]].map(([x, y]) => {
            const [cx, cy] = V.cellCenter(x, y);
            return [...V.canvas.getContext('2d').getImageData(Math.round((cx - 80 * 0.25) * V.dpr), Math.round(cy * V.dpr), 1, 1).data].join();
        });
    });
    expect(colours).toEqual(['255,102,85,255', expect.not.stringMatching(/^255,102,85/)]);
});
