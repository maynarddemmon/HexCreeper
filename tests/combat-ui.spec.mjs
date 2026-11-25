import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage, putFixture} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('attacks, kills, xp and harm go into the combat log, which shows its last lines', async ({page}) => {
    const log = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.advance = false;
        g.rules.apPool = '3';               // (so the turn doesn't end in between)
        c.ap = 300;
        g.addPiece('core', 'enemy', 1, 0);
        g.rules.hitMax = 0;                 // a miss
        g.playerAct(c, 1, 0);
        g.rules.hitMax = 100;               // then a kill
        g.playerAct(c, 1, 0);
        return g.combatLog.map(({turn, ...e}) => [turn === g.turn, e]);
    });
    const you = {owner:'player', core:true}, it = {owner:'enemy', core:false};
    expect(log).toEqual([
        [true, {kind:'miss', a:you, d:it, roll:expect.any(Number), chance:0}],
        [true, {kind:'hit', a:you, d:it, roll:expect.any(Number), chance:100, dmg:1}],
        [true, {kind:'destroyed', d:it, linked:0}],
        [true, {kind:'xp', a:you, xp:4}]
    ]);
    await expect(page.getByText(/Your core hits Creeper for 1 \(\d+ vs 100%\)\./)).toBeVisible();
    await expect(page.getByText('Creeper is destroyed.')).toBeVisible();
    await expect(page.getByText('Your core gains 4 XP.')).toBeVisible();
    
    await putFixture(page, 0, 1, 'harm', {magnitude:1});
    await page.evaluate(() => hc.app.game.playerAct(hc.app.game.getPlayerCore(), 0, 1));
    expect(await page.evaluate(() => hc.app.game.combatLog.at(-1).kind)).toBe('harm');
});

test('K shows and hides the combat log, and it stays that way', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.advance = false;
        g.addPiece('core', 'enemy', 1, 0);
        g.playerAct(c, 1, 0);
    });
    const line = page.getByText('Creeper is destroyed.');
    await expect(line).toBeVisible();
    await page.keyboard.press('k');
    await expect(line).toBeHidden();
    expect(await page.evaluate(() => [hc.cfg.COMBAT_LOG, JSON.parse(localStorage.getItem('hc.prefs')).combatLog])).toEqual([false, false]);
    await page.keyboard.press('k');
    await expect(line).toBeVisible();
});

test('pointing at an enemy with your piece selected shows how each would do against the other', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game;
        g.addEffect(g.addPiece('core', 'enemy', 2, 0), 'exhausted', 2);
        g.selectedId = g.playerCoreId;
        hc.app.centerOn(false);
    });
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    // What it is, its status effects, then the odds (sure combat: see clearBoard).
    await expect(page.getByText(/^Creeper · Something .* · Exhausted \(2 more turns\) · you: 100% to hit, 1 damage · it: 100%, 1$/)).toBeVisible();
});

test('I opens the selected piece\'s character sheet', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game;
        g.selectedId = g.playerCoreId;
        g.addEffect(g.getPlayerCore(), 'exhausted', 1);
        hc.view.draw();
    });
    await page.keyboard.press('i');
    await expect(page.getByText('Your core · Level 1')).toBeVisible();
    for (const text of ['Strength', 'Charisma', 'Melee accuracy', '0/20', '1 of 1 · +1 a turn · +0 initiative', 'Exhausted (1 more turn)']) {
        await expect(page.getByText(text, {exact:true})).toBeVisible();
    }
});
