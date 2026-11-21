import {test, expect} from '@playwright/test';
import {startGame, clearBoard, menuItem, openMenu} from './helpers.mjs';

/*  A lone core of the given rank (so that many moves a turn) with the given score, on an
    empty board. */
const setUp = (page, rank, score) => page.evaluate(([rank, score]) => {
    const g = hc.app.game, core = g.getPlayerCore();
    core.rank = rank;
    g.score = score;
}, [rank, score]);

const move = (page, x, y) => page.evaluate(([x, y]) => {
    const g = hc.app.game, core = g.getPlayerCore();
    return g.playerAct(core, core.x + x, core.y + y);
}, [x, y]);

const state = page => page.evaluate(() => {
    const g = hc.app.game, core = g.getPlayerCore();
    return {turn:g.turn, score:g.score, movesUsed:g.movesUsed, canMove:g.canMove(core), canRecover:g.canRecover(core), recoverUsed:g.recoverUsed};
});

test('recovering a piece that has moved lets it move again, for its rank, using one of the moves left', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 2, 10);                    // 2 moves a turn
    expect(await move(page, 1, 0)).toBe(true);
    expect(await state(page)).toEqual({turn:1, score:10, movesUsed:1, canMove:false, canRecover:true, recoverUsed:false});
    
    expect(await page.evaluate(() => hc.app.game.playerRecover(hc.app.game.getPlayerCore()))).toBe(true);
    expect(await state(page)).toEqual({turn:1, score:8, movesUsed:1, canMove:true, canRecover:false, recoverUsed:true});
    
    expect(await move(page, 1, 0)).toBe(true);   // the second, and last, move (Quicken could still add one)
    expect(await state(page)).toMatchObject({turn:1, movesUsed:2, canMove:false, canRecover:false});
    expect(await page.evaluate(() => hc.app.game.getPlayerCore().x)).toBe(2);
    await page.evaluate(() => {hc.app.game.playerWait();});
    expect(await state(page)).toMatchObject({turn:2, movesUsed:0, canMove:true, recoverUsed:false});
});

test('Recover is once a turn, needs a move left and enough score, and isn\'t for pieces that haven\'t moved', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 3, 10);
    expect((await state(page)).canRecover).toBe(false);  // hasn't moved
    await move(page, 1, 0);
    await page.evaluate(() => {hc.app.game.score = 2;});
    expect((await state(page)).canRecover).toBe(false);  // costs 3
    await page.evaluate(() => {hc.app.game.score = 100;}); // enough to place, so the turn doesn't end by itself
    await page.evaluate(() => hc.app.game.playerRecover(hc.app.game.getPlayerCore()));
    await move(page, 1, 0);
    expect(await state(page)).toMatchObject({turn:1, movesUsed:2, canRecover:false}); // used this turn
    
    // With every move used, there's nothing to recover for.
    const noMoves = await page.evaluate(() => {
        const g = hc.app.game;
        g.recoverUsed = false;
        g.movesUsed = g.moveLimit();
        return g.canRecover(g.getPlayerCore());
    });
    expect(noMoves).toBe(false);
});

test('a piece placed this turn can be recovered and move straight away', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 2, 100);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.playerPlace(1, 0, core);
        const p = g.pieceAt(1, 0), before = g.canMove(p);
        g.playerRecover(p);
        return [before, g.canMove(p), g.legalMoves(p).length > 0];
    });
    expect(r).toEqual([false, true, true]);
});

test('the turn doesn\'t end by itself while a recover could still be used', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 2, 3);       // can afford Recover (2), not Place (10)
    await move(page, 1, 0);
    expect((await state(page)).turn).toBe(1);
});

test('Recover in the menu (or R) recovers the selected piece; it\'s disabled when it can\'t be', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 2, 10);
    await openMenu(page);
    const recover = menuItem(page, 'Recover · 2');
    await expect(recover).toHaveClass(/\bdisabled\b/);       // hasn't moved
    await page.keyboard.press('Escape');
    await move(page, 1, 0);
    await openMenu(page);
    await expect(recover).not.toHaveClass(/\bdisabled\b/);
    await recover.click();
    expect(await state(page)).toMatchObject({score:8, canMove:true, recoverUsed:true});
    await expect(recover).toHaveCount(0);                     // the menu closes
    
    await page.evaluate(() => {
        const g = hc.app.game;
        g.playerWait();
        g.score = 10;
        g.playerAct(g.getPlayerCore(), 2, 0);
    });
    await page.keyboard.press('r');
    expect(await state(page)).toMatchObject({score:8, canMove:true, recoverUsed:true});
});

test('moves used and Recover are saved with the game', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await setUp(page, 3, 10);
    await move(page, 1, 0);
    await page.evaluate(() => hc.app.game.playerRecover(hc.app.game.getPlayerCore()));
    const kept = await page.evaluate(() => {
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(hc.app.game.exportToObj())));
        return [copy.movesUsed, copy.recoverUsed];
    });
    expect(kept).toEqual([1, true]);
});
