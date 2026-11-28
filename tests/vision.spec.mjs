import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

test.describe('fog of war', () => {
    test.beforeEach(async ({page}) => {
        await startGame(page);
        await clearBoard(page);
    });
    
    test('cells within the vision radius are in sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const sight = hc.app.game.cellsInSight(), R = hc.app.game.rules.visionRadius;
            return {edge:sight.has(R + ',0'), beyond:sight.has((R + 1) + ',0'), count:sight.size === 3*R*R + 3*R + 1};
        });
        expect(r).toEqual({edge:true, beyond:false, count:true});
    });
    
    test('solid tiles block sight but can be seen themselves', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, solid = (x, y) => g.tiles.set(g.key(x, y), {x, y, kind:'solid', timer:0});
            for (let y = -3; y <= 3; y++) solid(2, y);
            const sight = g.cellsInSight();
            return {wall:sight.has('2,0'), behind:sight.has('3,0'), farBehind:sight.has('6,0'), beside:sight.has('0,3')};
        });
        expect(r).toEqual({wall:true, behind:false, farBehind:false, beside:true});
    });
    
    test('hole tiles don\'t block sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            for (let y = -3; y <= 3; y++) g.tiles.set(g.key(2, y), {x:2, y, kind:'hole', timer:0});
            const sight = g.cellsInSight();
            return {hole:sight.has('2,0'), behind:sight.has('3,0'), farBehind:sight.has('6,0')};
        });
        expect(r).toEqual({hole:true, behind:true, farBehind:true});
    });
    
    test('a line along an edge is blocked only when both cells beside it are solid', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, solid = (x, y) => g.tiles.set(g.key(x, y), {x, y, kind:'solid', timer:0}),
                target = {x:2, y:-1}; // the line from (0,0) runs between (1,-1) and (1,0)
            solid(1, -1);
            const one = g.canSee(g.getPlayerCore(), target);
            solid(1, 0);
            return {one, both:g.canSee(g.getPlayerCore(), target)};
        });
        expect(r).toEqual({one:true, both:false});
    });
    
    test('cells stay seen once in sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            g.cellsInSight();
            hc.app.game.rules.visionRadius = 1;
            return {inSight:g.cellsInSight().has('3,0'), seen:g.seenCells.has('3,0'), neverSeen:g.seenCells.has('13,0')};
        });
        expect(r).toEqual({inSight:false, seen:true, neverSeen:false});
    });
    
    test('a squad you can see but that\'s off the board has a red arrow at the edge, pointing at its leader', async ({page}) => {
        // The canvas's colour where the arrow for cell (x, y) goes: at the edge of the
        // board (between the header and footer, which lie over it), 22px in, towards it
        // from the middle (see Render.js).
        // (Drawn first, and with no pan going on, so the arrow is where it's looked for.)
        const arrowColour = (x, y) => page.evaluate(([x, y]) => {
            const V = hc.view, {HEADER_HEIGHT, FOOTER_HEIGHT} = hc.cfg;
            V.stopPan();
            V.render(performance.now());
            const [sx, sy] = V.cellCenter(x, y), pad = 22,
                ax = Math.min(V.W - pad, Math.max(pad, sx)),
                ay = Math.min(V.H - FOOTER_HEIGHT - pad, Math.max(HEADER_HEIGHT + pad, sy));
            return [...V.canvas.getContext('2d').getImageData(Math.round(ax * V.dpr), Math.round(ay * V.dpr), 1, 1).data].join();
        }, [x, y]);
        const RED = '255,51,51,255';
        // Zoomed in, so a cell 6 away is off the board, but in sight.
        await page.evaluate(() => {
            const g = hc.app.game;
            hc.view.cam.size = hc.view.W / 6;
            hc.app.centerOn(false);
            const lead = g.addPiece('core', 'enemy', 6, 0);
            g.addPiece('core', 'enemy', 7, 0, lead.id);
            g.recomputeRanks();
        });
        expect(await page.evaluate(() => [hc.app.game.inSight(6, 0), hc.view.cellCenter(6, 0)[0] > hc.view.W])).toEqual([true, true]);
        expect(await arrowColour(6, 0)).toBe(RED);
        // Not once a piece of it is on the board,
        await page.evaluate(() => {
            const g = hc.app.game, kid = g.pieceAt(7, 0);
            g.removePiece(kid);
            g.addPiece('core', 'enemy', 1, 0, g.pieceAt(6, 0).id);
        });
        expect(await arrowColour(6, 0)).not.toBe(RED);
        // nor for a squad out of sight.
        await page.evaluate(() => {
            const g = hc.app.game;
            for (const e of g.piecesOf('enemy')) g.removePiece(e);
            g.addPiece('core', 'enemy', 0, -40);
        });
        expect(await arrowColour(0, -40)).not.toBe(RED);
        // Above the board, the arrow is under the header; and a squad behind the header
        // is off the board.
        await page.evaluate(() => {
            const g = hc.app.game;
            for (const e of g.piecesOf('enemy')) g.removePiece(e);
            g.addPiece('core', 'enemy', 2, -4);
        });
        expect(await page.evaluate(() => hc.view.cellCenter(2, -4)[1] < 0)).toBe(true);
        expect(await arrowColour(2, -4)).toBe(RED);
        const behind = await page.evaluate(() => {
            const g = hc.app.game, V = hc.view;
            for (const e of g.piecesOf('enemy')) g.removePiece(e);
            g.addPiece('core', 'enemy', 1, -2);
            // The camera moved down until the piece is half way up the header.
            V.cam.y += (V.cellCenter(1, -2)[1] - hc.cfg.HEADER_HEIGHT / 2) / V.cam.size;
            return [V.cellCenter(1, -2)[1], hc.cfg.HEADER_HEIGHT / 2];
        });
        expect(behind[0]).toBeCloseTo(behind[1], 0);
        expect(await page.evaluate(() => hc.app.game.inSight(1, -2))).toBe(true);
        expect(await arrowColour(1, -2)).toBe(RED);
    });
    
    test('an enemy\'s link to a piece out of sight shows as a stub, either way round', async ({page}) => {
        // The canvas's colour a third of the way from the cell (x, y) to (x + 1, y)
        const colourAt = async (x, y) => {
            const [ax, ay] = await cellOnPage(page, x, y), [bx, by] = await cellOnPage(page, x + 1, y);
            return page.evaluate(([px, py]) => {
                const c = hc.view.canvas, r = c.getBoundingClientRect(), dpr = hc.view.dpr;
                return [...c.getContext('2d').getImageData(Math.round((px - r.left) * dpr), Math.round((py - r.top) * dpr), 1, 1).data].join();
            }, [ax + (bx - ax) / 3, ay + (by - ay) / 3]);
        };
        await page.evaluate(() => {
            hc.app.game.rules.visionRadius = 3;
            hc.app.centerOn(false);
        });
        const floor = await colourAt(3, 0);
        // An enemy at the edge of sight, linked to one beyond it; then the other way round.
        for (const [child, parent] of [[3, 4], [4, 3]]) {
            await page.evaluate(([cx, px]) => {
                const g = hc.app.game;
                for (const e of g.piecesOf('enemy')) g.removePiece(e);
                const par = g.addPiece('core', 'enemy', px, 0);
                g.addPiece('core', 'enemy', cx, 0, par.id);
                g.recomputeRanks();
                hc.view.draw();
            }, [child, parent]);
            await expect.poll(() => colourAt(3, 0)).not.toBe(floor);
        }
    });
});

test('once the game is over, every cell seen is in sight, and every enemy shows', async ({page}) => {
    await startGame(page);
    const before = await page.evaluate(() => {
        const g = hc.app.game, sight = g.cellsInSight();
        g.addPiece('core', 'enemy', 30, 0);
        g.seenCells.add('40,0');
        return [sight.has('40,0'), sight.has('30,0'), g.seenCells.has('30,0')];
    });
    expect(before).toEqual([false, false, false]);
    await page.evaluate(() => {hc.app.game.damage(hc.app.game.getPlayerCore(), 999, null);});
    expect(await page.evaluate(() => {
        const sight = hc.app.game.cellsInSight();
        return [sight.has('40,0'), sight.has('30,0')];
    })).toEqual([true, false]);
});

test('a map sets the vision radius; fog of war can be turned off in hc.cfg', async ({page}) => {
    await startGame(page);
    await clearBoard(page); // so no random solid tile blocks the cells checked below
    expect(await page.evaluate(() => {
        hc.app.game.rules.visionRadius = 5;
        return hc.app.game.cellsInSight().has('5,0') && !hc.app.game.cellsInSight().has('6,0');
    })).toBe(true);
    expect(await page.evaluate(() => {
        hc.cfg.VISION.fog = false;
        return hc.app.game.cellsInSight();
    })).toBe(null);
});

test('a white arrow at the edge points to the map\'s origin while it\'s off the board', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const colourAt = (x, y) => page.evaluate(([x, y]) => {
        const V = hc.view, {HEADER_HEIGHT, FOOTER_HEIGHT} = hc.cfg;
        V.stopPan();
        V.render(performance.now());
        const [sx, sy] = V.cellCenter(x, y), pad = 22,
            ax = Math.min(V.W - pad, Math.max(pad, sx)),
            ay = Math.min(V.H - FOOTER_HEIGHT - pad, Math.max(HEADER_HEIGHT + pad, sy));
        return [...V.canvas.getContext('2d').getImageData(Math.round(ax * V.dpr), Math.round(ay * V.dpr), 1, 1).data].join();
    }, [x, y]);
    const WHITE = '255,255,255,255';
    expect(await colourAt(0, 0)).not.toBe(WHITE);    // (on the board: none)
    // The core, and the camera, far to the east: the origin's off the board to the west.
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.board.delete(g.key(c.x, c.y));
        c.x = 60;
        g.board.set(g.key(c.x, c.y), c.id);
        hc.app.centerOn(false);
    });
    expect(await page.evaluate(() => hc.view.cellCenter(0, 0)[0] < 0)).toBe(true);
    expect(await colourAt(0, 0)).toBe(WHITE);
});
