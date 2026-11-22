import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putTile} from './helpers.mjs';

/*  Heal, harm and loot tiles: their subtypes' properties (EffectTiles.js). Most tests use
    subtypes of their own, so editing the game's data doesn't break them. */

// Replaces the subtypes of a kind ('heal', 'harm' or 'loot') with these.
const define = (page, kind, data) => page.evaluate(([kind, data]) => hc[kind + 's'].define(data), [kind, data]);

// A tile of the subtype at (x, y), made as the game makes them but not yet revealed.
const putHidden = (page, x, y, kind, subtype) => page.evaluate(([x, y, kind, subtype]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), g.makeTile(x, y, kind, subtype));
}, [x, y, kind, subtype]);

// The tile at (x, y), or null.
const tileAt = (page, x, y) => page.evaluate(([x, y]) => hc.app.game.tiles.get(hc.app.game.key(x, y)) ?? null, [x, y]);

// Moves the core by (dx, dy) as its move, and the turn ends (by itself, once there's
// nothing left to do, or else here).
const step = (page, dx, dy) => page.evaluate(([dx, dy]) => {
    const g = hc.app.game, c = g.getPlayerCore(), turn = g.turn,
        ok = g.playerAct(c, c.x + dx, c.y + dy);
    if (g.turn === turn) g.playerWait();
    return ok;
}, [dx, dy]);

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('the game\'s heal, harm and loot subtypes load; bad ones are refused', async ({page}) => {
    const problems = await startGame(page);
    expect(await page.evaluate(() => ['heals', 'harms', 'loots'].map(k => hc[k].list().map(s => s.id)))).toEqual([
        ['heal', 'spring', 'salve'], ['harm', 'trap', 'mine'], ['loot', 'cache']
    ]);
    await define(page, 'heal', {
        ok:{name:'ok', pool:3},
        wholeOfInfinite:{name:'a', pool:'infinite'},       // magnitude "pool" needs a pool
        noPool:{name:'b', magnitude:1},
        shape:{name:'c', pool:1, area:{radius:1, shape:'square'}},
        count:{name:'d', pool:1, duration:{count:0}},
        reveal:{name:'e', pool:1, revealMode:'soon'},
        range:{name:'f', pool:{min:3, max:2}}
    });
    expect(await page.evaluate(() => hc.heals.list().map(s => s.id))).toEqual(['ok']);
    expect(problems.errors.filter(e => /^Bad /.test(e))).toEqual(
        ['wholeOfInfinite', 'noPool', 'shape', 'count', 'reveal', 'range'].map(id => 'Bad heal ' + id)
    );
});

test('each use gives the magnitude while the pool lasts, then the tile is gone', async ({page}) => {
    await define(page, 'loot', {
        some:{name:'Some', pool:5, magnitude:2},
        endless:{name:'Endless', pool:'infinite', magnitude:3},
        twice:{name:'Twice', pool:100, magnitude:1, duration:{count:2}},
        once:{name:'Once', pool:100, magnitude:1, duration:'once'}
    });
    const run = async subtype => {
        await putTile(page, 1, 0, 'loot', subtype);
        const out = [];
        for (let i = 0; i < 3; i++) {
            const before = await page.evaluate(() => hc.app.game.scoreEarned);
            await step(page, 1, 0);
            out.push(await page.evaluate(b => hc.app.game.scoreEarned - b, before));
            await step(page, -1, 0);
        }
        const tile = await tileAt(page, 1, 0);
        return {gained:out, left:tile ? tile.pool : 'gone'};
    };
    expect(await run('some')).toEqual({gained:[2, 2, 1], left:'gone'});
    expect(await run('endless')).toEqual({gained:[3, 3, 3], left:null});
    expect(await run('twice')).toEqual({gained:[1, 1, 0], left:'gone'});
    expect(await run('once')).toEqual({gained:[1, 0, 0], left:'gone'});
    expect(await page.evaluate(() => [hc.app.game.lootOpened, hc.app.game.lootTaken])).toEqual([3, 5 + 9 + 2 + 1]);
});

test('an area: flat, ring or fade, nearest first while the pool lasts; harm hits enemies too', async ({page}) => {
    await define(page, 'loot', {
        flat:{name:'Flat', pool:4, magnitude:3, area:1},
        ring:{name:'Ring', pool:'infinite', magnitude:1, area:{radius:1, shape:'ring'}, duration:'once'},
        fade:{name:'Fade', pool:'infinite', magnitude:4, area:{radius:1, shape:'fade'}, duration:'once'}
    });
    await define(page, 'harm', {blast:{name:'Blast', pool:'infinite', magnitude:1, area:1, duration:'once'}});
    // The core at (0, 0), a at (2, 0) linked to it, and an enemy at (1, 1): the tile goes at (1, 0).
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        hc.app.game.rules.hpPer = 10;
        hc.app.game.rules.enemyHpPer = 10;
        g.score = 100;
        g.playerPlace(1, 0, c);
        g.playerPlace(2, 0, g.pieceAt(1, 0));
        g.removePiece(g.pieceAt(1, 0));
        g.pieceAt(2, 0).parentId = c.id;
        g.addPiece('core', 'enemy', 1, 1);
        g.moveMode = 'free';                // so a stays put when the core moves
        g.enemyPhase = () => {};            // and the enemy too
        g.recomputeRanks();
        for (const p of g.pieces.values()) p.hp = p.maxHp;
        g.playerWait();
    });
    const scores = () => page.evaluate(() => {
        const g = hc.app.game;
        return [g.getPlayerCore().score, g.pieceAt(2, 0).score];
    });
    const use = async subtype => {
        const before = await scores();
        await putTile(page, 1, 0, 'loot', subtype);
        await step(page, 1, 0);
        const after = await scores();
        await step(page, -1, 0);
        return after.map((s, i) => s - before[i]);
    };
    expect(await use('flat')).toEqual([3, 1]);   // the core, on it, first; a gets what's left
    expect(await use('ring')).toEqual([0, 1]);   // not the centre
    expect(await use('fade')).toEqual([4, 2]);   // 4 x 2/2, then 4 x 1/2
    await putTile(page, 1, 0, 'harm', 'blast');
    const hp = () => page.evaluate(() => {
        const g = hc.app.game;
        return [g.getPlayerCore().hp, g.pieceAt(2, 0).hp, g.pieceAt(1, 1).hp];
    });
    const before = await hp();
    await page.evaluate(() => hc.app.game.playerAct(hc.app.game.getPlayerCore(), 1, 0));
    expect((await hp()).map((h, i) => before[i] - h)).toEqual([1, 1, 1]);
});

test('reveal: instant once in sight, hidden only once entered, proximity within range even out of sight', async ({page}) => {
    await define(page, 'heal', {
        instant:{name:'Instant', pool:1},
        hidden:{name:'Hidden', pool:1, revealMode:'hidden'},
        near:{name:'Near', pool:1, revealMode:{proximity:2}}
    });
    await page.evaluate(() => {
        hc.cfg.VISION.fog = true;
        hc.app.game.rules.visionRadius = 6;
    });
    await putHidden(page, 0, -3, 'heal', 'instant');   // in sight
    await putHidden(page, 0, -9, 'heal', 'instant');   // out of sight
    await putHidden(page, 1, 0, 'heal', 'hidden');
    await putHidden(page, -3, 0, 'heal', 'near');
    // A wall between the core and (0, 2), with a "near" tile behind it.
    await putTile(page, 0, 1, 'solid', 'stone_wall');
    await putTile(page, -1, 2, 'solid', 'stone_wall');
    await putTile(page, 1, 1, 'solid', 'stone_wall');
    await putHidden(page, 0, 2, 'heal', 'near');
    const revealed = () => page.evaluate(() => {
        const g = hc.app.game;
        g.revealTiles();
        return Object.fromEntries(['0,-3', '0,-9', '1,0', '-3,0', '0,2'].map(k => [k, g.tiles.get(k)?.revealedAt != null]));
    });
    expect(await revealed()).toEqual({'0,-3':true, '0,-9':false, '1,0':false, '-3,0':false, '0,2':true});
    expect(await page.evaluate(() => hc.app.game.canSee(hc.app.game.getPlayerCore(), {x:0, y:2}))).toBe(false);
    await step(page, -1, 0);                            // within 2 of (-3, 0)
    expect((await revealed())['-3,0']).toBe(true);
    await step(page, 1, 0);
    await step(page, 1, 0);                             // onto the hidden one: found, and used
    expect(await revealed()).toMatchObject({'0,-9':false});
    expect(await page.evaluate(() => hc.app.game.tiles.has('1,0'))).toBe(false);
});

test('a magnitude shows as showMagnitude says; the pool shows with showPool', async ({page}) => {
    await define(page, 'loot', {
        near:{name:'Near', pool:9, magnitude:3, showMagnitude:{proximity:1}, showPool:true},
        secret:{name:'Secret', pool:9, magnitude:3, showMagnitude:'hidden'}
    });
    await putHidden(page, 3, 0, 'loot', 'near');
    await putHidden(page, 0, 3, 'loot', 'secret');
    const shown = () => page.evaluate(() => {
        const g = hc.app.game;
        g.revealTiles();
        return ['3,0', '0,3'].map(k => [g.tiles.get(k).revealedAt != null, g.tiles.get(k).shown]);
    });
    expect(await shown()).toEqual([[true, false], [true, false]]);
    await step(page, 1, 0);
    await step(page, 1, 0);                              // next to "near"
    expect(await shown()).toEqual([[true, true], [true, false]]);
    expect(await page.evaluate(() => hc.app.game.tileType(hc.app.game.tiles.get('3,0')).showPool)).toBe(true);
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.board.delete(g.key(c.x, c.y));
        c.x = 0;
        c.y = 2;
        g.board.set(g.key(0, 2), c.id);
    });
    await step(page, 0, 1);                              // onto "secret": used, so shown
    expect(await page.evaluate(() => hc.app.game.tiles.get('0,3').shown)).toBe(true);
});

test('a countdown runs from when the tile is revealed', async ({page}) => {
    await define(page, 'heal', {brief:{name:'Brief', pool:'infinite', magnitude:1, revealMode:{proximity:1}, duration:{countdown:2}}});
    await putHidden(page, 3, 0, 'heal', 'brief');
    for (let i = 0; i < 3; i++) await page.evaluate(() => hc.app.game.playerWait());
    expect(await tileAt(page, 3, 0)).not.toBeNull();     // not revealed, so not counting
    await step(page, 1, 0);
    await step(page, 1, 0);                              // 1 away: revealed
    const at = (await tileAt(page, 3, 0)).revealedAt;
    // Turns since it was revealed, and whether it's still there, until it's gone.
    expect(await page.evaluate(at => {
        const g = hc.app.game, out = [];
        while (g.turn - at < 3) {
            out.push([g.turn - at, g.tiles.has('3,0')]);
            g.playerWait();
        }
        return out;
    }, at)).toEqual([[1, true], [2, false]]);
});

