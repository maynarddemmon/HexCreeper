import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  A clear board (see clearBoard), but with the action-point rules at their defaults, and
    enemies added with none, as in play. */
test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, rules = hc.settings.resolveRules({});
        for (const id of ['apPool', 'apRecovery', 'apInitiative']) g.rules[id] = rules[id];
        delete g.addPiece;
    });
});

test('a piece\'s pool and recovery come from its stats; a new piece starts with none, and each turn they come back', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [[g.apMax(c), g.apRecovery(c)]];
        g.gold = 1000;
        c.ap = 100;
        g.playerPlace(1, 0, c);
        const a = g.pieceAt(1, 0);
        out.push([c.ap, a.ap]);
        g.playerWait();
        out.push([c.ap, a.ap]);
        g.playerWait();
        out.push([c.ap, a.ap]);
        return out;
    });
    // con 10: a pool of 2; agl 10: 0.75 back a turn, up to the pool.
    expect(r).toEqual([[200, 75], [100, 0], [175, 75], [200, 150]]);
});

test('every pool is at least a point, whatever the rule gives', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.apPool = 'con / 20';
        const out = [g.apMax(c)];
        g.rules.apPool = '0';
        c.ap = 0;
        g.recoverAp();
        out.push(g.apMax(c), c.ap);
        return out;
    });
    expect(r).toEqual([100, 100, 75]);
});

test('a piece acts as long as it has the points, and the turn ends once nothing can act', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), turn = g.turn, out = [];
        g.gold = 0;
        c.ap = 200;
        out.push(g.playerAct(c, 1, 0), c.ap, g.turn === turn);
        out.push(g.playerAct(c, 2, 0), g.turn === turn + 1, c.ap);
        return out;
    });
    expect(r).toEqual([true, 100, true, true, true, 75]);
});

test('an enemy coming into sight gets its initiative, once, and your pieces theirs, once a turn', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        c.ap = 0;
        g.initiativeTurn = null;    // (not had this turn: the enemies cleared away may have been seen)
        const gob = g.addPiece('core', 'enemy', 2, 0, null, 'goblin');
        out.push(gob.ap);
        g.noticeEnemies();
        // A goblin: (wis 8 + agl 12) / 40; you: (10 + 10) / 40.
        out.push([gob.ap, c.ap]);
        const gob2 = g.addPiece('core', 'enemy', -2, 0, null, 'goblin');
        g.noticeEnemies();
        g.noticeEnemies();
        out.push([gob.ap, gob2.ap, c.ap]);
        return out;
    });
    expect(r).toEqual([0, [50, 50], [50, 50, 50]]);
});

test('action points are saved, and the turn initiative was last given', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        c.ap = 125;
        g.initiativeTurn = g.turn;
        const data = JSON.parse(JSON.stringify(g.exportToObj()));
        g.importFromObj(data);
        return [g.getPlayerCore().ap, g.initiativeTurn === g.turn];
    });
    expect(r).toEqual([125, true]);
});
