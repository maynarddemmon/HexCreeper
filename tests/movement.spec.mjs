import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, putFixture} from './helpers.mjs';

/*  The core at (0, 0), a at (1, 0) linked to it, and b at (2, 0) linked to a, on an empty
    board, in a new turn. Puts their ids on window.ids. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 1000;
        g.playerPlace(1, 0, core);
        g.playerPlace(2, 0, g.pieceAt(1, 0));
        g.playerWait();
        window.ids = {core:core.id, a:g.pieceAt(1, 0).id, b:g.pieceAt(2, 0).id};
    });
};

// What stepping a piece (the core, unless named) by (dx, dy) would do in mode: null, the
// names of the pieces hit, or each named piece's position after.
const step = (page, dx, dy, mode, who = 'core') => page.evaluate(([dx, dy, mode, who]) => {
    const g = hc.app.game, names = Object.fromEntries(Object.entries(window.ids).map(([k, v]) => [v, k])),
        r = g.resolveStep(g.boardView(), window.ids[who], dx, dy, mode);
    if (!r) return null;
    if (r.attack) return {hits:r.hits.map(h => names[h.attacker.id])};
    const at = Object.fromEntries(Object.entries(window.ids).map(([n, id]) => [n, [g.pieces.get(id).x, g.pieces.get(id).y]]));
    for (const [id, x, y] of r.moves) at[names[id]] = [x, y];
    return at;
}, [dx, dy, mode, who]);

// Steps a piece (the core, unless named) by (dx, dy) in mode, for real.
const go = (page, dx, dy, mode, who = 'core') => page.evaluate(([dx, dy, mode, who]) => {
    const g = hc.app.game, p = g.pieces.get(window.ids[who]);
    return g.act(p, p.x + dx, p.y + dy, mode);
}, [dx, dy, mode, who]);

const solid = (page, x, y) => page.evaluate(([x, y]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', hc.app.game.tileGenerator.attrs.clumpSolid));
}, [x, y]);

test('fixed moves the whole subtree, so one blocked piece stops the move', async ({page}) => {
    await setUp(page);
    expect(await step(page, 1, -1, 'fixed')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]});
    await solid(page, 2, -1);  // where a would go
    expect(await step(page, 1, -1, 'fixed')).toBe(null);
});

test('in follow each piece steps where the piece it follows just was, then along its trail', async ({page}) => {
    await setUp(page);
    // a, off the core's footsteps, steps to the nearest of them: the core's old cell.
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[0, 0], b:[1, 0]});
    expect(await go(page, 1, -1, 'follow')).toBe(true);
    expect(await page.evaluate(() => hc.app.game.getPlayerCore().trail)).toEqual([[0, 0]]);
    // Now each is on the footsteps of the one ahead of it, and files along them.
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[2, -2], a:[1, -1], b:[0, 0]});
    expect(await go(page, 1, -1, 'follow')).toBe(true);
    expect(await step(page, 1, 0, 'follow')).toEqual({core:[3, -2], a:[2, -2], b:[1, -1]});
});

test('a trail is as long as the link range; a jump starts it afresh', async ({page}) => {
    await setUp(page);
    const trail = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.rules.linkRange = 2;
        for (let i = 0; i < 3; i++) g.act(core, core.x, core.y - 1, 'follow');
        const walked = core.trail.map(c => [...c]);
        g.rules.linkRange = 3;  // so the jump keeps its link to a in range
        return [walked, g.jumpPiece(core, core.x, core.y - 2), core.trail];
    });
    expect(trail).toEqual([[[0, -2], [0, -1]], true, []]);
});

test('a step that can\'t be done in follow is tried in fixed (then free)', async ({page}) => {
    await setUp(page);
    // With links of 1, a can only follow to the core's old cell, but it won't go onto
    // the harm there; in fixed it does.
    await putFixture(page, 0, 0, 'harm');
    await page.evaluate(() => {hc.app.game.rules.linkRange = 1;});
    expect(await step(page, -1, 0, 'follow')).toEqual({core:[-1, 0], a:[0, 0], b:[1, 0]});
});

test('Go to and Explore may jump in follow mode, as a last resort; you may not', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.moveMode = 'follow';
        g.rules.apPool = '2';
        core.ap = 200;    // a jump's 2 action points
        return [g.jumpTargets(core).length, g.jumpTargets(core, true).length > 0];
    });
    expect(r).toEqual([0, true]);
});

test('in follow, turning back onto your own swarm swaps with the piece you step onto', async ({page}) => {
    await setUp(page);
    // A dead end: only (0, 0) to (3, 0) are open, with the core at its end.
    await page.evaluate(() => {
        const g = hc.app.game;
        for (let x = -3; x <= 6; x++) {
            for (let y = -3; y <= 3; y++) {
                if (y !== 0 || x < 0 || x > 3) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', g.tileGenerator.attrs.clumpSolid));
            }
        }
    });
    expect(await go(page, 1, 0, 'free')).toBe(false); // a is in the way
    expect(await step(page, 1, 0, 'follow')).toEqual({core:[1, 0], a:[0, 0], b:[2, 0]});
});

test('in follow the swarm sorts itself out where a piece is behind its own children', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        // A tunnel along y = 0, the lead at (0, 0); c, linked to it, is behind its
        // children d and e, as far from the lead as a link goes.
        for (let x = -8; x <= 5; x++) {
            for (let y = -2; y <= 2; y++) {
                if (y !== 0 || x < -6 || x > 3) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
            }
        }
        g.removePiece(g.getPlayerCore());
        const lead = g.addPiece('core', 'player', 0, 0), c = g.addPiece('core', 'player', -3, 0, lead.id),
            d = g.addPiece('core', 'player', -2, 0, c.id), e = g.addPiece('core', 'player', -1, 0, c.id),
            names = new Map([[lead.id, 'lead'], [c.id, 'c'], [d.id, 'd'], [e.id, 'e']]);
        return Object.fromEntries(g.resolveStep(g.boardView(), lead.id, 1, 0, 'follow').moves.map(([id, x, y]) => [names.get(id), [x, y]]));
    });
    // All shuffle up, though c can only go once d has, and d once e has.
    expect(r).toEqual({lead:[1, 0], c:[-2, 0], d:[-1, 0], e:[0, 0]});
});

test('in follow a piece leads and its parent, grandparent and their other branches follow it', async ({page}) => {
    await setUp(page);
    // b, then the core (by then a's old cell is taken: it stays next to it).
    expect(await step(page, 1, -1, 'follow', 'a')).toEqual({core:[0, 0], a:[2, -1], b:[1, 0]});
    expect(await step(page, 1, -1, 'follow', 'b')).toEqual({core:[1, 0], a:[2, 0], b:[3, -1]});
    // a steps onto the core; b takes a's old cell, and the core steps aside.
    await solid(page, -1, 0);
    expect(await step(page, -1, 0, 'follow', 'a')).toEqual({core:[1, -1], a:[0, 0], b:[1, 0]});
    // A detached group follows its own top piece, not the core.
    await page.evaluate(() => {
        const g = hc.app.game;
        g.playerDetach(g.pieces.get(window.ids.a));
    });
    expect(await step(page, 1, -1, 'follow', 'b')).toEqual({core:[0, 0], a:[2, 0], b:[3, -1]});
});

test('in follow, followers treat harms you know of as walls; the lead may step on one', async ({page}) => {
    await setUp(page);
    const harm = (x, y) => putFixture(page, x, y, 'harm');
    await harm(0, 0);                     // where a would go, the core's old cell
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
    await harm(2, -1);
    expect(await step(page, 1, -1, 'fixed')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]}); // fixed walks onto them
    await harm(1, -1);
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]}); // the lead may
});

test('in follow a blocked piece shifts around the obstacle to keep its link length', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 1000;
        g.playerPlace(-1, 0, core);       // a, west of the core
        g.playerWait();
        window.ids = {core:core.id, a:g.pieceAt(-1, 0).id};
    });
    await solid(page, -1, 1);             // where a would go stepping C (0, 1)
    // Staying would stretch the link to 2; stepping in behind the core keeps it at 1.
    expect(await step(page, 0, 1, 'follow')).toEqual({core:[0, 1], a:[0, 0]});
    expect(await step(page, 0, 1, 'fixed')).toBe(null);
});

test('free moves only the piece, dragging along any that would be out of range', async ({page}) => {
    await setUp(page);
    expect(await step(page, 1, -1, 'free')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
    expect(await step(page, 1, 0, 'free')).toBe(null);      // a is in the way, and isn't dragged
    await page.evaluate(() => {hc.app.game.rules.linkRange = 1;});
    expect(await step(page, -1, 0, 'free')).toEqual({core:[-1, 0], a:[0, 0], b:[1, 0]}); // both dragged
    expect(await step(page, 1, -1, 'free')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]}); // a still in range
    expect(await step(page, 0, -1, 'free')).toEqual({core:[0, -1], a:[1, -1], b:[2, -1]}); // a, then b, dragged
    await solid(page, 1, -1);                                // where a would be dragged to
    expect(await step(page, 0, -1, 'free')).toBe(null);
});

test('fixed attacks with the whole group; free and follow with the piece alone', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {hc.app.game.addPiece('core', 'enemy', 3, -1);}); // where b would go in fixed
    expect(await step(page, 1, -1, 'fixed')).toEqual({hits:['b']});
    expect(await step(page, 1, -1, 'free')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[0, 0], b:[1, 0]}); // only the core could hit
});

test('in follow only the lead breaks solids; the rest go round them', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        hc.solids.define({mud:{name:'mud', hardness:0}}, {mud_wall:{name:'Mud', composition:'mud', hp:3}});
        const g = hc.app.game;
        g.tiles.set('2,-1', g.makeTile(2, -1, 'solid', 'mud_wall'));    // where a would go in fixed
    });
    expect(await step(page, 1, -1, 'fixed')).toEqual({hits:['a']});
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[0, 0], b:[1, 0]});
    expect(await step(page, 1, -1, 'follow', 'a')).toEqual({hits:['a']}); // leading, a breaks it
});

test('your moves use the chosen mode; M (or the button) cycles it, and it\'s saved', async ({page}) => {
    await setUp(page);
    await solid(page, 2, -1);
    const mode = button(page, 'Move: Fixed');
    await page.evaluate(() => {hc.view.draw();});
    await expect(mode).toBeVisible();
    expect(await page.evaluate(() => hc.app.game.playerAct(hc.app.game.getPlayerCore(), 1, -1))).toBe(false);
    await page.keyboard.press('m');
    await expect(button(page, 'Move: Follow')).toBeVisible();
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), done = g.playerAct(core, 1, -1),
            copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return [done, [core.x, core.y], [g.pieces.get(window.ids.a).x, g.pieces.get(window.ids.a).y], copy.moveMode, copy.pieces.get(core.id).trail];
    });
    expect(r).toEqual([true, [1, -1], [0, 0], 'follow', [[0, 0]]]); // the trail is saved too
    await page.keyboard.press('m');
    await expect(button(page, 'Move: Fixed')).toBeVisible();
});

test('a game starts in the moveMode setting\'s mode: Fixed or Follow (Free is for shift-clicking)', async ({page}) => {
    await setUp(page);
    expect(await page.evaluate(() => ['follow', 'free'].map(moveMode => {
        const g = hc.app.game, copy = new hc.Game();
        g.gameMap = {...g.gameMap, rules:{moveMode}};
        g.reset();
        copy.importFromObj({...JSON.parse(JSON.stringify(g.exportToObj())), moveMode});
        return [g.moveMode, copy.moveMode];
    }))).toEqual([['follow', 'follow'], ['fixed', 'fixed']]);
});

test('a squad far off that can\'t get through keeping its shape squeezes through', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, root = g.addPiece('core', 'enemy', 20, 0), kid = g.addPiece('core', 'enemy', 20, 1, root.id);
        g.recomputeRanks();
        // Walls all round, but for the way west for the leader; the follower's way west is blocked.
        for (const [dx, dy] of hc.hex.dirs) {
            for (const p of [root, kid]) {
                const x = p.x + dx, y = p.y + dy;
                if (!g.pieceAt(x, y) && !(x === 19 && y === 0)) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', hc.app.game.tileGenerator.attrs.clumpSolid));
            }
        }
        const fixed = g.legalMoves(root, 'fixed').filter(m => !m.attack).length;
        g.enemyAI.marchSquad(root, g.distanceField(g.piecesOf('player')));
        return [fixed, [root.x, root.y], [kid.x, kid.y]];
    });
    expect(r).toEqual([0, [19, 0], [20, 0]]); // the follower steps into the leader's place
});
