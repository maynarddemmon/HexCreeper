import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putTile, putFixture, cellOnPage, menuItem} from './helpers.mjs';

// Fixture kinds for these tests, made as init.json5's are (Subtypes.define's parse), so
// they don't depend on its data. Each a feature unless it says.
const KINDS = {
    wall:{name:'Wall', composition:'flesh', hp:2, moveCost:0, coverage:100, destroyInto:'rubbish', floor:'mud'},
    rubbish:{name:'Rubbish', moveCost:1.5},
    gate:{name:'Gate', composition:'flesh', state:{open:false}, moveCost:'open ? 1 : 0', coverage:'open ? 0 : 50'},
    hard:{name:'Hard', composition:'pinewood', hp:5, moveCost:0},
    chest:{name:'Chest', type:'loot', pool:5, destroyInto:'rubbish'},
    door:{
        name:'Door', shape:'door', orientable:true, composition:'pinewood', hp:5, state:{open:false, barred:false},
        moveCost:'open ? 1 : 0', coverage:'open ? 0 : 100',
        actions:{
            open:{when:'!open && !barred', set:{open:true}, onStep:true},
            close:{when:'open', set:{open:false}},
            bar:{from:['back'], when:'!open && !barred', set:{barred:true}, label:'Bar it'},
            unbar:{from:['back'], when:'barred', set:{barred:'0'}}
        },
        describe:[{when:'open', text:'ajar'}, {when:'!open', text:'closed'}, {when:'barred', text:'barred'}, {text:'wooden'}]
    }
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
                {moveCost:'shut ? 0 : 1'}, {coverage:150}, {coverage:'open +'}, {floor:3}, {type:'trap'},
                // Actions: sides it can be done from, a when that makes sense, a set of its
                // state, onStep true or false; a shape it can be drawn as; orientable true
                // or false.
                {state:{open:false}, actions:{x:{from:['top']}}}, {actions:{x:{set:{open:true}}}},
                {state:{open:false}, actions:{x:{when:'shut'}}}, {state:{open:false}, actions:{x:{set:{open:'open +'}}}},
                {state:{open:false}, actions:{x:{onStep:'yes'}}}, {actions:[]}, {shape:'circle'}, {orientable:'yes'},
                // Describe: a list of texts, each with a when that makes sense.
                {describe:{text:'x'}}, {describe:[{when:'1'}]}, {describe:[{text:''}]}, {state:{open:false}, describe:[{when:'shut', text:'x'}]}
            ].map(ok),
            door:ok({state:{open:false}, orientable:true, shape:'door', actions:{open:{from:['back', 'side'], when:'!open', set:{open:'1'}, onStep:true, label:'Push'}}}),
            // Heals, harms and loot still need a pool.
            loot:[ok({type:'loot'}), ok({type:'loot', pool:3})]
        };
    });
    expect(r).toEqual({feature:true, gate:true, bad:Array(23).fill(false), door:true, loot:[false, true]});
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
    const none = await generated(page, 'caverns', {featureFrequency:0, doorChance:0}, 5),
        some = await generated(page, 'caverns', {featureFrequency:60, featureTable:{wall:1}, streamChance:10, doorChance:0}, 5),
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
    const none = await generated(page, 'proximity', {featureFrequency:0, doorChance:0}, 3),
        some = await generated(page, 'proximity', {featureFrequency:100, featureTable:{wall:1}, doorChance:0}, 3),
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

// A door at (1, 0) facing 0 (see Fixtures.js: orientable): its front is directions 0 and 1
// round from it, its sides 2 and 5, its back 3 and 4.
const putDoor = (page, facing = 0) => putFixture(page, 1, 0, 'door', {facing});

test('an orientable fixture faces a way: the cells round it are its front, sides and back', async ({page}) => {
    await putDoor(page);
    await putFixture(page, 0, 1, 'wall');
    const r = await page.evaluate(() => {
        const g = hc.app.game, door = g.fixtures.get('1,0'), D = hc.hex.dirs;
        return {
            door:D.map(([dx, dy]) => g.fixtureSide(door, 1 + dx, dy)),
            far:g.fixtureSide(door, 5, 5),
            // Not orientable: any side.
            wall:g.fixtureSide(g.fixtures.get('0,1'), 0, 0),
            // A new one gets a facing, 0 to 5.
            made:[0, 1, 2, 3].map(() => g.makeFixture(0, 0, 'door').facing).every(f => Number.isInteger(f) && f >= 0 && f < 6)
        };
    });
    expect(r).toEqual({door:['front', 'front', 'side', 'back', 'back', 'side'], far:null, wall:'any', made:true});
});

test('a fixture\'s actions: what a piece of yours next to it can do, from the sides each allows, when its state allows', async ({page}) => {
    await putDoor(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs, door = g.fixtures.get('1,0'), out = {};
        g.rules.apRecovery = '3';
        const at = dir => {
            g.board.delete(g.key(c.x, c.y));
            c.x = 1 + D[dir][0];
            c.y = D[dir][1];
            g.board.set(g.key(c.x, c.y), c.id);
            return g.fixtureActions(c, door);
        };
        // From the back: open or bar; from the front, only open.
        out.back = at(3);
        out.front = at(0);
        // Barred from the back: nobody can open it, from either side.
        at(3);
        out.bar = [g.playerUse(c, 1, 0, 'bar'), door.state.barred, c.ap];
        out.barred = [at(3), at(0)];
        at(3);
        g.playerUse(c, 1, 0, 'unbar');
        out.unbarred = door.state.barred;
        out.open = [g.playerUse(c, 1, 0, 'open'), door.state.open, g.isOpen(1, 0), g.fixtureActions(c, door)];
        // Not from the front.
        at(0);
        out.notFromFront = g.playerUse(c, 1, 0, 'bar');
        return out;
    });
    expect(r).toEqual({
        back:['open', 'bar'], front:['open'],
        bar:[true, true, 200], barred:[['unbar'], []], unbarred:false,
        open:[true, true, true, ['close']], notFromFront:false
    });
});

test('a step into a shut door opens it (and stays put); into a barred one, nothing; a door won\'t shut on a piece', async ({page}) => {
    await putDoor(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), door = g.fixtures.get('1,0'), out = {};
        g.rules.apRecovery = '3';
        door.state.barred = true;
        out.barred = [g.playerAct(c, 1, 0), door.hp, [c.x, c.y], c.ap];
        door.state.barred = false;
        out.shut = [g.playerAct(c, 1, 0), door.state.open, [c.x, c.y], c.ap];
        // Open: a step goes into it, and it can't be shut with the core in it.
        out.through = [g.playerAct(c, 1, 0), [c.x, c.y], g.fixtureActions(c, door)];
        return out;
    });
    expect(r).toEqual({barred:[false, 5, [0, 0], 300], shut:[true, true, [0, 0], 200], through:[true, [1, 0], []]});
});

test('opening a door lets sight through it at once, and paths', async ({page}) => {
    // Walls either side of the door, so only it is between the core and what's past it.
    await putDoor(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        for (const [x, y] of [[1, -1], [2, -1], [0, 1], [1, 1]]) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
        out.push(g.cellsInSight().has('4,0'), g.isOpen(1, 0));
        g.playerUse(c, 1, 0, 'open');
        out.push(g.cellsInSight().has('4,0'), g.isOpen(1, 0));
        return out;
    });
    expect(r).toEqual([false, false, true, true]);
});

test('a fixture\'s facing is saved with it', async ({page}) => {
    await putDoor(page, 4);
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        g.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return g.fixtures.get('1,0').facing;
    })).toBe(4);
});

test('Use (U, or the menu) highlights what the piece can do something to; a click does the one thing, or offers a choice', async ({page}) => {
    await putDoor(page);
    // The core in front of it (2, 0 is direction 0 round from it).
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.apRecovery = '3';
        g.board.delete('0,0');
        c.x = 2;
        g.board.set('2,0', c.id);
        g.selectedId = g.playerCoreId;
        hc.app.centerOn(false);
    });
    // From the front, only Open: a click opens it.
    await page.keyboard.press('u');
    await expect(page.getByText('Use: click a highlighted cell for the selected piece to do something to what\'s there. Esc cancels.')).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, 1, 0));
    expect(await page.evaluate(() => hc.app.game.fixtures.get('1,0').state.open)).toBe(true);
    // Shut again, from the back (0, 0 is direction 3 round from it): Open or Bar it.
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.fixtures.get('1,0').state.open = false;
        g.board.delete('2,0');
        c.x = 0;
        g.board.set('0,0', c.id);
        hc.view.draw();
    });
    await page.keyboard.press('u');
    await page.mouse.click(...await cellOnPage(page, 1, 0));
    await expect(menuItem(page, 'Open')).toBeVisible();
    await menuItem(page, 'Bar it').click();
    expect(await page.evaluate(() => [hc.app.game.fixtures.get('1,0').state, hc.view.useChoice])).toEqual([{open:false, barred:true}, null]);
    await expect(menuItem(page, 'Open')).toHaveCount(0);
});

// The doors made (subtype door), each {x, y, facing, sides: whether the cells at its sides
// are closed (a solid, a hole or another door), front and back: whether one of the cells
// on each is open}.
const doorsMade = page => page.evaluate(() => {
    const g = hc.app.game, D = hc.hex.dirs,
        open = (x, y) => g.isOpen(x, y) || !!g.fixtures.get(g.key(x, y)),
        at = (f, d) => [f.x + D[(f.facing + d) % 6][0], f.y + D[(f.facing + d) % 6][1]];
    return [...g.fixtures.values()].filter(f => f.subtype === 'door').map(f => ({
        x:f.x, y:f.y, facing:f.facing,
        sides:[2, 5].every(d => !g.isOpen(...at(f, d)) && !g.fixtures.get(g.key(...at(f, d))) || g.fixtures.get(g.key(...at(f, d)))?.subtype === 'door'),
        front:[0, 1].some(d => open(...at(f, d))),
        back:[3, 4].some(d => open(...at(f, d)))
    }));
});

test('the proximity generator puts doors (doorTable) in the gaps of solid walls, at doorChance, along the wall', async ({page}) => {
    await generated(page, 'proximity', {doorChance:100, doorTable:{door:1}, wallChance:100, wallHoleChance:0}, 3);
    const doors = await doorsMade(page);
    expect(doors.length).toBeGreaterThan(5);
    // (A clump of solids or holes may land in front of one, or behind, as in any gap.)
    expect(doors.every(d => d.sides)).toBe(true);
    // Either way round.
    expect(new Set(doors.map(d => d.facing)).size).toBeGreaterThan(2);
    await generated(page, 'proximity', {doorChance:0, wallChance:100}, 3);
    expect((await doorsMade(page)).length).toBe(0);
});

// The cells reached from the start, over cells with no solid or hole tile (doors are
// fixtures, so this goes through them), in the blocks made.
const reachedFromStart = page => page.evaluate(() => {
    const g = hc.app.game, T = g.tileGenerator,
        seen = new Set(['0,0']), todo = [[0, 0]];
    for (const [x, y] of todo) {
        for (const [dx, dy] of hc.hex.dirs) {
            const k = (x + dx) + ',' + (y + dy), t = g.tiles.get(k);
            if (!seen.has(k) && T.madeBlocks.has(T.blocks.key(x + dx, y + dy)) && (!t || t.kind === 'floor')) {
                seen.add(k);
                todo.push([x + dx, y + dy]);
            }
        }
    }
    return hc.hex.disk(0, 0, 3).filter(({x, y}) => {
        const s = T.site(x, y), c = hc.hex.cellAtWorld(s.wx, s.wy);
        return seen.has(c.x + ',' + c.y);
    }).map(q => q.x + ',' + q.y);
});

test('the caverns put doorways where tunnels leave caverns: a wall across the tunnel, the door\'s back toward the cavern, nothing cut off', async ({page}) => {
    await generated(page, 'caverns', {doorChance:0}, 8);
    const without = await reachedFromStart(page);
    await generated(page, 'caverns', {doorChance:100, doorTable:{door:1}}, 8);
    const doors = await doorsMade(page);
    expect(doors.length).toBeGreaterThan(5);
    expect(doors.every(d => d.sides && d.front && d.back)).toBe(true);
    // The caverns reached from the start without doors are reached through them.
    expect(without.length).toBeGreaterThan(5);
    expect(await reachedFromStart(page)).toEqual(without);
    expect(await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, D = hc.hex.dirs,
            doors = [...g.fixtures.values()].filter(f => f.subtype === 'door');
        // Its back is toward a cavern: the cavern next to it on the lattice nearest its
        // back is nearer its back than its front.
        const backToCavern = doors.every(f => {
                const toward = d => hc.hex.center(f.x + D[(f.facing + d) % 6][0], f.y + D[(f.facing + d) % 6][1]),
                    [bx, by] = toward(3).map((v, n) => (v + toward(4)[n]) / 2),
                    [fx, fy] = toward(0).map((v, n) => (v + toward(1)[n]) / 2),
                    sites = hc.hex.disk(...T.siteOf(f.x, f.y), 2).map(q => T.site(q.x, q.y)).filter(s => !s.junction),
                    s = sites.reduce((a, b) => Math.hypot(b.wx - bx, b.wy - by) < Math.hypot(a.wx - bx, a.wy - by) ? b : a);
                return Math.hypot(s.wx - bx, s.wy - by) < Math.hypot(s.wx - fx, s.wy - fy);
            }),
            // None by the start.
            byStart = doors.some(f => hc.hexDist(f, {x:0, y:0}) <= 2);
        return {backToCavern, byStart};
    })).toEqual({backToCavern:true, byStart:false});
});

test('pointing at a fixture says its state in its kind\'s words (describe)', async ({page}) => {
    await putFixture(page, 2, 0, 'door', {facing:0, state:{open:false, barred:true}});
    await page.evaluate(() => hc.app.centerOn(false));
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText(/^Door \(pine\) · HP 5\/5 · DR \d+ · closed, barred, wooden/)).toBeVisible();
    await page.evaluate(() => {
        hc.app.game.fixtures.get('2,0').state = {open:true, barred:false};
        hc.view.draw();
    });
    await page.mouse.move(...await cellOnPage(page, 2, 1));
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText(/^Door \(pine\) · HP 5\/5 · DR \d+ · ajar, wooden/)).toBeVisible();
});

// A wall down x = 2 with a door in it at (2, 0), facing east (its back toward the core,
// at the origin), fog off; barred if asked. Only the core is left of your pieces.
const doorInWall = (page, barred = false) => page.evaluate(barred => {
    const g = hc.app.game, c = g.getPlayerCore();
    for (const p of g.piecesOf('player')) if (p !== c) g.removePiece(p);
    for (let y = -20; y <= 20; y++) if (y !== 0) g.tiles.set(g.key(2, y), g.makeTile(2, y, 'solid', 'boulder'));
    g.fixtures.set('2,0', {...g.makeFixture(2, 0, 'door'), facing:0, revealedAt:g.turn, shown:true, state:{open:false, barred}});
    g.tileGenerator.piecesMoved = () => {};
    hc.cfg.VISION.fog = false;
    g._sightKey = null;
}, barred);

test('a route goes through a shut door it can open, for an action more; not a barred one', async ({page}) => {
    await doorInWall(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), through = route => !!route?.some(([x, y]) => x === 2 && y === 0),
            shut = g.routeTo(c, 4, 0);
        g.fixtures.get('2,0').state.barred = true;
        const barred = g.routeTo(c, 4, 0);
        return {shut:[through(shut), shut?.length], barred:through(barred)};
    });
    expect(r).toEqual({shut:[true, 4], barred:false});
});

test('Go to opens a shut door on the way, then goes through', async ({page}) => {
    await doorInWall(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.selectedId = g.playerCoreId;
        hc.app.centerOn(false);
        hc.view.draw();
    });
    await page.keyboard.press('g');
    await page.mouse.click(...await cellOnPage(page, 4, 0));
    await expect(page.getByText('Arrived.', {exact:true}).filter({visible:true})).toBeVisible({timeout:15000});
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        return [c.x, c.y, g.fixtures.get('2,0').state.open];
    })).toEqual([4, 0, true]);
});

// A creeper past the door, a few turns of waiting: where it got to, and whether the door
// is open.
const creeperAtDoor = page => page.evaluate(() => {
    const g = hc.app.game, e = g.addPiece('core', 'enemy', 5, 0);
    let t = 0;
    while (t < 8 && g.pieces.has(e.id) && e.x > 1) {
        g.playerWait();
        t++;
    }
    return {open:g.fixtures.get('2,0').state.open, through:e.x <= 2};
});

test('an enemy opens a shut door on its way and comes through', async ({page}) => {
    await doorInWall(page);
    expect(await creeperAtDoor(page)).toEqual({open:true, through:true});
});

test('an enemy can\'t open a barred door', async ({page}) => {
    await doorInWall(page, true);
    expect(await creeperAtDoor(page)).toEqual({open:false, through:false});
});

test('the enemies\' field goes through doors they could open, for an action more', async ({page}) => {
    await doorInWall(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), at = (field, x, y) => field.get(g.key(x, y));
        const plain = g.distanceField([c], 10), doors = g.distanceField([c], 10, true);
        return {plain:at(plain, 3, 0) === undefined || at(plain, 3, 0) > at(doors, 3, 0), step:at(doors, 3, 0) - at(doors, 1, 0)};
    });
    // Onto the door, an action and one to open it; off it, an action.
    expect(r).toEqual({plain:true, step:3});
});
