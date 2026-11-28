import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, openMenu, menuItem} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.statPointsPerLevel = '2';
        g.rules.xpToLevel = '20 * level';
        g.rules.maxHp = '10 + con / 2';
        g.selectedId = g.playerCoreId;
        hc.view.draw();
    });
});

// The core gains xp (in points) and reaches the next level.
const levelUp = page => page.evaluate(() => {
    const g = hc.app.game, c = g.getPlayerCore();
    g.gainXp(c, g.xpRule('xpToLevel', c) - c.xp);
});

test('a level up gives the statPointsPerLevel rule\'s stat points, of the new level', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [{...c.statPoints}];
        g.rules.statPointsPerLevel = 'level';
        g.gainXp(c, 2000);    // to level 2
        out.push({...c.statPoints});
        g.gainXp(c, 4000);    // to level 3
        out.push({...c.statPoints});
        return out;
    });
    expect(r).toEqual([{available:0, spent:0}, {available:2, spent:0}, {available:5, spent:0}]);
});

test('spending stat points raises the stats, with max HP and HP following; never more than there are, nor less than 0', async ({page}) => {
    await levelUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), e = g.addPiece('core', 'enemy', 3, 0);
        c.fixedHp = undefined;            // (clearBoard fixes it)
        c.maxHp = c.hp = g.maxHpOf(c);
        const hp = [c.hp, c.maxHp],
            refused = [
                g.spendStatPoints(c, {con:3}),
                g.spendStatPoints(c, {con:3, str:-1}),
                g.spendStatPoints(c, {luck:1}),
                g.spendStatPoints(c, {con:0.5}),
                g.spendStatPoints(e, {con:1})
            ],
            done = g.spendStatPoints(c, {con:2});
        return {hp, refused, done, con:c.stats.con, after:[c.hp, c.maxHp], points:{...c.statPoints}};
    });
    // 10 + con / 2, rounded down: 15, then 16 with con 12.
    expect(r).toEqual({hp:[15, 15], refused:[false, false, false, false, false], done:true, con:12, after:[16, 16], points:{available:0, spent:2}});
});

test('the sheet spends stat points: + and −, what would change in green, Confirm once all are in', async ({page}) => {
    await levelUp(page);
    await page.keyboard.press('h');
    const raise = stat => page.getByRole('button', {name:'Raise ' + stat}),
        lower = stat => page.getByRole('button', {name:'Lower ' + stat}),
        confirm = button(page, '✓ Confirm'),
        points = page.getByText('Available Points').locator('xpath=..');
    await expect(points).toContainText('2');
    await expect(lower('Strength')).toHaveClass(/disabled/);   // not below what it was
    await expect(confirm).toHaveClass(/disabled/);
    await raise('Strength').click();
    await raise('Strength').click();
    await expect(raise('Agility')).toHaveClass(/disabled/);    // none left
    await expect(points).toContainText('0');
    await expect(confirm).not.toHaveClass(/disabled/);
    // Strength 10, would be 12, in green; and melee accuracy (str + level) 12, would be 14.
    const green = await page.locator('span').filter({hasText:/^1[24]$/}).evaluateAll(els => els.map(e => [e.textContent, getComputedStyle(e).color]));
    expect(green.map(([t]) => t).sort()).toEqual(['12', '14']);
    expect(new Set(green.map(([, c]) => c)).size).toBe(1);
    await lower('Strength').click();
    await raise('Constitution').click();
    await confirm.click();
    expect(await page.evaluate(() => {
        const c = hc.app.game.getPlayerCore();
        return [c.stats.str, c.stats.con, c.statPoints];
    })).toEqual([11, 11, {available:0, spent:2}]);
});

test('Cancel puts the points back; without points the sheet only shows, with Close', async ({page}) => {
    await levelUp(page);
    const wil = await page.evaluate(() => hc.app.game.getPlayerCore().stats.wil);
    await page.keyboard.press('h');
    await page.getByRole('button', {name:'Raise Will'}).click();
    await button(page, '✗ Cancel').click();
    expect(await page.evaluate(() => {
        const c = hc.app.game.getPlayerCore();
        return [c.stats.wil, c.statPoints];
    })).toEqual([wil, {available:2, spent:0}]);
    await page.evaluate(() => {hc.app.game.getPlayerCore().statPoints.available = 0;});
    await page.keyboard.press('h');
    await expect(page.getByText('Available Points')).toBeHidden();
    await expect(page.getByRole('button', {name:'Raise Will'})).toBeHidden();
    await expect(button(page, '✗ Cancel')).toBeHidden();
    await button(page, 'X Close').click();
    await expect(page.getByText('Strength', {exact:true})).toBeHidden();
});

test('Character is first in the menu, and pulses while the piece has points to spend', async ({page}) => {
    await openMenu(page);
    const item = menuItem(page, 'Character');
    await expect(page.getByRole('menuitem').filter({visible:true}).first()).toHaveText('Character');
    await expect(item).not.toHaveClass(/attention/);
    await levelUp(page);
    await expect(item).toHaveClass(/attention/);
    await item.click();
    await expect(page.getByText('Available Points')).toBeVisible();
});

test('a piece of yours with points to spend has an arrow up over it, in the level up colour', async ({page}) => {
    // Level up colour pixels where the first icon above the core goes.
    const marker = () => page.evaluate(() => {
        const V = hc.view;
        V.cam.size = 80;
        hc.app.centerOn(false);
        V.stopPan();
        hc.app.game.effects = [];
        V.render(performance.now());
        const s = V.cam.size, [sx, sy] = V.cellCenter(0, 0),
            size = Math.max(8, s * 0.2),
            top = sy - s * (0.37 + hc.cfg.CORE_BORDER) - size,
            d = V.canvas.getContext('2d').getImageData(Math.round((sx - s / 2) * V.dpr), Math.round(top * V.dpr), Math.round(size * V.dpr), Math.round(size * V.dpr)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 200 && d[i + 2] < 120) n++;
        return n;
    });
    expect(await marker()).toBe(0);
    await levelUp(page);
    await page.evaluate(() => hc.view.render(performance.now()));
    await page.waitForTimeout(300);     // for the icon to load
    expect(await marker()).toBeGreaterThan(5);
});

test('a level up plays rings out from the piece, which stay on it (with its texts) as it moves', async ({page}) => {
    // A kill that levels the core up, by stepping onto the enemy: it moves on into the cell.
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), e = g.addPiece('core', 'enemy', 1, 0);
        e.xpValue = 500;
        c.xp = g.xpRule('xpToLevel', c) - 100;
        g.playerAct(c, 1, 0);
        return {at:[c.x, c.y, c.level], fx:g.effects.filter(f => f.follow != null).map(({text, levelUp, follow, core}) => ({text, levelUp, core, follows:follow === c.id}))};
    });
    expect(r.at).toEqual([1, 0, 2]);
    expect(r.fx).toEqual([
        {text:'+5 XP', levelUp:undefined, core:undefined, follows:true},
        {text:'Level 2!', levelUp:undefined, core:undefined, follows:true},
        {text:'', levelUp:true, core:true, follows:true}
    ]);
});

test('the sheet: level, XP and status across it, then stats beside combat (HP and action points in it); Close is red, as Cancel is', async ({page}) => {
    await page.evaluate(() => Object.assign(hc.app.game.rules, {apPool:'1 + con / 10', apRecovery:'0.5 + agl / 40', apInitiative:'(wis + agl) / 40'}));
    await levelUp(page);
    await page.keyboard.press('h');
    await page.getByRole('button', {name:'Raise Constitution'}).click();
    const line = label => page.getByText(label, {exact:true}).last().locator('xpath=..'), // (the sheet's, not the info panel's)
        x = label => line(label).evaluate(row => row.parentNode.getBoundingClientRect().x),
        y = label => line(label).evaluate(row => row.getBoundingClientRect().y);
    // The level is a line of its own, above XP, not in the title.
    await expect(page.getByText('Tess · Human · Urchin', {exact:true})).toBeVisible();
    await expect(line('Level')).toContainText('2');
    expect(await y('Level')).toBeLessThan(await y('XP'));
    // Action points in three lines: the pool (going up with con, beside in green), recovery
    // and initiative.
    await expect(line('Action points')).toContainText('1/2.1');
    await expect(line('Recovery')).toContainText('+0.75 a turn');
    await expect(line('Initiative')).toContainText('0.5');
    // Stats in one column, combat in the other, HP and action points with combat.
    expect(await x('Strength')).toBeLessThan(await x('HP'));
    expect(await x('HP')).toBe(await x('Action points'));
    expect(await x('HP')).toBe(await x('Melee accuracy'));
    expect(await y('Strength')).toBe(await y('Action points'));
    const color = locator => locator.evaluate(e => getComputedStyle(e).color),
        cancelColor = await color(button(page, '✗ Cancel'));
    await button(page, '✗ Cancel').click();
    await page.evaluate(() => {hc.app.game.getPlayerCore().statPoints.available = 0;});
    await page.keyboard.press('h');
    expect(await color(button(page, 'X Close'))).toBe(cancelColor);
});

test('opening the character sheet closes the menu', async ({page}) => {
    const menuOpen = () => page.evaluate(() => hc.view.menuOpen);
    await openMenu(page);
    await page.keyboard.press('h');
    await expect(page.getByText('Strength', {exact:true})).toBeVisible();
    expect(await menuOpen()).toBe(false);
    await expect(page.getByRole('menu').filter({visible:true})).toHaveCount(0);
});

test('the description can always be edited; Enter there is a new line, not Close', async ({page}) => {
    await page.keyboard.press('h');
    const description = page.getByRole('textbox', {name:'Description', exact:true});
    await description.fill('Small but fierce.');
    await description.press('Enter');
    await description.pressSequentially('Afraid of spiders.');
    await expect(button(page, 'X Close')).toBeVisible();
    expect(await page.evaluate(() => hc.app.game.getPlayerCore().description)).toBe('Small but fierce.\nAfraid of spiders.');
    await button(page, 'X Close').click();
    await page.keyboard.press('h');
    await expect(page.getByRole('textbox', {name:'Description', exact:true})).toHaveValue('Small but fierce.\nAfraid of spiders.');
});
