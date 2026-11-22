import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('moves are recorded to animate: a group step together, a jump as a jump', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.score = 100;
        g.playerPlace(1, 0, c);
        g.playerWait();
        g.motions = [];
        g.playerAct(c, 0, 1);
        const step = g.motions.map(m => [m.from, m.to, m.jump, m.t0 === g.motions[0].t0]);
        g.playerWait();
        g.motions = [];
        g.playerJump(c, -2, 1);
        return {step, jump:g.motions.map(m => [m.id === c.id, m.from, m.to, m.jump, m.dur === hc.cfg.ANIM.JUMP_MS])};
    });
    expect(r.step).toEqual(expect.arrayContaining([[[0, 0], [0, 1], false, true], [[1, 0], [1, 1], false, true]]));
    expect(r.jump).toEqual([[true, [0, 1], [-2, 1], true, true]]);
});

test('in the enemies\' turn a squad\'s actions play one after another, and squads at once', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, {MOVE_MS} = hc.cfg.ANIM;
        const a = g.addPiece('core', 'enemy', -6, -6), a2 = g.addPiece('core', 'enemy', -5, -6, a.id),
            b = g.addPiece('core', 'enemy', 6, -6);
        g.recomputeRanks();
        g.planSquad = squad => squad[0] === a
            ? [{id:a2.id, dx:1, dy:0, mode:'fixed'}, {id:a.id, dx:1, dy:0, mode:'free'}]
            : [{id:b.id, dx:-1, dy:0, mode:'fixed'}];
        hc.cfg.AI.planRange = 100;
        g.motions = [];
        g.enemyPhase();
        const t = id => g.motions.filter(m => m.id === id).map(m => m.t0);
        return {
            a2:t(a2.id).length, a:t(a.id).length, b:t(b.id).length,
            inTurn:t(a.id)[0] - t(a2.id)[0] >= MOVE_MS - 1,
            atOnce:Math.abs(t(b.id)[0] - t(a2.id)[0]) < MOVE_MS,
            track:g.track
        };
    });
    expect(r).toEqual({a2:1, a:1, b:1, inTurn:true, atOnce:true, track:null});
});

test('moving a piece again drops what of its move was still to play', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.motions = [];
        g.playerAct(c, 1, 0);
        g.recoverUsed = false;
        g.acted.clear();
        g.quickenUsed = true;
        g.playerAct(c, 2, 0);
        return g.motions.filter(m => m.id === c.id).map(m => m.to);
    });
    expect(r).toEqual([[2, 0]]);
});

test('a piece destroyed in a squad\'s later action stays drawn until then', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.score = 100;
        g.playerPlace(0, -1, c);
        const kid = g.pieceAt(0, -1);
        g.playerWait();
        kid.hp = 1;
        // The squad steps its leader, then strikes your piece with the other.
        const e = g.addPiece('core', 'enemy', 2, -3), e2 = g.addPiece('core', 'enemy', 1, -2, e.id);
        g.recomputeRanks();
        g.planSquad = () => [{id:e.id, dx:0, dy:1, mode:'free'}, {id:e2.id, dx:-1, dy:1, mode:'free'}];
        hc.cfg.AI.planRange = 100;
        g.effects = [];
        const now = performance.now();
        g.enemyPhase();
        const burst = g.effects.find(f => f.burst && f.piece?.id === kid.id);
        return {gone:!g.pieces.has(kid.id), later:burst.t0 - now >= hc.cfg.ANIM.MOVE_MS - 1};
    });
    expect(r).toEqual({gone:true, later:true});
});
