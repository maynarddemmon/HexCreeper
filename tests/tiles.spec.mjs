import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putTile, setComponentAttrs} from './helpers.mjs';

test('solids and holes go out to the vision radius; heal and harm tiles only 1 quadrant out', async ({page}) => {
    await startGame(page);
    // Vision radius 12 and quadrant radius 3: terrain out to ceil(12 / 11) = 2 quadrants from
    // the start, a hexagon of 19; heal and harm tiles in the start quadrant and its 6
    // neighbours. No loot, or some heal tiles are loot.
    await setComponentAttrs(page, {tile:{quadRadius:3, lootChance:0}});
    const r = await page.evaluate(() => {
        hc.app.game.reset();
        const g = hc.app.game, n = 7, tiles = [...g.tiles.values()].filter(t => t.kind === 'heal' || t.kind === 'harm'),
            inReach = tiles.every(t => {
                const [i, j] = hc.GRID.chunkOf(t.x, t.y);
                return hc.GRID.dist({x:i, y:j}, {x:0, y:0}) <= 1; // quadrants are laid out like cells
            });
        return {terrainQuads:g.tileGenerator.terrainQuads.size, tiledQuads:g.tileGenerator.tiledQuads.size, heal:tiles.filter(t => t.kind === 'heal').length === n,
            harm:tiles.filter(t => t.kind === 'harm').length === n, inReach, subtypes:tiles.every(t => t.subtype === g.tileGenerator.attrs[t.kind + 'Type'])};
    });
    expect(r).toEqual({terrainQuads:19, tiledQuads:7, heal:true, harm:true, inReach:true, subtypes:true});
});

// Each kind is checked with the other turned off, since holes may replace solid tiles.
for (const [kind, max, other] of [['solid', 5, 'hole'], ['hole', 3, 'solid']]) {
    test(`each quadrant gets one connected clump of 0-${max} ${kind} tiles, there at once`, async ({page}) => {
        await startGame(page);
        const r = await page.evaluate(([kind, max, other]) => {
            const g = hc.app.game, G = hc.GRID, sizes = new Set();
            hc.app.game.tileGenerator.attrs[other + 'Max'] = 0;
            let ok = true;
            hc.app.game.tileGenerator.attrs.wallChance = 0;
            for (let i = 0; i < 40; i++) {
                g.seed = i; // a different map each time
                g.tiles.clear();
                g.tileGenerator.borders.clear();
                g.tileGenerator.terrainQuads.delete('0,0');
                g.tileGenerator.generateTerrain(0, 0);
                const clump = [...g.tiles.values()].filter(t => t.kind === kind),
                    keys = new Set(clump.map(t => g.key(t.x, t.y)));
                sizes.add(clump.length);
                if (clump.length > max || g.tiles.size !== clump.length || clump.some(t => G.chunkOf(t.x, t.y).join() !== '0,0')) ok = false;
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

// Sets up making quadrant (0,0) and its six neighbours with only border walls (no random
// clumps, no core), with every border a wall. A wall sits on the side of the quadrant whose
// key comes first in the border's key. Helpers go on window.walls.
const wallsOnly = page => page.evaluate(() => {
    const g = hc.app.game, G = hc.GRID, T = hc.app.game.tileGenerator.attrs,
        quads = [[0, 0], ...G.chunkNeighbours(0, 0)],
        touching = (side, other) => G.chunkCells(...side.split(',').map(Number))
            .filter(c => G.dirs.some(([dx, dy]) => G.chunkKey(c.x + dx, c.y + dy) === other));
    T.solidMax = T.holeMax = 0;
    T.wallChance = 100;
    T.wallHoleChance = 0;
    for (const p of [...g.pieces.values()]) g.removePiece(p); // walls skip cells pieces are on
    window.walls = {
        // Makes the seven quadrants again, in the given order of quadrant indexes.
        regenerate: (order = [0, 1, 2, 3, 4, 5, 6]) => {
            g.tiles.clear();
            g.tileGenerator.terrainQuads.clear();
            g.tileGenerator.borders.clear();
            for (const n of order) g.tileGenerator.generateTerrain(...quads[n]);
        },
        // (0,0)'s borders, each with the cells of its wall less the two corners, which
        // other walls share.
        borders: () => G.chunkNeighbours(0, 0).map(([i, j]) => {
            const bk = hc.ProximityTileGenerator.borderKey('0,0', i + ',' + j), [side, other] = bk.split('|');
            return {bk, inner:touching(side, other).filter(c => G.dirs.every(([dx, dy]) => {
                const k = G.chunkKey(c.x + dx, c.y + dy);
                return k === side || k === other;
            }))};
        }),
        solid: c => g.tiles.get(g.key(c.x, c.y))?.kind === 'solid'
    };
});

test('a wall closes each border but for a door of 1 or 2 cells', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, {regenerate, borders, solid} = window.walls,
            open = new Set();
        for (let t = 0; t < 20; t++) {
            g.seed = t;
            regenerate();
            for (const {inner} of borders()) open.add(inner.filter(c => !solid(c)).length);
        }
        return [...open].sort();
    });
    expect(r).toEqual([1, 2]);
});

test('the walls come out the same whatever order the quadrants are made in', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, {regenerate} = window.walls,
            tiles = () => JSON.stringify([...g.tiles.keys()].sort());
        hc.app.game.tileGenerator.attrs.doorMin = 0; // so the "never walled in" rule comes into it too
        regenerate([0, 1, 2, 3, 4, 5, 6]);
        const forwards = tiles();
        regenerate([6, 5, 4, 3, 2, 1, 0]);
        return forwards === tiles() && forwards.length > 2;
    });
    expect(r).toBe(true);
});

test('door widths come from the settings; walls with no door never close a quadrant in', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const {regenerate, borders, solid} = window.walls, T = hc.app.game.tileGenerator.attrs,
            openPerBorder = () => borders().map(({bk, inner}) => [bk, inner.filter(c => !solid(c)).length]);
        T.doorMin = T.doorMax = 3;
        regenerate();
        const three = openPerBorder().map(([, n]) => n);
        T.doorMin = T.doorMax = 0;
        regenerate();
        const none = openPerBorder().sort();
        return {three, first:none[0][1], others:none.slice(1).every(([, n]) => n <= 1)};
    });
    // With six walls and no doors, (0,0)'s first border (by key) gets a door of 1. (Some
    // others may get one too, for the neighbour on their far side.)
    expect(r).toEqual({three:[3, 3, 3, 3, 3, 3], first:1, others:true});
});

test('a share of walls are holes', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        hc.app.game.tileGenerator.attrs.wallHoleChance = 100;
        window.walls.regenerate();
        return [...new Set([...g.tiles.values()].map(t => t.kind))];
    });
    expect(r).toEqual(['hole']);
});

test('no walls at a 0% chance', async ({page}) => {
    await startGame(page);
    await wallsOnly(page);
    const r = await page.evaluate(() => {
        hc.app.game.tileGenerator.attrs.wallChance = 0;
        window.walls.regenerate();
        return hc.app.game.tiles.size;
    });
    expect(r).toBe(0);
});

test('holes are placed after solid tiles and may replace them', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = hc.app.game.tileGenerator.attrs, free = hc.GRID.chunkCells(0, 0).length - 1; // less the core's
        T.wallChance = 0;
        T.solidMin = T.solidMax = 1000; // every free cell of the quadrant
        T.holeMin = T.holeMax = 3;
        g.tiles.clear();
        g.tileGenerator.borders.clear();
        g.tileGenerator.terrainQuads.delete('0,0');
        g.tileGenerator.generateTerrain(0, 0);
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
        const d = await page.evaluate(() => hc.GRID.dirs[0]);
        await putTile(page, d[0], d[1], 'harm', 'harm');
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.getPlayerCore(), d = hc.GRID.dirs[0];
            const hp = c.hp;
            g.playerAct(c, d[0], d[1]);
            return {lost:hp - c.hp, gone:!g.tiles.has(g.key(d[0], d[1]))};
        });
        expect(r).toEqual({lost:1, gone:true});
    });
    
    for (const kind of ['solid', 'hole']) test(`nothing can move onto or be placed on a ${kind} tile`, async ({page}) => {
        const r = await page.evaluate(kind => {
            const g = hc.app.game, c = g.getPlayerCore(), [a, b] = hc.GRID.dirs,
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
    
    test('harm tiles stay once every neighbouring quadrant is visited', async ({page}) => {
        const d = await page.evaluate(() => hc.GRID.dirs[0]);
        await putTile(page, d[0], d[1], 'harm', 'harm');
        const r = await page.evaluate(() => {
            const g = hc.app.game, d = hc.GRID.dirs[0];
            for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.tileGenerator.visitedQuads.add(i + ',' + j);
            g.piecesMoved();
            return g.isHarm(d[0], d[1]);
        });
        expect(r).toBe(true);
    });
    
    test('healing flows up to a damaged ancestor first, then down; leftovers become score', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.getPlayerCore(), D = hc.GRID.dirs;
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
    
    test('eating two heal tiles in one move: each gives its own, with no combo', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.getPlayerCore(), D = hc.GRID.dirs;
            g.score = 100;
            g.playerPlace(D[0][0], D[0][1], c);
            g.playerWait();
            const a = g.pieceAt(D[0][0], D[0][1]), m = D[2];
            for (const p of [c, a]) g.tiles.set(g.key(p.x + m[0], p.y + m[1]), {...g.makeTile(p.x + m[0], p.y + m[1], 'heal', 'heal'), pool:1, revealedAt:0});
            const s0 = g.score;
            g.playerAct(c, c.x + m[0], c.y + m[1]);
            return g.score - s0;   // both at full HP: 1 score each
        });
        expect(r).toBe(2);
    });
    
    test('the paid heal costs 5 x core rank, heals core rank, and wastes leftovers', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.getPlayerCore(), D = hc.GRID.dirs;
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
