import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button} from './helpers.mjs';

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

const solid = (page, x, y) => page.evaluate(([x, y]) => {
    const g = hc.app.game;
    g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', hc.cfg.TILES.clumpSolid));
}, [x, y]);

test('fixed moves the whole subtree, so one blocked piece stops the move', async ({page}) => {
    await setUp(page);
    expect(await step(page, 1, -1, 'fixed')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]});
    await solid(page, 2, -1);  // where a would go
    expect(await step(page, 1, -1, 'fixed')).toBe(null);
});

test('follow moves the tree; a blocked piece takes the free cell nearest its place, and those after keep theirs', async ({page}) => {
    await setUp(page);
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]}); // like fixed
    await solid(page, 2, -1);
    // a can't get to (2, -1): staying keeps its link at 1; b keeps its place beside a.
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
});

test('in follow a piece leads and its parent, grandparent and their other branches follow it', async ({page}) => {
    await setUp(page);
    expect(await step(page, 1, -1, 'follow', 'a')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]});
    expect(await step(page, 1, -1, 'follow', 'b')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]});
    // The core, blocked, takes the free cell nearest its place behind a.
    await solid(page, -1, 0);
    expect(await step(page, -1, 0, 'follow', 'a')).toEqual({core:[-1, 1], a:[0, 0], b:[1, 0]});
    // A detached group follows its own top piece, not the core.
    await page.evaluate(() => {
        const g = hc.app.game;
        g.playerDetach(g.pieces.get(window.ids.a));
    });
    expect(await step(page, 1, -1, 'follow', 'b')).toEqual({core:[0, 0], a:[2, -1], b:[3, -1]});
});

test('in follow, followers treat harm tiles (armed or not) as walls; the lead may step on one', async ({page}) => {
    await setUp(page);
    const harm = (x, y, timer) => page.evaluate(([x, y, timer]) => {
        hc.app.game.tiles.set(x + ',' + y, {x, y, kind:'harm', timer});
    }, [x, y, timer]);
    await harm(2, -1, 0);                 // where a would go
    await harm(3, -1, 2);                 // where b would go: not armed yet
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
    expect(await step(page, 1, -1, 'fixed')).toEqual({core:[1, -1], a:[2, -1], b:[3, -1]}); // fixed walks onto them
    await harm(1, -1, 0);
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
    await page.evaluate(() => {hc.cfg.LINK.range = 1;});
    expect(await step(page, -1, 0, 'free')).toEqual({core:[-1, 0], a:[0, 0], b:[1, 0]}); // both dragged
    expect(await step(page, 1, -1, 'free')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]}); // a still in range
    expect(await step(page, 0, -1, 'free')).toEqual({core:[0, -1], a:[1, -1], b:[2, -1]}); // a, then b, dragged
    await solid(page, 1, -1);                                // where a would be dragged to
    expect(await step(page, 0, -1, 'free')).toBe(null);
});

test('fixed attacks with the whole group; free and follow with the piece alone', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {hc.app.game.addPiece('core', 'enemy', 3, -1);}); // where b would go
    expect(await step(page, 1, -1, 'fixed')).toEqual({hits:['b']});
    expect(await step(page, 1, -1, 'free')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[2, -1], b:[2, 0]}); // b stays clear of it
});

test('in follow only the lead breaks solids; the rest go round them', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        hc.solids.define({mud:{name:'mud', hardness:0}}, {mud_wall:{name:'Mud', composition:'mud', hp:3}});
        const g = hc.app.game;
        g.tiles.set('2,-1', g.makeTile(2, -1, 'solid', 'mud_wall'));    // where a would go
    });
    expect(await step(page, 1, -1, 'fixed')).toEqual({hits:['a']});
    expect(await step(page, 1, -1, 'follow')).toEqual({core:[1, -1], a:[1, 0], b:[2, 0]});
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
    await page.keyboard.press('m');
    await expect(button(page, 'Move: Follow')).toBeVisible();
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), done = g.playerAct(core, 1, -1),
            copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return [done, [core.x, core.y], [g.pieces.get(window.ids.a).x, g.pieces.get(window.ids.a).y], copy.moveMode];
    });
    expect(r).toEqual([true, [1, -1], [1, 0], 'follow']);
    await page.keyboard.press('m');
    await expect(button(page, 'Move: Fixed')).toBeVisible();
});

test('a game starts in the moveMode setting\'s mode', async ({page}) => {
    await setUp(page);
    expect(await page.evaluate(() => {
        hc.cfg.LINK.mode = 'free';
        hc.app.game.reset();
        return hc.app.game.moveMode;
    })).toBe('free');
});

test('a squad far off that can\'t get through keeping its shape squeezes through', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, root = g.addPiece('core', 'enemy', 20, 0), kid = g.addPiece('core', 'enemy', 20, 1, root.id);
        g.recomputeRanks();
        // Walls all round, but for the way west for the leader; the follower's way west is blocked.
        for (const [dx, dy] of hc.GRID.dirs) {
            for (const p of [root, kid]) {
                const x = p.x + dx, y = p.y + dy;
                if (!g.pieceAt(x, y) && !(x === 19 && y === 0)) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', hc.cfg.TILES.clumpSolid));
            }
        }
        const fixed = g.legalMoves(root, 'fixed').filter(m => !m.attack).length;
        g.marchSquad(root, g.distanceField(g.piecesOf('player')));
        return [fixed, [root.x, root.y], [kid.x, kid.y]];
    });
    expect(r).toEqual([0, [19, 0], [20, 0]]); // the follower steps into the leader's place
});
