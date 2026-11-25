import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, cellOnPage, menuItem, openMenu} from './helpers.mjs';

const ITEMS = ['Place · 5', 'Swap', 'Jump', 'Attach', 'Detach', 'Heal 4 · 5', 'Go to', 'Explore', 'Snake', 'Tree'];

/*  The core at (0, 0) with a at (1, 0) linked to it, in a new turn, a selected. Pools are
    2 action points, all of it back each turn, so a can jump. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.rules.apPool = g.rules.apRecovery = '2';
        g.score = 1000;
        g.playerPlace(1, 0, core);
        g.playerWait();
        g.score = 100;
        g.selectedId = g.pieceAt(1, 0).id;
        hc.view.draw();
    });
};

const items = page => page.getByRole('menuitem').filter({visible:true});

test('clicking the selected piece again opens its menu beside it, with what it can do enabled', async ({page}) => {
    await setUp(page);
    await expect(items(page)).toHaveCount(0);
    await openMenu(page);
    await expect(items(page)).toHaveText(ITEMS);
    const disabled = await items(page).evaluateAll(els => els.map(e => e.classList.contains('disabled')));
    // A piece can go next to a; a can swap with the core, jump and be detached; it has a
    // parent, so it can't attach; nothing is hurt, so no heal. It can always go to a cell,
    // explore or get into formation.
    expect(disabled).toEqual([false, false, false, true, false, true, false, false, false, false]);
    // Beside the piece.
    const [px, py] = await cellOnPage(page, 1, 0),
        box = await page.getByRole('menu').filter({visible:true}).boundingBox();
    expect(box.x).toBeGreaterThan(px);
    expect(Math.abs(box.y + box.height / 2 - py)).toBeLessThan(box.height / 2);
});

test('the actions are no longer in the footer', async ({page}) => {
    await setUp(page);
    for (const name of ['Place · 5', 'Swap', 'Jump', 'Attach', 'Detach', 'Heal 4 · 5']) {
        await expect(button(page, name)).toHaveCount(0);
    }
});

test('a click anywhere on the board just closes the menu, as does Esc', async ({page}) => {
    await setUp(page);
    const selected = () => page.evaluate(() => hc.app.game.getSelected().id === hc.app.game.pieceAt(1, 0).id);
    await openMenu(page);
    await openMenu(page);                                        // the piece again
    await expect(items(page)).toHaveCount(0);
    await openMenu(page);
    await page.mouse.click(...await cellOnPage(page, 0, 0));    // another piece: not selected
    await expect(items(page)).toHaveCount(0);
    expect(await selected()).toBe(true);
    await openMenu(page);
    await page.mouse.click(...await cellOnPage(page, 2, -1));   // a cell a could move to: it doesn't
    await expect(items(page)).toHaveCount(0);
    expect(await page.evaluate(() => hc.app.game.pieceAt(1, 0) !== null)).toBe(true);
    await openMenu(page);
    await page.mouse.click(...await cellOnPage(page, -3, 2));   // empty board
    await expect(items(page)).toHaveCount(0);
    await openMenu(page);
    await page.keyboard.press('Escape');
    await expect(items(page)).toHaveCount(0);
});

test('picking Swap closes the menu and asks for the piece to swap with', async ({page}) => {
    await setUp(page);
    await openMenu(page);
    await menuItem(page, 'Swap').click();
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByText('Swap: click a ringed piece to swap the selected piece with. Esc cancels.')).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, 0, 0));
    expect(await page.evaluate(() => [hc.app.game.pieceAt(0, 0).id !== hc.app.game.playerCoreId, hc.app.game.getPlayerCore().x])).toEqual([true, 1]);
});

test('Heal in the menu (or H) heals starting from the selected piece', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.healActPer = 1; // 1 HP, so it shows where healing starts
        g.pieceAt(1, 0).hp = 1;
        g.getPlayerCore().hp = 1;
    });
    await openMenu(page);
    await menuItem(page, 'Heal 1 · 5').click();
    expect(await page.evaluate(() => [hc.app.game.pieceAt(1, 0).hp, hc.app.game.getPlayerCore().hp, hc.app.game.score])).toEqual([2, 1, 95]);
    await page.keyboard.press('h');
    expect(await page.evaluate(() => hc.app.game.score)).toBe(90);
});

test('Place in the menu (or P) offers only the empty cells next to the selected piece, and links the new piece to it', async ({page}) => {
    await setUp(page);
    await openMenu(page);
    await menuItem(page, 'Place · 5').click();
    await expect(page.getByText('Place piece: choose an empty cell next to the selected piece. Esc cancels.')).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, -1, 0));   // next to the core, not a: cancels
    expect(await page.evaluate(() => [hc.app.game.pieceAt(-1, 0), hc.view.placeMode])).toEqual([null, false]);
    await page.keyboard.press('p');
    await page.mouse.click(...await cellOnPage(page, 2, 0));
    expect(await page.evaluate(() => {
        const g = hc.app.game, p = g.pieceAt(2, 0);
        return p && p.parentId === g.pieceAt(1, 0).id;
    })).toBe(true);
});
