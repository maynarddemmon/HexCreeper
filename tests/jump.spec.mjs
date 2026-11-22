import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

/*  The core at (0, 0) and a at (1, 0) linked to it, in a new turn. Ids on window.ids. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 1000;
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
            put = (x, y, kind) => g.tiles.set(g.key(x, y), g.makeTile(x, y, kind, kind === 'solid' ? hc.cfg.TILES.clumpSolid : hc.cfg.TILES.clumpHole)),
            out = {};
        hc.cfg.LINK.range = 3;
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
        hc.cfg.LINK.range = 2;
        const out = [cells().includes('3,0'), cells().includes('2,-2'), cells().includes('-1,0')];
        hc.cfg.LINK.range = 3;
        return out;
    });
    // (3, 0) is 3 from the core; (2, -2) and (-1, 0) are within 2.
    expect(r).toEqual([false, true, true]);
});

test('a jump moves only the piece, uses a move, and it can\'t act this turn or the next; no recover', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), a = g.pieces.get(window.ids.a), out = {};
        out.jumped = g.playerJump(core, -2, 1);
        out.at = [[core.x, core.y], [a.x, a.y]];
        out.used = g.movesUsed;
        out.now = [g.canMove(core), g.canRecover(core), g.canJump(core)];
        g.playerWait();
        out.next = [g.canMove(core), g.canRecover(core), g.legalMoves(core).length];
        g.playerWait();
        out.after = g.canMove(core);
        return out;
    });
    expect(r).toEqual({jumped:true, at:[[-2, 1], [1, 0]], used:1, now:[false, false, false], next:[false, false, 0], after:true});
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

test('enemies jump: a planned jump is carried out, and the piece sits out its next turn', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            lead = g.addPiece('core', 'enemy', 0, -4),
            planSquad = g.planSquad;
        g.recomputeRanks();
        g.planSquad = () => [{id:lead.id, jump:[0, -6]}];
        g.marchSquad = () => {};
        g.enemyPhase();
        const out = {at:[lead.x, lead.y], tired:g.isTired(lead)};
        // Its next turn: the planner has nothing for it to do, and it doesn't march.
        g.turn++;
        g.planSquad = planSquad;
        const field = g.distanceField(g.piecesOf('player'));
        out.planned = g.planSquad([lead], 1, field).length;
        delete g.marchSquad;
        g.marchSquad(lead, field);
        out.marched = lead.x !== 0 || lead.y !== -6;
        g.turn++;
        out.later = g.isTired(lead);
        return out;
    });
    expect(r).toEqual({at:[0, -6], tired:true, planned:0, marched:false, later:false});
});

test('an enemy that plans its turn, kept from you by a line of holes, jumps it', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        hc.cfg.AI.planRange = 12; // the way round is long, so it would otherwise march
        for (let x = -3; x <= 3; x++) g.tiles.set(g.key(x, -2), g.makeTile(x, -2, 'hole', hc.cfg.TILES.clumpHole));
        const e = g.addPiece('core', 'enemy', core.x, core.y - 3);
        g.recomputeRanks();
        g.enemyPhase();
        return [e.y > core.y - 2, g.isTired(e)];
    });
    expect(r).toEqual([true, true]);
});
