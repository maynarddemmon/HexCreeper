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

test('a piece\'s status effects show as icons above it, where its bars are below', async ({page}) => {
    // How many white pixels (the icon's strokes: --effect-icon) are in the square where the
    // first icon goes above the piece at (x, y) (see Render.js: drawEffects).
    // (Drawn first, and with no pan going on, so the piece is where it's looked for.)
    const whiteAbove = (x, y) => page.evaluate(([x, y]) => {
        const V = hc.view, g = hc.app.game, s = V.cam.size,
            p = g.pieceAt(x, y),
            [sx, sy] = V.cellCenter(x, y),
            size = Math.max(8, s * 0.2),
            top = sy - s * (0.37 + (p.id === g.playerCoreId ? hc.cfg.CORE_BORDER : 0)) - size,
            left = sx - s / 2;
        V.stopPan();
        V.render(performance.now());
        const d = V.canvas.getContext('2d').getImageData(Math.round(left * V.dpr), Math.round(top * V.dpr), Math.round(size * V.dpr), Math.round(size * V.dpr)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
        return n;
    }, [x, y]);
    await page.evaluate(() => {
        const g = hc.app.game;
        hc.view.cam.size = 80;
        hc.app.centerOn(false);
        g.addEffect(g.getPlayerCore(), 'exhausted', 1);
        g.addPiece('core', 'enemy', 2, 0);
        g.addEffect(g.addPiece('core', 'enemy', -2, 0), 'exhausted', 1);
    });
    // (Once its icon has loaded.)
    await expect.poll(() => whiteAbove(0, 0)).toBeGreaterThan(5);
    expect(await whiteAbove(-2, 0)).toBeGreaterThan(5);
    expect(await whiteAbove(2, 0)).toBe(0);
});

test('a muted status effect shows in the character sheet, but has no icon; a hidden one shows in neither', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), V = hc.view,
            effects = hc.effects.byId;
        effects.set('cursed', {id:'cursed', name:'Cursed', description:'', icon:'battery-low', muted:true, hidden:false});
        effects.set('marked', {id:'marked', name:'Marked', description:'', icon:'battery-low', muted:false, hidden:true});
        V.cam.size = 80;
        hc.app.centerOn(false);
        g.addEffect(c, 'cursed', 5);
        g.addEffect(c, 'marked', 5);
        g.selectedId = c.id;
    });
    // Drawn once, and time for an icon drawn there to load, then look where they would go.
    await page.evaluate(() => hc.view.render(performance.now()));
    await page.waitForTimeout(300);
    const white = await page.evaluate(() => {
        const V = hc.view, s = V.cam.size, [sx, sy] = V.cellCenter(0, 0),
            size = Math.max(8, s * 0.2),
            top = sy - s * (0.37 + hc.cfg.CORE_BORDER) - size;
        V.stopPan();
        V.render(performance.now());
        const d = V.canvas.getContext('2d').getImageData(Math.round((sx - s / 2) * V.dpr), Math.round(top * V.dpr), Math.round(size * 2 * V.dpr), Math.round(size * V.dpr)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
        return n;
    });
    expect(white).toBe(0);
    await page.keyboard.press('i');
    await expect(page.getByText('Cursed (5 more turns)', {exact:true})).toBeVisible();
    await expect(page.getByText(/Marked/)).toHaveCount(0);
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
