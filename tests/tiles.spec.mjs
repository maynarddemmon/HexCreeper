import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test('solids and holes go out to the vision radius; heal and harm tiles only 1 quadrant out', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        // Vision radius 12 and quadrant radius 3: terrain out to ceil(12 / 11) = 2 quadrants
        // from the start, a hexagon of 19; heal and harm tiles in the start quadrant and its 6
        // neighbours.
        hc.cfg.QUAD.radius = 3;
        hc.app.game.reset();
        const g = hc.app.game, n = 7, tiles = [...g.tiles.values()].filter(t => t.kind === 'heal' || t.kind === 'harm'),
            inReach = tiles.every(t => {
                const [i, j] = hc.GRID.chunkOf(t.x, t.y);
                return hc.GRID.dist({x:i, y:j}, {x:0, y:0}) <= 1; // quadrants are laid out like cells
            });
        return {terrainQuads:g.terrainQuads.size, tiledQuads:g.tiledQuads.size, heal:tiles.filter(t => t.kind === 'heal').length === n,
            harm:tiles.filter(t => t.kind === 'harm').length === n, inReach, timers:tiles.every(t => t.timer >= 2 && t.timer <= 8)};
    });
    expect(r).toEqual({terrainQuads:19, tiledQuads:7, heal:true, harm:true, inReach:true, timers:true});
});

// Each kind is checked with the other turned off, since holes may replace solid tiles.
for (const [kind, max, other] of [['solid', 5, 'hole'], ['hole', 3, 'solid']]) {
    test(`each quadrant gets one connected clump of 0-${max} ${kind} tiles, there at once`, async ({page}) => {
        await startGame(page);
        const r = await page.evaluate(([kind, max, other]) => {
            const g = hc.app.game, G = hc.GRID, sizes = new Set();
            hc.cfg.TILES[other + 'Max'] = 0;
            let ok = true;
            for (let i = 0; i < 40; i++) {
                g.tiles.clear();
                g.terrainQuads.delete('0,0');
                g.generateTerrain(0, 0);
                const clump = [...g.tiles.values()].filter(t => t.kind === kind),
                    keys = new Set(clump.map(t => g.key(t.x, t.y)));
                sizes.add(clump.length);
                if (clump.length > max || g.tiles.size !== clump.length || clump.some(t => t.timer !== 0 || G.chunkOf(t.x, t.y).join() !== '0,0')) ok = false;
                // Connected: everything is reachable from the first one.
                const seen = new Set(), todo = clump.slice(0, 1);
                for (const t of todo) {
                    const k = g.key(t.x, t.y);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    for (const [dx, dy] of G.dirs) if (keys.has(g.key(t.x + dx, t.y + dy))) todo.push({x:t.x + dx, y:t.y + dy});
                }
                if (seen.size !== clump.length) ok = false;
            }
            return {ok, varies:sizes.size > 1};
        }, [kind, max, other]);
        expect(r).toEqual({ok:true, varies:true});
    });
}

// Sets up regenerating quadrant (0,0) with only border walls (no random clumps, no core),
// walling every border whose neighbour isn't made yet. Helpers go on window.walls.
const wallsOnly = page => page.evaluate(() => {
    const g = hc.app.game, G = hc.GRID, T = hc.cfg.TILES,
        cells = G.chunkCells(0, 0);
    T.solidMax = T.holeMax = 0;
    T.wallChance = 100;
    T.wallHoleChance = 0;
    g.removePiece(g.playerCore);
    window.walls = {
        // Makes quadrant (0,0) again, after the quadrants in `first`.
        regenerate: (first = []) => {
            g.tiles.clear();
            g.terrainQuads.clear();
            g.borders.clear();
            for (const [i, j] of first) g.generateTerrain(i, j);
            g.generateTerrain(0, 0);
        },
        border: (i, j) => cells.filter(c => G.dirs.some(([dx, dy]) => G.chunkKey(c.x + dx, c.y + dy) === i + ',' + j)),
        // A border's cells less its two corners, which other borders share.
        inner: (i, j) => cells.filter(c => {
            const outside = G.dirs.map(([dx, dy]) => G.chunkKey(c.x + dx, c.y + dy)).filter(k => k !== '0,0');
            return outside.length && outside.every(k => k === i + ',' + j);
        }),
        solid: c => g.tiles.get(g.key(c.x, c.y))?.kind === 'solid'
    };
});

test('a wall closes each border but for a door of 1 or 2 cells, reachable from inside', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, G = hc.GRID, {regenerate, border, solid} = window.walls,
            inQuad = new Set(G.chunkCells(0, 0).map(c => g.key(c.x, c.y)));
        let ok = true;
        for (let t = 0; t < 20; t++) {
            regenerate();
            // Everything reachable from the middle without leaving the quadrant.
            const seen = new Set(['0,0']), todo = [{x:0, y:0}];
            for (const c of todo) {
                for (const [dx, dy] of G.dirs) {
                    const n = {x:c.x + dx, y:c.y + dy}, k = g.key(n.x, n.y);
                    if (inQuad.has(k) && !seen.has(k) && !solid(n)) {
                        seen.add(k);
                        todo.push(n);
                    }
                }
            }
            for (const [i, j] of G.chunkNeighbours(0, 0)) {
                const open = border(i, j).filter(c => !solid(c));
                if (open.length < 1 || open.length > 2 || !open.every(c => seen.has(g.key(c.x, c.y)))) ok = false;
            }
        }
        return ok;
    });
    expect(r).toBe(true);
});

test('a border is walled only by the first of its two quadrants to be made', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const {regenerate, border, inner, solid} = window.walls,
            [[i, j], ...others] = hc.GRID.chunkNeighbours(0, 0);
        regenerate([[i, j]]); // its wall is on its own side
        return {made:inner(i, j).some(solid), others:others.every(([a, b]) => border(a, b).some(solid))};
    });
    expect(r).toEqual({made:false, others:true});
});

test('door widths come from the settings; walls with no door never close a quadrant in', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const {regenerate, inner, solid} = window.walls, T = hc.cfg.TILES, G = hc.GRID,
            openPerBorder = () => G.chunkNeighbours(0, 0).map(([i, j]) => inner(i, j).filter(c => !solid(c)).length).sort();
        T.doorMin = T.doorMax = 3;
        regenerate();
        const three = openPerBorder();
        T.doorMin = T.doorMax = 0;
        regenerate();
        return {three, none:openPerBorder()};
    });
    // With six walls and no doors, the last wall made gets a door of 1.
    expect(r).toEqual({three:[3, 3, 3, 3, 3, 3], none:[0, 0, 0, 0, 0, 1]});
});

test('a share of walls are holes', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = hc.cfg.TILES;
        T.wallHoleChance = 100;
        window.walls.regenerate();
        const kinds = new Set([...g.tiles.values()].map(t => t.kind));
        return [...kinds];
    });
    expect(r).toEqual(['hole']);
});

test('no walls at a 0% chance', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        hc.cfg.TILES.wallChance = 0;
        window.walls.regenerate();
        return hc.app.game.tiles.size;
    });
    expect(r).toBe(0);
});

test('holes are placed after solid tiles and may replace them', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = hc.cfg.TILES, free = hc.GRID.chunkCells(0, 0).length - 1; // less the core's
        T.wallChance = 0;
        T.solidMin = T.solidMax = 1000; // every free cell of the quadrant
        T.holeMin = T.holeMax = 3;
        g.tiles.clear();
        g.terrainQuads.delete('0,0');
        g.generateTerrain(0, 0);
        const kinds = [...g.tiles.values()].map(t => t.kind);
        return {holes:kinds.filter(k => k === 'hole').length, solids:kinds.filter(k => k === 'solid').length === free - 3};
    });
    expect(r).toEqual({holes:3, solids:true});
});

test.describe('rules', () => {
    test.beforeEach(async ({page}) => {
        await startGame(page);
        await clearBoard(page);
    });
    
    test('a harm tile hurts whoever moves onto it, then is gone', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore, d = hc.GRID.dirs[0];
            g.tiles.set(g.key(d[0], d[1]), {x:d[0], y:d[1], kind:'harm', timer:0});
            const hp = c.hp;
            g.playerAct(c, d[0], d[1]);
            return {lost:hp - c.hp, gone:!g.tiles.has(g.key(d[0], d[1]))};
        });
        expect(r).toEqual({lost:1, gone:true});
    });
    
    for (const kind of ['solid', 'hole']) test(`nothing can move onto or be placed on a ${kind} tile`, async ({page}) => {
        const r = await page.evaluate(kind => {
            const g = hc.app.game, c = g.playerCore, [a, b] = hc.GRID.dirs,
                block = (x, y) => g.tiles.set(g.key(x, y), {x, y, kind, timer:0});
            g.score = 100;
            block(a[0], a[1]);
            const out = {
                move:g.playerAct(c, a[0], a[1]),
                place:g.placeCells().some(q => q.x === a[0] && q.y === a[1]) || g.playerPlace(a[0], a[1], c)
            };
            
            // A group can't move if any member would land on one.
            g.tiles.clear();
            g.playerPlace(a[0], a[1], c);
            block(a[0] + b[0], a[1] + b[1]);
            out.groupMove = g.playerAct(c, b[0], b[1]);
            out.coreStayed = c.x === 0 && c.y === 0;
            return out;
        }, kind);
        expect(r).toEqual({move:false, place:false, groupMove:false, coreStayed:true});
    });
    
    test('countdown tiles are inert until they arm, then act on a piece standing there', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore;
            g.tiles.set(g.key(0, 0), {x:0, y:0, kind:'harm', timer:2});
            const inert = !g.isHarm(0, 0);
            g.playerWait(); const after1 = c.hp;
            g.playerWait(); const after2 = c.hp;
            return {inert, after1, after2, gone:!g.tiles.has(g.key(0, 0))};
        });
        expect(r).toEqual({inert:true, after1:2, after2:1, gone:true});
    });
    
    test('heal value drops as nearby quadrants are visited', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            const v0 = g.healValue(0, 0);
            for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);
            return {v0, v1:g.healValue(0, 0)};
        });
        expect(r.v0).toBe(4); // 6 unvisited neighbours: floor(6/2) + 1
        expect(r.v1).toBe(1);
    });
    
    test('harm tiles stay once every neighbouring quadrant is visited', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, d = hc.GRID.dirs[0];
            g.tiles.set(g.key(d[0], d[1]), {x:d[0], y:d[1], kind:'harm', timer:0});
            for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);
            g.updateQuadrants();
            return g.isHarm(d[0], d[1]);
        });
        expect(r).toBe(true);
    });
    
    test('healing flows up to a damaged ancestor first, then down; leftovers become score', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
            g.score = 1000;
            g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
            const a = g.pieceAt(D[0][0], D[0][1]);
            const kids = g.placeCells().filter(q => hc.hexDist(q, a) === 1 && hc.hexDist(q, c) > 1).slice(0, 2);
            for (const q of kids) g.playerPlace(q.x, q.y, a);
            const leaf = g.pieceAt(kids[0].x, kids[0].y);
            for (const p of g.piecesOf('player')) p.hp = p.maxHp;
            c.hp = c.maxHp - 1; leaf.hp = leaf.maxHp - 1;
            g.applyHeal(a, 1, true);
            const oneUp = c.hp === c.maxHp && leaf.hp === leaf.maxHp - 1;
            c.hp -= 1;
            g.applyHeal(a, 2, true);
            const upAndDown = c.hp === c.maxHp && leaf.hp === leaf.maxHp;
            const s0 = g.score;
            g.applyHeal(a, 3, true);
            return {oneUp, upAndDown, leftover:g.score - s0};
        });
        expect(r).toEqual({oneUp:true, upAndDown:true, leftover:3});
    });
    
    test('eating n heal tiles in one move makes each worth n times', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
            g.score = 100;
            g.playerPlace(D[0][0], D[0][1], c);
            g.playerWait();
            const a = g.pieceAt(D[0][0], D[0][1]), m = D[2];
            for (const p of [c, a]) g.tiles.set(g.key(p.x + m[0], p.y + m[1]), {x:p.x + m[0], y:p.y + m[1], kind:'heal', timer:0});
            for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);   // value 1 each
            const s0 = g.score;
            g.playerAct(c, c.x + m[0], c.y + m[1]);
            return g.score - s0;   // both at full HP: 2 tiles x 2 = 4 score
        });
        expect(r).toBe(4);
    });
    
    test('the paid heal costs 5 x core rank, heals core rank, and wastes leftovers', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
            g.score = 100;
            g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
            const cost = g.healCost(), amount = g.healAmount();
            c.hp = c.maxHp - 1;
            const s0 = g.score, t0 = g.turn;
            g.playerHeal(c);
            return {cost, amount, paid:s0 - g.score, full:c.hp === c.maxHp, sameTurn:g.turn === t0, again:g.playerHeal(c)};
        });
        expect(r).toEqual({cost:10, amount:2, paid:10, full:true, sameTurn:true, again:false});
    });
});
