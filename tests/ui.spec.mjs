import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage, button, waitForGame} from './helpers.mjs';

const settingsTitle = page => page.getByText('Settings', {exact:true}).filter({visible:true});

test('the header has every button, and End Turn ends the turn', async ({page}) => {
    await startGame(page);
    for (const name of ['End Turn', 'Move: Fixed', 'Center', 'Save', 'Export', 'Import', 'New game', 'Settings', 'Help']) {
        await expect(button(page, name)).toBeVisible();
    }
    await button(page, 'End Turn').click();
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(2);
});

test('help opens on a first visit only, loaded from data/help.txt', async ({page}) => {
    await startGame(page, {skipHelp:false});
    const title = page.getByText('How to Play', {exact:true}).filter({visible:true});
    await expect(title).toBeVisible();
    await expect(page.getByText(/Grow it into a swarm of linked pieces/)).toBeVisible();
    await button(page, 'X Close').click();
    await expect(title).toHaveCount(0);

    await page.reload();
    await waitForGame(page);
    await page.waitForTimeout(300);
    await expect(title).toHaveCount(0);

    await button(page, 'Help').click();
    await expect(title).toBeVisible();
});

test('keys are ignored while a dialog is open', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await button(page, 'Settings').click();
    await expect(settingsTitle(page)).toBeVisible();
    await page.keyboard.press('Enter');   // closes the dialog (its default button), not the turn
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('New Game shows the map\'s brief, which warns once the game has started', async ({page}) => {
    await startGame(page);
    const warning = page.getByText('Starting abandons the game in progress.').filter({visible:true});
    await button(page, 'New game').click();
    await expect(page.getByRole('textbox', {name:'Seed', exact:true}).filter({visible:true})).toBeVisible();
    await expect(warning).toHaveCount(0);
    await button(page, '✗ Cancel').click();
    
    await button(page, 'End Turn').click();
    await button(page, 'New game').click();
    await expect(warning).toBeVisible();
    await button(page, '✓ Start').click();
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('losing the core offers to play again', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.draw();
    });
    await expect(page.getByText('Core Destroyed', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Play Again').click();
    await button(page, '✓ Start').click();
    expect(await page.evaluate(() => [hc.app.game.over, hc.app.game.turn])).toEqual([false, 1]);
});

test('after losing, recentering goes to the start cell', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.cam.x = 40; hc.view.cam.y = -30;
        hc.view.draw();
    });
    await button(page, 'X Close').click();
    await button(page, 'Center').click();
    await expect.poll(() => page.evaluate(() => [hc.view.cam.x, hc.view.cam.y])).toEqual([0, 0]); // after the pan
    
    await page.evaluate(() => {hc.view.cam.x = 40; hc.view.cam.y = -30;});
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => [hc.view.cam.x, hc.view.cam.y])).toEqual([0, 0]); // after the pan
});

test('Esc cancels choosing where to place', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {hc.app.game.score = 100; hc.view.draw();});
    await page.keyboard.press('p');
    await expect(page.getByText(/Place piece: choose an empty cell/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/Place piece: choose an empty cell/)).toBeHidden();
});

test('click selects your piece; shift-click moves onto it instead', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [dx, dy] = hc.hex.dirs[1];
        g.score = 100; g.playerPlace(dx, dy, c); g.playerWait();
        g.selectedId = c.id;
        hc.app.centerOn(false);
    });
    const [dx, dy] = await page.evaluate(() => hc.hex.dirs[1]),
        pt = await cellOnPage(page, dx, dy);
    await page.mouse.click(pt[0], pt[1]);
    expect(await page.evaluate(() => hc.app.game.selectedId !== hc.app.game.playerCoreId && hc.app.game.getPlayerCore().x === 0)).toBe(true);
    await page.evaluate(() => {hc.app.game.selectedId = hc.app.game.playerCoreId;});
    await page.keyboard.down('Shift');
    await page.mouse.click(pt[0], pt[1]);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(([dx, dy]) => {const c = hc.app.game.getPlayerCore(); return c.x === dx && c.y === dy;}, [dx, dy])).toBe(true);
});

test('keyboard moves the selected piece; Enter ends the turn', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.keyboard.press('d');   // east
    expect(await page.evaluate(() => [hc.app.game.getPlayerCore().x, hc.app.game.getPlayerCore().y, hc.app.game.turn])).toEqual([1, 0, 2]);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(3);
});

test('nearing the edge of the board pans it by one hex; elsewhere it stays put', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    // The core 120px from the right edge, so one step east brings it within 100px.
    const start = await page.evaluate(() => {
        const V = hc.view;
        hc.app.centerOn(false);
        V.cam.x -= (V.W / 2 - 120) / V.cam.size;
        V.draw();
        return V.cam.x;
    });
    await page.keyboard.press('a'); // west: away from the edge, so no pan
    expect(await page.evaluate(() => hc.view.cam.x)).toBe(start);
    await page.keyboard.press('Enter');
    await page.keyboard.press('d'); // back east
    await page.keyboard.press('Enter');
    await page.keyboard.press('d'); // east, within 100px of the edge
    expect(await page.evaluate(() => hc.view.camTarget()[0])).toBe(start + 1); // panning there...
    await expect.poll(() => page.evaluate(() => hc.view.cam.x)).toBe(start + 1); // ...and there
});

test('the selection stays on a piece after it moves', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 100;
        g.playerPlace(1, 0, core);
        g.playerPlace(-1, 0, core);
        g.playerWait();
        const a = g.pieceAt(1, 0);
        g.selectedId = a.id;
        g.playerAct(a, 2, 0);
        return [g.selectedId === a.id, g.canMove(a), g.turn];
    });
    expect(r).toEqual([true, false, 2]); // a can't move again, but stays selected
});
