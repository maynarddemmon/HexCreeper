import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button} from './helpers.mjs';

const state = page => page.evaluate(() => {
    const g = hc.app.game;
    return {turn:g.turn, score:g.score, limit:g.moveLimit(), movesUsed:g.movesUsed, canQuicken:g.canQuicken(), quickenUsed:g.quickenUsed};
});

test('Quicken adds a move this turn, for the swarm\'s highest rank, once a turn', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.getPlayerCore().rank = 3;
        g.score = 10;
    });
    expect(await state(page)).toEqual({turn:1, score:10, limit:3, movesUsed:0, canQuicken:true, quickenUsed:false});
    expect(await page.evaluate(() => hc.app.game.playerQuicken())).toBe(true);
    expect(await state(page)).toEqual({turn:1, score:7, limit:4, movesUsed:0, canQuicken:false, quickenUsed:true});
    expect(await page.evaluate(() => hc.app.game.playerQuicken())).toBe(false);
    
    await page.evaluate(() => {hc.app.game.playerWait();});
    expect(await state(page)).toMatchObject({turn:2, limit:3, canQuicken:true, quickenUsed:false});
    
    await page.evaluate(() => {hc.app.game.score = 2;});
    expect((await state(page)).canQuicken).toBe(false); // costs 3
});

test('with Quicken and Recover, a lone core can move twice; the turn waits while Quicken could be used', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), steps = [];
        g.score = 2; // Quicken 1, Recover 1; not enough to place
        g.playerAct(core, 1, 0);
        steps.push(g.turn);                     // still 1: Quicken could still be used
        g.playerQuicken();
        g.playerRecover(core);
        g.playerAct(core, 2, 0);
        steps.push(g.turn, core.x);             // both moves used, nothing left to spend: next turn
        return steps;
    });
    expect(r).toEqual([1, 2, 2]);
});

test('the Quicken button (and U) quickens, and is disabled once used', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        hc.app.game.score = 10;
        hc.view.draw();
    });
    const quicken = button(page, 'Quicken · 1');
    await expect(quicken).not.toHaveClass(/\bdisabled\b/);
    await page.keyboard.press('u');
    expect(await state(page)).toMatchObject({score:9, limit:2, quickenUsed:true});
    await expect(quicken).toHaveClass(/\bdisabled\b/);
    await quicken.click({force:true});
    expect((await state(page)).score).toBe(9);
});

test('Quicken is saved with the game', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const kept = await page.evaluate(() => {
        const g = hc.app.game;
        g.score = 10;
        g.playerQuicken();
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return [copy.quickenUsed, copy.moveLimit()];
    });
    expect(kept).toEqual([true, 2]);
});
