import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, waitForGame} from './helpers.mjs';

// Plays a few turns so there's something worth saving: placed pieces, moves, tiles seen.
const playABit = page => page.evaluate(() => {
    const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
    g.score = 100;
    g.playerPlace(D[0][0], D[0][1], c);
    g.playerWait();
    g.playerWait();
    hc.view.draw();
});

// The parts of the game a save must bring back.
const snapshot = page => page.evaluate(() => {
    const g = hc.app.game,
        sorted = a => [...a].sort();
    return {
        turn:g.turn, score:g.score, over:g.over, quadRadius:hc.GRID.chunkRadius,
        pieces:[...g.pieces.values()].map(p => JSON.stringify(p)).sort(),
        tiles:[...g.tiles.values()].map(t => JSON.stringify(t)).sort(),
        visitedQuads:sorted(g.visitedQuads), seenCells:sorted(g.seenCells), borders:[...g.borders].map(String).sort(),
        coreAt:hc.app.game.pieceAt(g.playerCore.x, g.playerCore.y)?.id === g.playerCoreId,
        selectedId:g.selectedId
    };
});

const saveWithButton = async page => {
    await button(page, '✇').click();
    await button(page, '✓ Confirm').click();
    await expect(page.getByText('Save Succeeded', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Acknowledge').click();
};

test('saving with the header button, then reloading, carries on the same game', async ({page}) => {
    await startGame(page);
    await playABit(page);
    await saveWithButton(page);
    // Taken after saving: what's in sight is only worked out as the board is drawn, so
    // before then the cells seen may not be up to date yet.
    const before = await snapshot(page);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hc.save')).version)).toBe(1);

    await page.reload();
    await waitForGame(page);
    expect(await snapshot(page)).toEqual(before);
});

test('without a save, a reload starts a new game', async ({page}) => {
    await startGame(page);
    await playABit(page);
    await page.reload();
    await waitForGame(page);
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('a save that can\'t be used is cleared, with a message, and a new game starts', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {localStorage.setItem('hc.save', JSON.stringify({version:1, data:{turn:'nope'}}));});
    await page.reload();
    await waitForGame(page);
    await expect(page.getByText('Save Could Not Be Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await page.evaluate(() => [hc.app.game.turn, localStorage.getItem('hc.save')])).toEqual([1, null]);
});

test('after losing, the last save can be loaded', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await playABit(page);
    await saveWithButton(page);
    const before = await snapshot(page); // after saving, as above

    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.playerCore, 99, e);
        hc.view.draw();
    });
    await expect(page.getByText('Core Destroyed', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Load Last Save').click();
    expect(await snapshot(page)).toEqual(before);
});
