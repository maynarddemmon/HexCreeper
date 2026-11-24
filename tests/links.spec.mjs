import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage, menuItem, openMenu} from './helpers.mjs';

/*  The core with two children, a (east) and c (west), and b linked below a, one step
    further east; then a new turn, so they can all move. Lots of score, so the turn never
    ends by itself. Puts their ids on window.ids. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 1000;
        g.playerPlace(1, 0, core);
        g.playerPlace(-1, 0, core);
        g.playerPlace(2, 0, g.pieceAt(1, 0));
        g.playerWait();
        g.score = 1000;
        window.ids = {core:core.id, a:g.pieceAt(1, 0).id, c:g.pieceAt(-1, 0).id, b:g.pieceAt(2, 0).id};
    });
};

const piece = (page, name) => page.evaluate(name => {
    const p = hc.app.game.pieces.get(window.ids[name]);
    return {x:p.x, y:p.y, parent:Object.keys(window.ids).find(n => window.ids[n] === p.parentId) ?? null, rank:p.rank};
}, name);

const turnState = page => page.evaluate(() => {
    const g = hc.app.game;
    return {movesUsed:g.movesUsed, limit:g.moveLimit()};
});

test('detaching breaks a piece\'s link, keeps what\'s below it, uses its move, and can lower ranks', async ({page}) => {
    await setUp(page);
    expect(await piece(page, 'core')).toMatchObject({rank:2});
    expect(await turnState(page)).toEqual({movesUsed:0, limit:2});
    
    expect(await page.evaluate(() => hc.app.game.playerDetach(hc.app.game.pieces.get(window.ids.a)))).toBe(true);
    expect(await piece(page, 'a')).toMatchObject({parent:null, rank:1});
    expect(await piece(page, 'b')).toMatchObject({parent:'a'});
    expect(await piece(page, 'core')).toMatchObject({rank:1});      // only one child now
    expect(await turnState(page)).toEqual({movesUsed:1, limit:1});  // and so one move a turn
    expect(await page.evaluate(() => hc.app.game.canMove(hc.app.game.pieces.get(window.ids.a)))).toBe(false);
});

test('a piece can be detached however far it is from its parent', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, b = g.pieces.get(window.ids.b);
        g.playerAct(b, 3, 0);                     // two steps from a, within link range
        g.playerWait();
        g.score = 1000;
        return [hc.hexDist(b, g.pieces.get(window.ids.a)), g.playerDetach(b)];
    });
    expect(r).toEqual([2, true]);
});

test('the core, pieces with no parent, pieces that have acted, and enemies can\'t detach', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, P = name => g.pieces.get(window.ids[name]),
            e = g.addPiece('core', 'enemy', 6, 0);
        g.addPiece('core', 'enemy', 7, 0, e.id);
        const out = [g.canDetach(P('core')), g.canDetach(g.pieceAt(7, 0))];
        g.playerAct(P('c'), -2, 0);               // c has acted
        out.push(g.canDetach(P('c')));
        g.playerDetach(P('a'));                   // a now has no parent
        out.push(g.canDetach(P('a')));
        return out;
    });
    expect(r).toEqual([false, false, false, false]);
});

test('a piece with no parent attaches to an adjacent piece of yours, using its move and raising ranks', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.playerDetach(g.pieces.get(window.ids.a));
        g.playerWait();
        g.score = 1000;
    });
    expect(await piece(page, 'core')).toMatchObject({rank:1});
    const r = await page.evaluate(() => {
        const g = hc.app.game, P = name => g.pieces.get(window.ids[name]);
        return [g.attachTargets(P('a')).map(t => Object.keys(window.ids).find(n => window.ids[n] === t.id)).sort(), g.playerAttach(P('a'), P('core'))];
    });
    expect(r).toEqual([['core'], true]); // b is adjacent, but linked below a
    expect(await piece(page, 'a')).toMatchObject({parent:'core'});
    expect(await piece(page, 'core')).toMatchObject({rank:2});
    expect(await turnState(page)).toEqual({movesUsed:1, limit:2});
});

test('no attaching to a piece linked below, a piece that isn\'t adjacent, or for a piece with a parent', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, P = name => g.pieces.get(window.ids[name]);
        const out = [g.canAttach(P('b'))];                         // b has a parent
        g.playerDetach(P('a'));
        g.playerWait();
        g.score = 1000;
        out.push(g.playerAttach(P('a'), P('b')));                  // b is linked below a
        out.push(g.playerAttach(P('a'), P('c')));                  // c is two steps away
        return out;
    });
    expect(r).toEqual([false, false, false]);
});

test('a detached piece moves freely, carrying what\'s linked below it', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, a = g.pieces.get(window.ids.a);
        hc.app.game.rules.linkRange = 1;
        const before = g.legalMoves(a).some(m => m.x === 2 && m.y === -1); // 2 from the core: out of range
        g.playerDetach(a);
        g.playerWait();
        const after = g.legalMoves(a).some(m => m.x === 2 && m.y === -1);
        g.playerAct(a, 2, -1);
        return [before, after, g.pieces.get(window.ids.b).x, g.pieces.get(window.ids.b).y];
    });
    expect(r).toEqual([false, true, 3, -1]);
});

test('B detaches the selected piece; L, then a ringed piece, attaches it', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        hc.app.game.selectedId = window.ids.a;
        hc.view.draw();
    });
    await page.keyboard.press('b');
    expect(await piece(page, 'a')).toMatchObject({parent:null});
    await page.evaluate(() => {
        const g = hc.app.game;
        g.playerWait();
        g.selectedId = window.ids.a;
        hc.view.draw();
    });
    await expect(page.getByText('Detached · level 1', {exact:false})).toBeVisible();
    await openMenu(page);
    await expect(menuItem(page, 'Detach')).toHaveClass(/\bdisabled\b/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await expect(page.getByText('Attach: click a ringed piece to link the selected piece to. Esc cancels.')).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, 0, 0));
    expect(await piece(page, 'a')).toMatchObject({parent:'core'});
});
