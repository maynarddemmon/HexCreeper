import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

/*  The core at (0, 0), a at (1, 0) linked to it, b at (2, 0) linked to a, c at (-1, 0)
    linked to the core, in a new turn with plenty of score. Ids on window.ids. */
const setUp = async page => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.score = 1000;
        g.playerPlace(1, 0, core);
        g.playerPlace(2, 0, g.pieceAt(1, 0));
        g.playerPlace(-1, 0, core);
        g.playerWait();
        g.score = 1000;
        window.ids = {core:core.id, a:g.pieceAt(1, 0).id, b:g.pieceAt(2, 0).id, c:g.pieceAt(-1, 0).id};
    });
};

const at = page => page.evaluate(() => Object.fromEntries(Object.entries(window.ids).map(([n, id]) => {
    const p = hc.app.game.pieces.get(id);
    return [n, [p.x, p.y]];
})));

const P = name => `hc.app.game.pieces.get(window.ids.${name})`;

test('two adjacent pieces swap cells, keeping their links; it costs each an action point', async ({page}) => {
    await setUp(page);
    expect(await page.evaluate(`hc.app.game.playerSwap(${P('core')}, ${P('a')})`)).toBe(true);
    expect(await at(page)).toEqual({core:[1, 0], a:[0, 0], b:[2, 0], c:[-1, 0]});
    expect(await page.evaluate(() => {
        const g = hc.app.game, p = name => g.pieces.get(window.ids[name]);
        return [p('a').parentId === p('core').id, p('b').parentId === p('a').id, p('core').ap, p('a').ap, g.canMove(p('b'))];
    })).toEqual([true, true, 0, 0, true]);
});

test('no swap that would leave a link out of range, with a piece not next to it, an enemy, or a piece without the points', async ({page}) => {
    await setUp(page);
    const r = await page.evaluate(`(() => {
        const g = hc.app.game, out = [];
        hc.app.game.rules.linkRange = 1;
        out.push(g.swapTargets(${P('core')}).some(t => t.id === window.ids.a)); // a and core: b would be 2 from a
        hc.app.game.rules.linkRange = 3;
        out.push(g.swapTargets(${P('b')}).length);                           // only a is next to b
        g.addPiece('core', 'enemy', 2, -1);
        out.push(g.swapTargets(${P('b')}).some(t => t.owner === 'enemy'));
        g.playerAct(${P('c')}, -2, 0);                                        // c has spent its point
        out.push(g.swapTargets(${P('core')}).some(t => t.id === window.ids.c));
        return out;
    })()`);
    expect(r).toEqual([false, 1, false, false]);
});

test('V, then a ringed piece, swaps the selected piece with it', async ({page}) => {
    await setUp(page);
    await page.evaluate(() => {
        hc.app.game.selectedId = window.ids.b;
        hc.view.draw();
    });
    await page.keyboard.press('v');
    await page.getByText('Swap: click a ringed piece to swap the selected piece with. Esc cancels.').waitFor();
    await page.mouse.click(...await cellOnPage(page, 1, 0));
    expect(await at(page)).toEqual({core:[0, 0], a:[2, 0], b:[1, 0], c:[-1, 0]});
});

test('enemies can swap: a planned swap is carried out in their turn', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, lead = g.addPiece('core', 'enemy', 0, -3), kid = g.addPiece('core', 'enemy', 1, -3, lead.id);
        g.recomputeRanks();
        g.enemyAI.planSquad = () => [{id:lead.id, swap:kid.id}];
        g.enemyAI.marchSquad = () => {};
        g.enemyPhase();
        return [[lead.x, lead.y], [kid.x, kid.y], kid.parentId === lead.id];
    });
    expect(r).toEqual([[1, -3], [0, -3], true]);
});
