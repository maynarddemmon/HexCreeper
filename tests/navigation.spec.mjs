import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

// The status line, saying this.
const status = (page, text) => page.getByText(text, {exact:typeof text === 'string'}).filter({visible:true});

// An empty board that stays empty (no more tiles are made), the core selected, the view on it.
test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.tileGenerator.piecesMoved = () => {};
        g.selectedId = g.playerCoreId;
        hc.app.centerOn(false);
    });
});

test('a route keeps off solids and harms you know of, and may go through cells you haven\'t seen', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), put = (x, y, kind, subtype) => g.tiles.set(g.key(x, y), g.makeTile(x, y, kind, subtype));
        // A wall across the way east, with a gap at (2, -2) on a harm and one at (2, 2).
        for (let y = -2; y <= 2; y++) put(2, y, 'solid', 'boulder');
        g.tiles.delete(g.key(2, -2));
        g.fixtures.set(g.key(2, -2), {...g.makeFixture(2, -2, 'harm'), revealedAt:1}); // known
        g.tiles.delete(g.key(2, 2));
        hc.cfg.VISION.fog = false;
        const around = g.routeTo(core, 4, 0),
            walled = (() => {
                put(2, 2, 'solid', 'boulder');
                put(2, -2, 'solid', 'boulder');
                for (let y = -3; y >= -12; y--) put(2, y, 'solid', 'boulder');
                for (let y = 3; y <= 12; y++) put(2, y, 'solid', 'boulder');
                return g.routeTo(core, 4, 0);
            })(),
            onSolid = g.routeTo(core, 2, 0);
        // With fog: a cell far off you haven't seen can be routed to, through the unknown.
        hc.cfg.VISION.fog = true;
        g.cellsInSight();
        const unseen = g.routeTo(core, 0, 30);
        return {
            around:around?.at(-1), viaGap:around?.some(([x, y]) => x === 2 && y === 2), offHarm:!around?.some(([x, y]) => x === 2 && y === -2),
            walled:walled === null || walled.length > 20, onSolid, unseen:unseen?.at(-1)
        };
    });
    expect(r).toEqual({around:[4, 0], viaGap:true, offHarm:true, walled:true, onSolid:null, unseen:[0, 30]});
});

test('a route goes through the piece\'s own swarm, which makes way, but not other pieces', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        hc.cfg.VISION.fog = false;
        g.setGold(1000);
        // A tunnel east from the core, with a piece of its swarm in it.
        for (let x = -2; x <= 6; x++) {
            for (let y = -2; y <= 2; y++) {
                if (y !== 0 || x < 0) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
            }
        }
        g.playerPlace(1, 0, core);
        g.playerWait();
        const through = g.routeTo(core, 4, 0),
            moved = g.playerAct(core, 1, 0, 'follow') && [g.pieceAt(0, 0) && g.pieceAt(0, 0).id !== core.id, core.x];
        // A detached piece of yours, or an enemy, blocks it.
        g.playerWait();
        g.playerDetach(g.pieceAt(0, 0));
        const detached = g.routeTo(g.pieceAt(0, 0), 4, 0);
        return {through:through?.length, moved, detached};
    });
    expect(r).toEqual({through:4, moved:[true, 1], detached:null});
});

test('exploring heads for the nearest cell you\'ve seen next to one you haven\'t', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.cellsInSight();
        const route = g.exploreRoute(core), [x, y] = route.at(-1);
        return {
            seen:g.seenCells.has(g.key(x, y)),
            edge:hc.hex.dirs.some(([dx, dy]) => !g.seenCells.has(g.key(x + dx, y + dy))),
            steps:route.length === hc.hexDist({x, y}, core)
        };
    });
    expect(r).toEqual({seen:true, edge:true, steps:true});
});

test('Go to: G, then a cell; the piece goes there a step a turn, its swarm following, and stops there', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.setGold(100);
        g.playerPlace(-1, 0, core);
        g.playerWait();
        g.selectedId = core.id;
        hc.view.draw();
    });
    await page.keyboard.press('g');
    await expect(status(page, /^Go to: click/)).toBeVisible();
    await page.mouse.click(...await cellOnPage(page, 3, 0));
    await expect(status(page, 'Arrived.')).toBeVisible({timeout:10000});
    expect(await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore(), other = g.piecesOf('player').find(p => p !== core);
        return {core:[core.x, core.y], follows:hc.hexDist(core, other) === 1, turn:g.turn};
    })).toEqual({core:[3, 0], follows:true, turn:4}); // turns 2 and 3 ended after the first two steps
    // Pointing at another cell then says what's there.
    await page.mouse.move(...await cellOnPage(page, 1, -2));
    await expect(status(page, 'Stone floor · Plain stone.')).toBeVisible();
    await expect(status(page, 'Arrived.')).toHaveCount(0);
});

// Rows of cells (the 2nd and 4th shifted right): O open, S solid; A leads, B and C are
// linked to it, D to C. C is as far from A as a link goes, and can only close up through
// the open cell below it, so A can't step straight down (south). Below is open ground.
const tangle = page => page.evaluate(() => {
    const g = hc.app.game, rows = ['ODCSS', 'SOSS', 'OSOOS', 'OOBA'], at = {};
    for (let y = -3; y < 12; y++) {
        for (let x = -6; x <= 8; x++) {
            const ch = rows[y]?.[x + (y - (y & 1)) / 2] ?? (y < 3 ? 'S' : 'O');
            if (ch === 'S') g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
            else if (ch !== 'O') at[ch] = [x, y];
            if (y < 6) g.seenCells.add(g.key(x, y));
        }
    }
    g.removePiece(g.getPlayerCore());
    const A = g.addPiece('core', 'player', ...at.A),
        C = g.addPiece('core', 'player', ...at.C, A.id);
    g.addPiece('core', 'player', ...at.B, A.id);
    g.addPiece('core', 'player', ...at.D, C.id);
    g.playerCoreId = A.id;
    g.selectedId = A.id;
    g.tileGenerator.piecesMoved = () => {};
    hc.app.centerOn(false);
    window.A = A;
});

test('Go to untangles a swarm that can\'t follow it straight on', async ({page}) => {
    await page.evaluate(() => {hc.cfg.VISION.fog = false;});
    await tangle(page);
    expect(await page.evaluate(() => hc.app.game.resolveStep(hc.app.game.boardView(), window.A.id, 0, 1, 'follow'))).toBe(null);
    await page.keyboard.press('g');
    await page.mouse.click(...await cellOnPage(page, 2, 7));
    await expect(status(page, 'Arrived.')).toBeVisible({timeout:10000});
});

test('Explore untangles it too', async ({page}) => {
    await page.evaluate(() => {hc.cfg.VISION.fog = true;});
    await tangle(page);
    await page.keyboard.press('o');
    await expect.poll(() => page.evaluate(() => hc.hexDist(window.A, {x:2, y:3})), {timeout:10000}).toBeGreaterThan(3);
    await expect(status(page, 'The way is blocked.')).toHaveCount(0);
});

test('going stops when an enemy comes into view, or one of your pieces is hurt', async ({page}) => {
    const go = async () => {
        await page.keyboard.press('g');
        await page.mouse.click(...await cellOnPage(page, 3, 0));
    };
    // An enemy just out of sight to the east: one step east brings it into view.
    await page.evaluate(() => {
        const g = hc.app.game, R = g.rules.visionRadius;
        g.addPiece('core', 'enemy', R + 1, 0);
        g.enemyAI.takeTurn = () => {};
        hc.view.draw();
    });
    await go();
    await expect(status(page, 'Stopped: an enemy came into view.')).toBeVisible({timeout:10000});
    expect(await page.evaluate(() => hc.app.game.getPlayerCore().x)).toBe(1);
    // A hidden trap on the way.
    await page.evaluate(() => {
        const g = hc.app.game;
        for (const e of g.piecesOf('enemy')) g.removePiece(e);
        g.fixtures.set(g.key(2, 0), g.makeFixture(2, 0, 'trap'));
        g.getPlayerCore().hp = g.getPlayerCore().maxHp = 10;
        hc.view.draw();
    });
    await go();
    await expect(status(page, 'Stopped: one of your pieces was hurt.')).toBeVisible({timeout:10000});
    expect(await page.evaluate(() => hc.app.game.getPlayerCore().x)).toBe(2);
});

test('Explore: O sends the piece off a step a turn; a key stops it and does nothing else', async ({page}) => {
    const start = await page.evaluate(() => hc.app.game.turn);
    await page.keyboard.press('o');
    await expect.poll(() => page.evaluate(() => hc.app.game.turn), {timeout:10000}).toBeGreaterThan(start + 1);
    await expect(status(page, /^Exploring/)).toBeVisible();
    await page.keyboard.press('d');
    const [turn, at] = await page.evaluate(() => [hc.app.game.turn, [hc.app.game.getPlayerCore().x, hc.app.game.getPlayerCore().y]]);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => [hc.app.game.turn, [hc.app.game.getPlayerCore().x, hc.app.game.getPlayerCore().y]])).toEqual([turn, at]);
    await expect(status(page, /^Exploring/)).toHaveCount(0);
    expect(at).not.toEqual([0, 0]);
});

test('with nothing left to see, exploring says so', async ({page}) => {
    await page.evaluate(() => {hc.cfg.VISION.fog = false;});
    await page.keyboard.press('o');
    await expect(status(page, 'There\'s nothing more to explore nearby.')).toBeVisible();
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});
