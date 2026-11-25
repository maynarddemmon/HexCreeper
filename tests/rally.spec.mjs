import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    // Pools of 2 action points, all of it back each turn; a rally costs half a point, lasts
    // 3 turns and gives back 2 HP a turn.
    await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.apPool = g.rules.apRecovery = '2';
        g.rules.rallyCost = '0.5';
        g.rules.rallyTurns = '3';
        g.rules.rallyAmount = '2';
        g.getPlayerCore().ap = 200;
    });
});

test('a hurt piece rallies for its points, and gets back HP at the end of each of the turns it lasts, up to its max', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = {};
        c.hp = c.maxHp = 10;
        out.whole = g.canRally(c);
        c.hp = 3;
        out.rallied = g.playerRally(c);
        out.after = [c.ap, c.effects.map(e => ({...e})), c.hp];
        out.again = [g.canRally(c), g.playerRally(c)];
        out.turns = [];
        for (let i = 0; i < 4; i++) {
            g.playerWait();
            out.turns.push([c.hp, g.canRally(c)]);
        }
        return out;
    });
    // 3 → 5 → 7 → 9, then over: it's hurt still, so it can rally again.
    expect(r).toEqual({
        whole:false,
        rallied:true,
        after:[150, [{id:'rallying', countdown:3}], 3],
        again:[false, false],
        turns:[[5, false], [7, false], [9, true], [9, true]]
    });
});

test('rallying stops at max HP, takes at least a turn, and needs the points', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        c.maxHp = 10;
        c.hp = 9;
        g.rules.rallyTurns = '0';
        g.playerRally(c);
        out.push(c.effects.map(e => e.countdown));
        g.playerWait();
        out.push(c.hp, c.effects.length);
        c.hp = 5;
        c.ap = 40;
        out.push(g.canRally(c));
        return out;
    });
    expect(r).toEqual([[1], 10, 0, false]);
});

test('a piece that could still rally keeps the turn from ending by itself', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), t0 = g.turn, out = [];
        c.maxHp = 10;
        c.hp = 5;
        c.ap = 50;
        g.afterPlayerAction();
        out.push(g.turn - t0);
        g.playerRally(c);
        out.push(g.turn - t0);
        return out;
    });
    expect(r).toEqual([0, 1]);
});
