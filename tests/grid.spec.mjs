import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

/*  Geometry checks run against the grid factory directly, so they don't depend on the
    current game's quadrant radius. */

test('6 neighbours, 1 step and 1 unit apart', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const H = hc.makeGrid(3), o = {x:0, y:0};
        return {
            count:H.dirs.length,
            dist:H.dirs.every(([dx, dy]) => H.dist(o, {x:dx, y:dy}) === 1),
            unit:H.dirs.every(([dx, dy]) => Math.abs(Math.hypot(...H.center(dx, dy)) - 1) < 1e-9)
        };
    });
    expect(r).toEqual({count:6, dist:true, unit:true});
});

test('a point inside a hex picks that hex', async ({page}) => {
    await startGame(page);
    const ok = await page.evaluate(() => {
        const H = hc.makeGrid(3);
        for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
            const [wx, wy] = H.center(q, r);
            for (const [ox, oy] of [[0, 0], [0.3, 0.1], [-0.2, 0.25], [0.1, -0.3]]) {
                const c = H.cellAtWorld(wx + ox, wy + oy);
                if (c.x !== q || c.y !== r) return false;
            }
        }
        return true;
    });
    expect(ok).toBe(true);
});

for (const k of [1, 2, 3]) {
    test(`quadrants of radius ${k} tile the plane with no gaps or overlaps`, async ({page}) => {
        await startGame(page);
        const r = await page.evaluate(k => {
            const H = hc.makeGrid(k), seen = new Map();
            let mismatch = 0;
            for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (const c of H.chunkCells(i, j)) {
                const key = c.x + ',' + c.y;
                seen.set(key, (seen.get(key) ?? 0) + 1);
                const [ci, cj] = H.chunkOf(c.x, c.y);
                if (ci !== i || cj !== j) mismatch++;
            }
            let gaps = 0;
            for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) {
                const [i, j] = H.chunkOf(q, r);
                if (!H.chunkCells(i, j).some(c => c.x === q && c.y === r)) gaps++;
            }
            const touching = H.chunkNeighbours(0, 0).every(([i, j]) => {
                const other = new Set(H.chunkCells(i, j).map(c => c.x + ',' + c.y));
                return H.chunkCells(0, 0).some(c => H.dirs.some(([dx, dy]) => other.has((c.x + dx) + ',' + (c.y + dy))));
            });
            return {size:H.chunkCells(0, 0).length, overlaps:[...seen.values()].filter(v => v !== 1).length, mismatch, gaps, touching, origin:H.chunkOf(0, 0).join()};
        }, k);
        expect(r).toEqual({size:3*k*k + 3*k + 1, overlaps:0, mismatch:0, gaps:0, touching:true, origin:'0,0'});
    });
}

test('rings: random spawn cells are exactly d steps away', async ({page}) => {
    await startGame(page);
    const ok = await page.evaluate(() => {
        const G = hc.makeGrid(3);
        for (let t = 0; t < 300; t++) {
            const d = 1 + Math.floor(Math.random()*9);
            if (G.dist(G.ring(3, -2, d), {x:3, y:-2}) !== d) return false;
        }
        return true;
    });
    expect(ok).toBe(true);
});
