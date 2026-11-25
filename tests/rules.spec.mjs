import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
});

test('init.json5\'s rules are the defaults, under a map\'s own', async ({page}) => {
    const r = await page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
        const s = hc.settings, out = [];
        out.push(s.resolveRules({}).damageRoll === data.rules.damageRoll, hc.app.game.rules.maxHp === data.rules.maxHp);
        s.setDefaultRules({hitMin:7, nonsense:1});
        out.push(s.resolveRules({}).hitMin, s.resolveRules({hitMin:9}).hitMin, s.resolveRules({}).hitMax);
        s.setDefaultRules(data.rules);
        done(out);
    })));
    expect(r).toEqual([true, true, 7, 9, 95]);
});

test('an enemy whose profile has no xp (here, the fallback) is worth the xpValue rule\'s', async ({page}) => {
    await clearBoard(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.xpValue = '7 * level';
        return [g.addPiece('core', 'enemy', 3, 0, null, 'unknown').xpValue, g.addPiece('core', 'enemy', 5, 0, null, 'goblin').xpValue];
    })).toEqual([7, 5]);
});

test('what an action costs (a jump too) is a rule, and how long a jump exhausts a piece; a pool holds at least an action', async ({page}) => {
    await clearBoard(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.score = 0;
        g.rules.apRecovery = '0';   // (so the turn ending when it's spent gives nothing back)
        g.rules.actionCost = '0.5';
        g.rules.jumpExhaustion = '1 + con / 10';
        c.ap = 100;
        out.push(g.playerAct(c, 1, 0), g.playerAct(c, 2, 0), c.ap);
        c.ap = 100;
        out.push(g.canJump(c), g.playerJump(c, 4, 0), c.ap, g.effectOn(c, 'exhausted').countdown);
        g.rules.actionCost = '3';
        g.rules.apPool = '1';
        out.push(g.apMax(c));
        g.rules.actionCost = '0';
        out.push(g.actionCost(c));
        return out;
    })).toEqual([true, true, 0, true, true, 50, 2, 300, 10]);
});

test('the damage roll is a rule', async ({page}) => {
    await clearBoard(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.damageRoll = 'max + 2';
        g.addPiece('core', 'enemy', 1, 0);
        g.playerAct(c, 1, 0);
        return g.combatLog.find(e => e.kind === 'hit').dmg;
    })).toBe(3);
});

test('place and heal costs are formulas of your levels', async ({page}) => {
    await clearBoard(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game, out = [g.placeCost(), g.healCost(), g.healAmount()];
        g.getPlayerCore().level = 3;
        g.rules.placeCost = 'levels * 10';
        g.rules.healAmount = '0';
        out.push(g.placeCost(), g.healCost(), g.healAmount());
        return out;
    })).toEqual([5, 5, 4, 30, 15, 1]);
});
