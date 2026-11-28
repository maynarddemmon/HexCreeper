import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

/*  Pools of 2 action points, all of it back each turn (unless exhausted), and a jump
    exhausting a piece for a turn. */
const twoPoints = page => page.evaluate(() => {
    const g = hc.app.game;
    g.rules.apPool = g.rules.apRecovery = '2';
    g.rules.jumpExhaustion = '1';
});

/*  Every jump made, as [id, x, y], on window.jumps. */
const recordJumps = page => page.evaluate(() => {
    const g = hc.app.game, jumpPiece = g.jumpPiece;
    window.jumps = [];
    g.jumpPiece = function(p, x, y) {
        const done = jumpPiece.call(this, p, x, y);
        if (done) window.jumps.push([p.id, x, y]);
        return done;
    };
});

/*  The core at (0, 0) and a at (1, 0) linked to it, in a new turn, with 2 action points
    each. Ids on window.ids. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await twoPoints(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.setGold(1000);
        g.playerPlace(1, 0, core);
        g.playerWait();
        window.ids = {core:core.id, a:g.pieceAt(1, 0).id};
    });
};

test('a piece can jump to the twelve cells two away, over holes and pieces but not solids, onto cells it can stand on', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            core = g.getPlayerCore(),
            cells = () => g.jumpTargets(core).map(c => c.x + ',' + c.y),
            put = (x, y, kind) => g.tiles.set(g.key(x, y), g.makeTile(x, y, kind, kind === 'solid' ? hc.app.game.tileGenerator.attrs.clumpSolid : hc.app.game.tileGenerator.attrs.clumpHole)),
            out = {};
        hc.app.game.rules.linkRange = 3;
        out.all = cells().length;
        // Over a piece of yours (a, at (1, 0)) and an enemy, and over a hole.
        g.addPiece('core', 'enemy', -1, 0);
        put(0, 1, 'hole');
        out.overPieceAndHole = ['2,0', '-2,0', '0,2'].every(c => cells().includes(c));
        // Not straight over a solid; between two cells, only if one of them isn't solid.
        put(0, -1, 'solid');
        out.straightOverSolid = cells().includes('0,-2');
        out.besideOneSolid = cells().includes('1,-2');
        put(1, -1, 'solid');
        out.betweenTwoSolids = cells().includes('1,-2');
        // Not onto a hole, a solid or a piece.
        put(-2, 0, 'hole');
        put(-2, 2, 'solid');
        g.addPiece('core', 'enemy', 2, -2);
        out.onto = ['-2,0', '-2,2', '2,-2'].filter(c => cells().includes(c));
        return out;
    });
    expect(r).toEqual({all:12, overPieceAndHole:true, straightOverSolid:false, besideOneSolid:true, betweenTwoSolids:false, onto:[]});
});

test('a jump that would leave a link out of range is not allowed', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, a = g.pieces.get(window.ids.a),
            cells = () => g.jumpTargets(a).map(c => c.x + ',' + c.y);
        hc.app.game.rules.linkRange = 2;
        const out = [cells().includes('3,0'), cells().includes('2,-2'), cells().includes('-1,0')];
        hc.app.game.rules.linkRange = 3;
        return out;
    });
    // (3, 0) is 3 from the core; (2, -2) and (-1, 0) are within 2.
    expect(r).toEqual([false, true, true]);
});

test('a jump moves only the piece, costs it an action, and exhausts it', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), a = g.pieces.get(window.ids.a), out = {};
        out.jumped = g.playerJump(core, -2, 1);
        out.at = [[core.x, core.y], [a.x, a.y]];
        out.ap = [core.ap, a.ap];
        out.effects = [core.effects, a.effects];
        // With the point left it can still step or jump.
        out.now = [g.canMove(core), g.canJump(core)];
        return out;
    });
    expect(r).toEqual({jumped:true, at:[[-2, 1], [1, 0]], ap:[100, 200], effects:[[{id:'exhausted', countdown:1}], []], now:[true, true]});
});

test('an exhausted piece gets no points back at the end of the turn; each jump adds a turn of it', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), a = g.pieces.get(window.ids.a), out = [];
        // Two jumps (there and back): all its points, and two turns exhausted.
        out.push([g.playerJump(core, -2, 1), g.playerJump(core, 0, 0)]);
        const turn = () => {
            out.push([core.ap, core.effects.map(e => e.countdown), a.ap]);
            core.ap = a.ap = 0;
            g.playerWait();
        };
        turn();
        turn();
        turn();
        out.push([core.ap, core.effects.length, a.ap]);
        return out;
    });
    // The ends of its turn: none back, none back, then its 2 again; the other piece's
    // every turn.
    expect(r).toEqual([[true, true], [0, [2], 200], [0, [1], 200], [0, [], 200], [200, 0, 200]]);
});

test('no jumping in follow mode', async ({page}) => {
    await setUp(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        g.moveMode = 'follow';
        return [g.canJump(g.getPlayerCore()), g.playerJump(g.getPlayerCore(), 2, 0)];
    })).toEqual([false, false]);
});

test('J, then a highlighted cell, jumps the selected piece there', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        hc.app.game.selectedId = window.ids.core;
        hc.view.draw();
    });
    await page.keyboard.press('j');
    await page.getByText('Jump: click a highlighted cell to jump the selected piece to. Esc cancels.').waitFor();
    await page.mouse.click(...await cellOnPage(page, 0, 2));
    expect(await page.evaluate(() => {
        const core = hc.app.game.getPlayerCore();
        return [core.x, core.y, hc.view.jumpMode];
    })).toEqual([0, 2, false]);
});

test('enemies jump: a planned jump is carried out, for an action, and exhausts the piece', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await twoPoints(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            lead = g.addPiece('core', 'enemy', 0, -4),
            planSquad = g.enemyAI.planSquad;
        g.recomputeRanks();
        g.enemyAI.planSquad = () => [{id:lead.id, jump:[0, -6]}];
        g.enemyAI.marchSquad = () => {};
        g.enemyPhase();
        const out = {at:[lead.x, lead.y], ap:lead.ap, effects:lead.effects.map(e => ({...e}))};
        // Without points, the planner has nothing for it to do, and it doesn't march.
        g.enemyAI.planSquad = planSquad;
        lead.ap = 0;
        const field = g.distanceField(g.piecesOf('player'));
        out.planned = g.enemyAI.planSquad([lead], 1, field).length;
        delete g.enemyAI.marchSquad;
        g.enemyAI.marchSquad(lead, field);
        out.marched = lead.x !== 0 || lead.y !== -6;
        // Exhausted: nothing back at the end of this turn, its points at the next.
        g.recoverAp();
        g.tickEffects();
        out.later = [g.canAfford(lead), lead.effects.length];
        g.recoverAp();
        out.after = g.canAfford(lead);
        return out;
    });
    expect(r).toEqual({at:[0, -6], ap:100, effects:[{id:'exhausted', countdown:1}], planned:0, marched:false, later:[false, 0], after:true});
});

// A line of holes across the board at y = -2, from x = -w to w.
const holeLine = (page, w) => page.evaluate(w => {
    const g = hc.app.game;
    for (let x = -w; x <= w; x++) g.tiles.set(g.key(x, -2), g.makeTile(x, -2, 'hole', hc.app.game.tileGenerator.attrs.clumpHole));
}, w);

test('an enemy near you, kept from you by a long line of holes, jumps it rather than going round', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await holeLine(page, 8);
    await twoPoints(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 0, -4);
        g.recomputeRanks();
        let turns = 0;
        while (e.y < -2 && turns < 4) {
            g.enemyPhase();
            g.recoverAp();
            g.turn++;
            turns++;
        }
        return {over:e.y > -2, turns};
    });
    expect(r.over).toBe(true);
    expect(r.turns).toBeLessThanOrEqual(3);
});

test('a far squad marches over a long line of holes, one piece after another', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await holeLine(page, 12);
    await twoPoints(page);
    await recordJumps(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            lead = g.addPiece('core', 'enemy', 0, -12),
            kid = g.addPiece('core', 'enemy', 1, -12, lead.id);
        g.recomputeRanks();
        // It marches all the way (rather than stopping to strike your core once one's over).
        g.enemyAI.attrs.planRange = 0;
        let turns = 0;
        while ((lead.y < -2 || kid.y < -2) && turns < 30) {
            g.enemyPhase();
            g.recoverAp();
            g.turn++;
            turns++;
        }
        return {over:lead.y > -2 && kid.y > -2, jumped:window.jumps.length > 0, linked:kid.parentId === lead.id};
    });
    expect(r).toEqual({over:true, jumped:true, linked:true});
});

test('in open ground enemies walk rather than jump', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await twoPoints(page);
    await recordJumps(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        // A lone enemy and a squad, near (planning) and far (marching).
        g.addPiece('core', 'enemy', 0, -5);
        const far = g.addPiece('core', 'enemy', 4, -12);
        g.addPiece('core', 'enemy', 5, -12, far.id);
        g.recomputeRanks();
        for (let t = 0; t < 8; t++) {
            g.enemyPhase();
            g.recoverAp();
            g.turn++;
        }
        return window.jumps.length;
    });
    expect(r).toBe(0);
});
