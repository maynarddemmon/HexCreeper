import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage, setComponentAttrs} from './helpers.mjs';

/*  Materials and solid subtypes of the tests' own, in place of init.json5's, so editing
    the game's data doesn't break the tests. */
const useTestSolids = page => page.evaluate(() => {
    hc.solids.define({
        granite:{name:'granite', hardness:13},
        basalt:{name:'basalt', hardness:8},
        pine:{name:'pine', hardness:4},
        iron:{name:'iron', hardness:17},
        fungus:{name:'fungus', hardness:0},
        flesh:{name:'flesh', hardness:0}
    }, {
        stone_wall:{name:'Stone wall', composition:'granite', hp:30},
        boulder:{name:'Boulder', composition:'basalt', hp:12},
        wooden_barricade:{name:'Wooden barricade', composition:'pine', hp:8},
        iron_bars:{name:'Iron bars', composition:'iron', hp:15},
        fungus:{name:'Fungus', composition:'fungus', hp:3},
        wall_of_flesh:{name:'Wall of flesh', composition:'flesh', hp:6},
        painted_wall:{name:'Painted wall', composition:'granite', hp:30, fillColor:'#ff0000', borderColor:'--heal'}
    });
});

// Puts a solid of the given subtype at (x, y).
const putSolid = (page, x, y, subtype) => page.evaluate(([x, y, subtype]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', subtype));
}, [x, y, subtype]);

test('materials and solid subtypes come from init.json5; a subtype\'s DR is its material\'s hardness', async ({page}) => {
    const problems = await startGame(page);
    const r = await page.evaluate(() => {
        const list = hc.solids.list(), T = hc.app.game.tileGenerator.attrs;
        return {
            some:list.length > 0,
            made:list.every(s => s.material === hc.solids.getMaterial(s.composition) && s.dr === s.material.hardness && s.hp > 0),
            defaults:[T.wallSolid, T.clumpSolid].every(id => hc.solids.get(id)),
            holes:hc.holes.list().length > 0 && hc.holes.list().every(h => h.name && typeof h.description === 'string'),
            holeDefaults:[T.wallHole, T.clumpHole].every(id => hc.holes.get(id)),
            holeTile:hc.app.game.makeTile(0, 0, 'hole', T.clumpHole).subtype === T.clumpHole
        };
    });
    expect(r).toEqual({some:true, made:true, defaults:true, holes:true, holeDefaults:true, holeTile:true});
    expect(problems.errors.filter(e => /^Bad (material|solid|hole)/.test(e))).toEqual([]);
    
    await useTestSolids(page);
    expect(await page.evaluate(() => {
        const s = hc.solids.get('stone_wall');
        return [hc.solids.list().map(t => t.id), s.name, s.composition, s.hp, s.dr, s.material.name];
    })).toEqual([
        ['stone_wall', 'boulder', 'wooden_barricade', 'iron_bars', 'fungus', 'wall_of_flesh', 'painted_wall'],
        'Stone wall', 'granite', 30, 13, 'granite'
    ]);
});

test('a material or subtype that isn\'t usable is left out', async ({page}) => {
    const errors = await startGame(page);
    const ids = await page.evaluate(() => {
        hc.solids.define(
            {rock:{name:'rock', hardness:2}, mush:{name:'mush', hardness:-1}, goo:{hardness:1}},
            {
                a:{name:'A', composition:'rock', hp:5}, b:{name:'B', composition:'mush', hp:5}, c:{name:'C', composition:'rock', hp:0}, d:{name:'D', composition:'rock', hp:2.5},
                e:{name:'E', composition:'rock', hp:5, fillColor:7}
            }
        );
        return [hc.solids.list().map(s => s.id), hc.solids.get('a').dr, !!hc.solids.getMaterial('goo')];
    });
    expect(ids).toEqual([['a'], 2, false]);
    expect(errors.errors.filter(e => /^Bad (material|solid)/.test(e)).length).toBe(6);
});

test('walls and clumps are made of the subtypes the tile generator\'s attrs choose, with their HP', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
    await setComponentAttrs(page, {tile:{wallChance:100, wallHoleChance:0, solidMin:4, solidMax:4, holeMax:0, wallSolid:'iron_bars', clumpSolid:'fungus'}});
    const kinds = await page.evaluate(() => {
        const g = hc.app.game;
        g.reset();
        const solids = [...g.tiles.values()].filter(t => t.kind === 'solid');
        return [...new Set(solids.map(t => t.subtype + ':' + t.hp))].sort();
    });
    expect(kinds).toEqual(['fungus:3', 'iron_bars:15']);
});

test('a piece whose damage beats a solid\'s DR breaks it, its damage less the DR at a time, then advances', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'fungus');   // DR 0, 3 HP
    const hit = () => page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), move = g.legalMoves(core).find(m => m.x === 1 && m.y === 0);
        g.playerAct(core, 1, 0);
        core.ap = 100;
        return [move?.attack, g.tiles.get('1,0')?.hp ?? null, core.x];
    });
    expect(await hit()).toEqual([true, 2, 0]);
    expect(await hit()).toEqual([true, 1, 0]);
    expect(await hit()).toEqual([true, null, 1]); // broken: open floor, and the core moves in
    
    await page.evaluate(() => {hc.app.game.getPlayerCore().damage = [3, 3];});
    await putSolid(page, 2, 0, 'wall_of_flesh'); // DR 0, 6 HP: 3 a hit at 3 damage
    expect((await page.evaluate(() => {
        const g = hc.app.game;
        g.playerAct(g.getPlayerCore(), 2, 0);
        return g.tiles.get('2,0').hp;
    }))).toBe(3);
});

test('a solid whose DR is at least the most damage the piece can do blocks it', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'wooden_barricade'); // pine: DR 4
    const moves = () => page.evaluate(() => {
        const g = hc.app.game;
        return g.legalMoves(g.getPlayerCore()).some(m => m.x === 1 && m.y === 0);
    });
    expect(await moves()).toBe(false);
    await page.evaluate(() => {hc.app.game.getPlayerCore().damage = [1, 4];});
    expect(await moves()).toBe(false);
    await page.evaluate(() => {hc.app.game.getPlayerCore().damage = [1, 5];});
    expect(await moves()).toBe(true);
    await page.evaluate(() => {hc.app.game.getPlayerCore().penetration = 1;}); // as if DR 3
    await page.evaluate(() => {hc.app.game.getPlayerCore().damage = [1, 4];});
    expect(await moves()).toBe(true);
});

test('enemies can\'t attack solids', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
    await clearBoard(page);
    await putSolid(page, 6, 0, 'fungus');
    expect(await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 5, 0);
        return [g.canBreak(e, g.tiles.get('6,0')), g.legalMoves(e).some(m => m.x === 6 && m.y === 0)];
    })).toEqual([false, false]);
});

test('a damaged solid keeps its HP through a save', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
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
    await useTestSolids(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'stone_wall');
    await page.mouse.move(...await cellOnPage(page, 1, 0));
    await expect(page.getByText('Stone wall (granite) · HP 30/30 · DR 13', {exact:true})).toBeVisible();
});

test('a map chooses what walls and clumps are made of, from the solid subtypes', async ({page}) => {
    const problems = await startGame(page);
    await useTestSolids(page);
    expect(await page.evaluate(() => {
        const clean = hc.TileGenerator.cleanAttrs('proximity', {wallSolid:'wooden_barricade', clumpSolid:'no_such_solid'}, 'Test'),
            gen = hc.TileGenerator.make('proximity', hc.app.game, clean);
        return [clean, gen.attrs.wallSolid, gen.attrs.clumpSolid];
    })).toEqual([{wallSolid:'wooden_barricade'}, 'wooden_barricade', 'boulder']);
    expect(problems.warnings.some(w => /^Test attr clumpSolid cannot be no_such_solid/.test(w))).toBe(true);
});

test('a solid subtype with colours is drawn in them; one without, in the usual solid colours', async ({page}) => {
    await startGame(page);
    await useTestSolids(page);
    await clearBoard(page);
    await putSolid(page, 1, 0, 'painted_wall');
    await putSolid(page, -1, 0, 'stone_wall');
    const pixel = (x, y, dx = 0) => page.evaluate(([x, y, dx]) => {
        const V = hc.view, [sx, sy] = V.cellCenter(x, y);
        V.render(performance.now());
        return [...V.ctx.getImageData(Math.round((sx + dx * V.cam.size) * V.dpr), Math.round(sy * V.dpr), 1, 1).data.slice(0, 3)];
    }, [x, y, dx]);
    const css = name => page.evaluate(name => {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, name);
    expect(await pixel(1, 0)).toEqual([255, 0, 0]);
    expect(await pixel(-1, 0)).toEqual(await css('--solid'));
    // Its border, near its right edge, is mostly the green --heal (antialiased into the
    // fill and grid line), where the plain one's is grey.
    const [r, g] = await pixel(1, 0, 0.47), plain = await pixel(-1, 0, 0.47);
    expect(g).toBeGreaterThan(r);
    expect(Math.abs(plain[1] - plain[0])).toBeLessThan(8);
});

/*  See-through materials and solids of the tests' own: glass (10% opaque), ice (50%), and
    iron (opaque) as a wall and as bars (20% coverage). */
const useSeeThroughSolids = page => page.evaluate(() => {
    hc.solids.define({
        granite:{name:'granite', hardness:13},
        glass:{name:'glass', hardness:3, opacity:10},
        ice:{name:'ice', hardness:2, opacity:50},
        iron:{name:'iron', hardness:17}
    }, {
        stone_wall:{name:'Stone wall', composition:'granite', hp:30},
        glass_wall:{name:'Glass wall', composition:'glass', hp:4},
        ice_wall:{name:'Ice wall', composition:'ice', hp:6},
        iron_bars:{name:'Iron bars', composition:'iron', hp:10, coverage:20}
    });
});

test('a material has an opacity (default 100) and a solid a coverage (default 100); the solid\'s opacity is the two multiplied', async ({page}) => {
    const problems = await startGame(page);
    // The game's own see-through solids load.
    expect(await page.evaluate(() => ['glass_wall', 'ice_wall', 'iron_bars', 'net'].map(id => hc.solids.get(id)?.opacity))).toEqual([10, 50, 20, 30]);
    await useSeeThroughSolids(page);
    const r = await page.evaluate(() => {
        const out = ['stone_wall', 'glass_wall', 'ice_wall', 'iron_bars'].map(id => [hc.solids.get(id).coverage, hc.solids.get(id).opacity]);
        hc.solids.define({a:{name:'a', hardness:1, opacity:150}, b:{name:'b', hardness:1}}, {c:{name:'c', composition:'b', hp:1, coverage:-5}});
        out.push([hc.solids.getMaterial('a') ?? null, hc.solids.get('c') ?? null]);
        return out;
    });
    expect(r).toEqual([[100, 100], [100, 10], [100, 50], [20, 20], [null, null]]);
    expect(problems.errors.filter(e => /^Bad (material|solid)/.test(e))).toEqual(['Bad material a', 'Bad solid c']);
});

test('sight past a see-through solid is what\'s left of it, cut to the share the solid lets through', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await useSeeThroughSolids(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = {x:0, y:0},
            put = (x, y, s) => g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', s)),
            // How far straight up the core sees.
            reach = () => {
                let d = 0;
                while (d < 12 && g.canSee(core, {x:0, y:-(d + 1)})) d++;
                return d;
            },
            out = {};
        hc.app.game.rules.visionRadius = 12;
        out.clear = reach();
        put(0, -2, 'stone_wall');
        out.opaque = reach();          // the wall itself, no further
        put(0, -2, 'iron_bars');
        out.bars = reach();            // 2 + 10 x 0.8 = 10
        put(0, -2, 'ice_wall');
        out.ice = reach();             // 2 + 10 x 0.5 = 7
        put(0, -4, 'ice_wall');
        out.twoIce = reach();          // 4 + (7 - 4) x 0.5 = 5.5
        g.tiles.clear();
        put(0, -6, 'glass_wall');
        out.glass = reach();           // 6 + 6 x 0.9 = 11.4
        return out;
    });
    expect(r).toEqual({clear:12, opaque:2, bars:10, ice:7, twoIce:5, glass:11});
});

test('along an edge, the clearer of the two solids beside the line counts', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await useSeeThroughSolids(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = {x:0, y:0},
            put = (x, y, s) => g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', s)),
            // The line from the core to (k, -2k) runs along the edge between (0, -1) and (1, -1) first.
            reach = () => {
                let k = 0;
                while (k < 6 && g.canSee(core, {x:k + 1, y:-2 * (k + 1)})) k++;
                return k;
            },
            out = {};
        hc.app.game.rules.visionRadius = 12;
        put(0, -1, 'stone_wall');
        out.oneSide = reach();         // the other side is clear
        put(1, -1, 'stone_wall');
        out.bothSides = reach();
        put(1, -1, 'ice_wall');
        out.iceBeside = reach();       // 1 + 11 x 0.5 = 6.5: (3, -6) is 6 away
        return out;
    });
    expect(r).toEqual({oneSide:6, bothSides:0, iceBeside:3});
});

test('a broken solid leaves the floor its kind names, or the base floor', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        c.damage = [99, 99];
        // (With Attack, so the core stays where it is.)
        for (const [subtype, x] of [['boulder', 1], ['wooden_barricade', -1]]) {
            g.tiles.set(g.key(x, 0), g.makeTile(x, 0, 'solid', subtype));
            c.ap = 100;
            g.playerAttack(c, x, 0);
            const t = g.tiles.get(g.key(x, 0));
            out.push([hc.solids.get(subtype).floor, t ? [t.kind, t.subtype] : null, g.isOpen(x, 0)]);
        }
        return out;
    });
    expect(r).toEqual([['loose_stone', ['floor', 'loose_stone'], true], [null, null, true]]);
});

test('kinds of solid that extend another leave its floor too', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => ['ice_wall', 'ice_boulder', 'icicle', 'stalactite'].map(id => hc.solids.get(id).floor)))
        .toEqual(['ice', 'ice', 'ice', 'loose_stone']);
});
