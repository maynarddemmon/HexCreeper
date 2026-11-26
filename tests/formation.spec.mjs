import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

// The status line, saying this.
const status = (page, text) => page.getByText(text, {exact:true}).filter({visible:true});

// An empty board that stays empty, the core at (0, 0) with seven pieces linked to it as a
// complete binary tree (the core, two below it, four below those), plenty of gold and
// moves, and animation off.
test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(),
            add = (x, y, parent) => g.addPiece('core', 'player', x, y, parent.id),
            a = add(1, 0, core), b = add(-1, 0, core);
        add(2, -1, a);
        add(2, 0, a);
        add(-2, 0, b);
        add(-2, 1, b);
        g.recomputeRanks();
        g.tileGenerator.piecesMoved = () => {};
        g.spawnGenerator.takeTurn = () => {};
        hc.cfg.ANIM.on = false;
        g.selectedId = core.id;
        hc.app.centerOn(false);
    });
});

// How many pieces there are, the most children any has, the core's rank, and whether the
// selected piece is at an end (the core, or with no children).
const shape = page => page.evaluate(() => {
    const g = hc.app.game, kids = new Map(g.piecesOf('player').map(p => [p.id, g.children(p).length]));
    return {
        pieces:g.piecesOf('player').length,
        mostKids:Math.max(...kids.values()),
        rank:g.getPlayerCore().rank,
        head:(() => {const s = g.getSelected(); return kids.get(s.id) === 0 || s.id === g.playerCoreId;})()
    };
});

test('Snake (N) gets the swarm into a single chain, the selected piece at its end', async ({page}) => {
    expect(await shape(page)).toEqual({pieces:7, mostKids:2, rank:3, head:true});
    // Lead from a piece in the middle: a, below the core.
    await page.evaluate(() => {hc.app.game.selectedId = hc.app.game.pieceAt(1, 0).id;});
    await page.keyboard.press('n');
    await expect(status(page, 'In formation.')).toBeVisible({timeout:20000});
    expect(await shape(page)).toEqual({pieces:7, mostKids:1, rank:1, head:true});
    expect(await page.evaluate(() => {
        const g = hc.app.game, s = g.getSelected();
        let n = 1;
        for (let p = s; g.parent(p); p = g.parent(p)) n++;
        return n; // from the head up the chain to the core: all of them
    })).toBe(7);
});

test('Tree (T) gets a snake back into a tree, with the highest rank for its size', async ({page}) => {
    await page.keyboard.press('n');
    await expect(status(page, 'In formation.')).toBeVisible({timeout:20000});
    expect((await shape(page)).rank).toBe(1);
    await page.keyboard.press('t');
    await expect(page.getByText(/^Getting into formation/).filter({visible:true})).toBeVisible();
    await expect(status(page, 'In formation.')).toBeVisible({timeout:30000});
    expect(await shape(page)).toEqual({pieces:7, mostKids:2, rank:3, head:true});
});

test("getting into formation stops at a key, and says so when it can't", async ({page}) => {
    await page.keyboard.press('n');
    await page.keyboard.press('Escape');
    await expect(status(page, 'In formation.')).toHaveCount(0);
    // Just the core and a piece either side of it, walled in, the one at (-1, 0) cut loose
    // (as if by that); going again takes it up too, and it has to walk round to the other,
    // which it can't.
    await page.evaluate(() => {
        const g = hc.app.game;
        for (const p of g.piecesOf('player')) if (p.id !== g.playerCoreId && Math.abs(p.x) > 1) g.removePiece(p);
        g.pieceAt(-1, 0).parentId = null;
        g.pieceAt(1, 0).parentId = g.playerCoreId;
        for (let x = -6; x <= 6; x++) {
            for (let y = -4; y <= 4; y++) {
                if (!g.pieceAt(x, y)) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
            }
        }
        g.recomputeRanks();
        g.selectedId = g.playerCoreId;
    });
    await page.keyboard.press('n');
    await expect(status(page, "Can't get into formation from here.")).toBeVisible({timeout:20000});
});
