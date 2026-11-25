import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

// Starts a new game in caverns, with these attrs for the tile generator and the given seed,
// and no enemies. Defines window.caves: make(r), which makes every block within r blocks of
// the start, and cell(x, y), what's there ('rock', 'open', or the tile's subtype).
const inCaverns = (page, attrs = {}, seed = 7) => page.evaluate(([attrs, seed]) => {
    const g = hc.app.game;
    g.gameMap = {...g.gameMap, tileGenerator:{type:'caverns', attrs}};
    g.seed = seed;
    g.reset();
    for (const e of g.piecesOf('enemy')) g.removePiece(e);
    const T = g.tileGenerator;
    window.caves = {
        make: r => {
            for (const b of hc.hex.disk(0, 0, r)) T.makeBlock(b.x, b.y);
        },
        cell: (x, y) => {
            const t = g.tiles.get(g.key(x, y));
            return !t || t.kind === 'floor' ? 'open' : t.subtype === T.attrs.rockSolid ? 'rock' : t.subtype;
        }
    };
}, [attrs, seed]);

test('the start is open, and its cavern has tunnels to the neighbouring caverns that lead to it', async ({page}) => {
    await startGame(page);
    await inCaverns(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator;
        window.caves.make(9);
        // Walk from the start over every cell without a solid or hole tile.
        const seen = new Set(['0,0']), todo = [[0, 0]];
        for (const [x, y] of todo) {
            for (const [dx, dy] of hc.hex.dirs) {
                const k = (x + dx) + ',' + (y + dy), t = g.tiles.get(k);
                if (!seen.has(k) && Math.abs(x + dx) < 70 && Math.abs(y + dy) < 70 && (!t || t.kind === 'floor')) {
                    seen.add(k);
                    todo.push([x + dx, y + dy]);
                }
            }
        }
        const centre = s => {
            const c = hc.hex.cellAtWorld(s.wx, s.wy);
            return c.x + ',' + c.y;
        };
        // The neighbouring sites whose way to the start is a tunnel to it.
        const children = hc.hex.dirs.filter(([i, j]) => T.parentOf(i, j)?.join() === '0,0');
        return {
            start:window.caves.cell(0, 0),
            children:children.length > 0,
            reached:children.every(([i, j]) => seen.has(centre(T.site(i, j)))),
            rock:[...g.tiles.values()].filter(t => t.subtype === 'cave_rock').length > seen.size
        };
    });
    expect(r).toEqual({start:'open', children:true, reached:true, rock:true});
});

// From the start, walking over every made cell without a solid or hole tile: whether the
// centre of every site within r of the start's on the lattice can be reached.
const reachesSites = r => {
    const g = hc.app.game, T = g.tileGenerator,
        seen = new Set(['0,0']), todo = [[0, 0]];
    for (const [x, y] of todo) {
        for (const [dx, dy] of hc.hex.dirs) {
            const k = (x + dx) + ',' + (y + dy), t = g.tiles.get(k);
            if (!seen.has(k) && T.madeBlocks.has(T.blocks.key(x + dx, y + dy)) && (!t || t.kind === 'floor')) {
                seen.add(k);
                todo.push([x + dx, y + dy]);
            }
        }
    }
    return hc.hex.disk(0, 0, r).every(({x, y}) => {
        const s = T.site(x, y), c = hc.hex.cellAtWorld(s.wx, s.wy);
        return seen.has(c.x + ',' + c.y);
    });
};

for (const schema of ['random', 'adaptive']) {
    test(`with most sites wanting to be dead ends (${schema}), there are dead ends but none cuts anything off`, async ({page}) => {
        await startGame(page);
        for (const [seed, factor] of [[3, 60], [4, 90]]) {
            await inCaverns(page, {
                junctionChance:50, cavernDeadEndSchema:schema, tunnelDeadEndSchema:schema, cavernDeadEndFactor:factor, tunnelDeadEndFactor:factor,
                stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0
            }, seed);
            expect(await page.evaluate(reachesSites => {
                const T = hc.app.game.tileGenerator, sites = hc.hex.disk(0, 0, 3);
                window.caves.make(9);
                const deadEnds = sites.filter(s => T.isDeadEnd(s.x, s.y)),
                    // A dead end's only tunnel is to its parent.
                    tunnels = deadEnds.map(s => hc.hex.dirs.filter(([di, dj]) => T.hasTunnel([s.x, s.y], [s.x + di, s.y + dj])).length);
                return [deadEnds.length > 3, tunnels.every(n => n === 1), new Function('return ' + reachesSites)()(1)];
            }, reachesSites.toString())).toEqual([true, true, true]);
        }
    });
}

test('with a dead end factor of 0 there are no dead ends', async ({page}) => {
    await startGame(page);
    for (const schema of ['random', 'adaptive']) {
        await inCaverns(page, {junctionChance:50, cavernDeadEndSchema:schema, tunnelDeadEndSchema:schema, cavernDeadEndFactor:0, tunnelDeadEndFactor:0});
        expect(await page.evaluate(() => hc.hex.disk(0, 0, 4).some(s => hc.app.game.tileGenerator.isDeadEnd(s.x, s.y)))).toBe(false);
    }
});

test('junctions have no cavern', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {junctionChance:100});
    expect(await page.evaluate(() => {
        const T = hc.app.game.tileGenerator;
        return [T.cavern(0, 0).size > 0, hc.hex.disk(0, 0, 3).filter(s => s.x || s.y).every(s => T.cavern(s.x, s.y).size === 0)];
    })).toEqual([true, true]);
});

test('a dead-end tunnel ends in a way picked from deadEndTable, joined on to the tunnel', async ({page}) => {
    await startGame(page);
    const shapes = async table => {
        await inCaverns(page, {junctionChance:100, tunnelDeadEndFactor:60, deadEndTable:table});
        return page.evaluate(() => {
            const T = hc.app.game.tileGenerator,
                ends = hc.hex.disk(0, 0, 4).filter(s => T.isDeadEnd(s.x, s.y));
            return ends.map(s => {
                const shape = T.deadEndShape(s.x, s.y);
                if (!shape) return null;
                const tunnel = T.tunnel(hc.CavernsTileGenerator.tunnelKey(s.x + ',' + s.y, T.parentOf(s.x, s.y).join())).cells,
                    open = new Set([...tunnel, ...shape.cells]),
                    // Walk from the tunnel over it and the shape: all of the shape is reached.
                    seen = new Set(tunnel), todo = [...tunnel];
                for (const k of todo) {
                    const [x, y] = k.split(',').map(Number);
                    for (const [dx, dy] of hc.hex.dirs) {
                        const n = (x + dx) + ',' + (y + dy);
                        if (open.has(n) && !seen.has(n)) {
                            seen.add(n);
                            todo.push(n);
                        }
                    }
                }
                // Whether it goes round some rock: a cell near it, not in it, that can't be
                // reached from outside without crossing it.
                const keys = [...shape.cells].map(k => k.split(',').map(Number)),
                    cx = Math.round(keys.reduce((sum, [x]) => sum + x, 0) / keys.length),
                    cy = Math.round(keys.reduce((sum, [, y]) => sum + y, 0) / keys.length),
                    area = new Set(hc.hex.disk(cx, cy, 14).map(q => q.x + ',' + q.y)),
                    start = [...area].find(k => {
                        const [x, y] = k.split(',').map(Number);
                        return hc.hexDist({x, y}, {x:cx, y:cy}) === 14;
                    }),
                    outside = new Set([start]), out = [start];
                for (const k of out) {
                    const [x, y] = k.split(',').map(Number);
                    for (const [dx, dy] of hc.hex.dirs) {
                        const n = (x + dx) + ',' + (y + dy);
                        if (area.has(n) && !shape.cells.has(n) && !outside.has(n)) {
                            outside.add(n);
                            out.push(n);
                        }
                    }
                }
                return {kind:shape.kind, joined:[...shape.cells].every(k => seen.has(k)), ring:outside.size + shape.cells.size < area.size};
            });
        });
    };
    const simple = await shapes({simple:1});
    expect(simple.length).toBeGreaterThan(2);
    expect(simple.every(s => s === null)).toBe(true);
    for (const kind of ['lasso', 'fork', 'knot']) {
        const made = await shapes({[kind]:1});
        expect(made.length).toBeGreaterThan(2);
        expect(made.every(s => s.kind === kind && s.joined)).toBe(true);
        if (kind === 'lasso') expect(made.every(s => s.ring)).toBe(true); // a loop round some rock
        if (kind === 'knot') expect(made.some(s => s.ring)).toBe(true);
    }
});

test('a cavern loop leaves its cavern and comes back', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {junctionChance:0, cavernLoopChance:100});
    const r = await page.evaluate(() => {
        const T = hc.app.game.tileGenerator, start = T.cavern(0, 0),
            loop = [...T.cavernLoop(0, 0).cells];
        return {loopOut:loop.some(k => !start.has(k)), loopBack:loop.filter(k => start.has(k)).length > 1};
    });
    expect(r).toEqual({loopOut:true, loopBack:true});
});

test('only caverns that can be moved to touch are joined, and they open straight into each other', async ({page}) => {
    await startGame(page);
    for (const seed of [1, 2, 3]) {
        await inCaverns(page, {junctionChance:0, cavernJoinChance:100, cavernSizeMin:20, cavernSizeMax:200, stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0}, seed);
        const r = await page.evaluate(() => {
            const g = hc.app.game, T = g.tileGenerator,
                pairs = hc.hex.disk(0, 0, 3).flatMap(s => hc.hex.dirs.map(([di, dj]) => [[s.x, s.y], [s.x + di, s.y + dj]])),
                joined = pairs.filter(([a, b]) => T.isJoined(a, b)),
                // Joined to the start's cavern: the straight line between the centres is open.
                toStart = joined.filter(([a]) => a[0] === 0 && a[1] === 0);
            window.caves.make(6);
            return {
                // Some caverns with tunnels between them aren't joined: too far apart.
                some:joined.length > 0 && joined.length < pairs.filter(([a, b]) => T.hasTunnel(a, b)).length,
                touching:joined.every(([a, b]) => T.gapBetween(T.site(...a), T.site(...b)) <= 2),
                open:toStart.every(([a, b]) => {
                    const p = T.site(...a), q = T.site(...b);
                    for (let n = 0; n <= 100; n++) {
                        const c = hc.hex.cellAtWorld(p.wx + (q.wx - p.wx) * n / 100, p.wy + (q.wy - p.wy) * n / 100);
                        if (window.caves.cell(c.x, c.y) === 'rock') return false;
                    }
                    return true;
                })
            };
        });
        expect(r).toEqual({some:true, touching:true, open:true});
    }
});

test('crowding packs caverns closer, until they overlap; what can reach a block is still found', async ({page}) => {
    await startGame(page);
    const packed = async attrs => {
        await inCaverns(page, attrs);
        return page.evaluate(() => {
            const T = hc.app.game.tileGenerator,
                // Caverns sharing cells with a neighbour's.
                overlaps = hc.hex.disk(0, 0, 2).filter(s => hc.hex.dirs.some(([di, dj]) => {
                    const other = T.cavern(s.x + di, s.y + dj);
                    return [...T.cavern(s.x, s.y)].some(k => other.has(k));
                })).length;
            // Looking farther than siteReach finds nothing more.
            let same = true;
            for (const b of hc.hex.disk(0, 0, 5)) {
                const near = T.near(b.x, b.y);
                T.siteReach += 3;
                const wide = T.near(b.x, b.y);
                T.siteReach -= 3;
                for (const c of T.blocks.cells(b.x, b.y)) {
                    if (JSON.stringify(T.cellOf(c.x, c.y, near)) !== JSON.stringify(T.cellOf(c.x, c.y, wide))) same = false;
                }
            }
            return {spacing:T.spacing, overlaps, same};
        });
    };
    const apart = await packed({junctionChance:0, cavernJoinChance:0}),
        close = await packed({junctionChance:0, cavernJoinChance:0, crowding:100, tangle:100, cavernLoopChance:100}),
        knotted = await packed({junctionChance:70, tunnelDeadEndFactor:70, deadEndTable:{lasso:1, fork:1, knot:1}, crowding:100, tangle:100});
    expect(apart).toMatchObject({overlaps:0, same:true});
    expect(close.spacing).toBeLessThan(apart.spacing);
    expect(close.overlaps).toBeGreaterThan(5);
    expect(close.same).toBe(true);
    expect(knotted.same).toBe(true);
});

test('a cell comes out the same whatever order the blocks are made in', async ({page}) => {
    await startGame(page);
    const made = async order => {
        await inCaverns(page, {stalagmiteFrequency:50, holeFrequency:50, healFrequency:20});
        return page.evaluate(order => {
            const g = hc.app.game, blocks = hc.hex.disk(0, 0, 4);
            g.tiles.clear();
            g.fixtures.clear();
            g.tileGenerator.madeBlocks.clear();
            for (const b of order === 'out' ? blocks : blocks.reverse()) g.tileGenerator.makeBlock(b.x, b.y);
            return [...g.tiles.values(), ...g.fixtures.values()].map(t => JSON.stringify([t.x, t.y, t.kind ?? t.type, t.subtype, t.pool])).sort();
        }, order);
    };
    expect(await made('out')).toEqual(await made('in'));
});

// Whether a tunnel's cells, but for those in skip (a set of keys), join the centres of the
// sites at its ends ([i, j]).
const tunnelJoins = (a, b, skip = new Set()) => {
    const T = hc.app.game.tileGenerator,
        cells = T.tunnel(hc.CavernsTileGenerator.tunnelKey(a.join(), b.join())).cells,
        [ca, cb] = [a, b].map(q => {
            const s = T.site(...q);
            return hc.hex.cellAtWorld(s.wx, s.wy);
        }),
        seen = new Set([ca.x + ',' + ca.y]), todo = [[ca.x, ca.y]];
    for (const [x, y] of todo) {
        for (const [dx, dy] of hc.hex.dirs) {
            const k = (x + dx) + ',' + (y + dy);
            if (cells.has(k) && !skip.has(k) && !seen.has(k)) {
                seen.add(k);
                todo.push([x + dx, y + dy]);
            }
        }
    }
    return seen.has(cb.x + ',' + cb.y);
};

test('a tunnel is never broken, however thin and tangled', async ({page}) => {
    await startGame(page);
    for (const seed of [1, 2, 3]) {
        await inCaverns(page, {tangle:100, tunnelWidthMin:1, tunnelWidthMax:1, junctionChance:0, cavernJoinChance:0}, seed);
        expect(await page.evaluate(tunnelJoins => {
            const T = hc.app.game.tileGenerator, joins = new Function('return ' + tunnelJoins)(),
                ends = hc.hex.dirs.filter(d => T.hasTunnel([0, 0], d));
            return ends.length > 0 && ends.every(d => joins([0, 0], d));
        }, tunnelJoins.toString())).toBe(true);
    }
});

test('with collapseChance, rubble blocks tunnels part way along, all the way across', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {collapseChance:100, junctionChance:0, cavernJoinChance:0, tunnelWidthMin:2, tunnelWidthMax:4});
    const r = await page.evaluate(tunnelJoins => {
        const g = hc.app.game, T = g.tileGenerator, joins = new Function('return ' + tunnelJoins)(),
            ends = hc.hex.dirs.filter(d => T.hasTunnel([0, 0], d)),
            plugs = ends.map(d => T.tunnel(hc.CavernsTileGenerator.tunnelKey('0,0', d.join())).plug);
        window.caves.make(6);
        const rubble = [...g.tiles.values()].filter(t => t.subtype === 'rubble');
        return {
            plugged:ends.length > 0 && plugs.every(p => p.size > 0),
            across:ends.every((d, n) => joins([0, 0], d) && !joins([0, 0], d, plugs[n])),
            rubble:rubble.length > 0 && rubble.every(t => !T.cavern(0, 0).has(t.x + ',' + t.y))
        };
    }, tunnelJoins.toString());
    expect(r).toEqual({plugged:true, across:true, rubble:true});
});

test('with a lot of tangle, a tunnel can turn back on itself for a while', async ({page}) => {
    await startGame(page);
    // The most times any line across a tunnel (square to the way between its ends) crosses
    // it: once if it only ever heads onward, at least three times if it turns back.
    const crossings = async tangle => {
        await inCaverns(page, {tangle, junctionChance:0, cavernJoinChance:0});
        return page.evaluate(() => {
            const T = hc.app.game.tileGenerator;
            let most = 0;
            for (const s of hc.hex.disk(0, 0, 2)) {
                for (const [di, dj] of hc.hex.dirs.slice(0, 3)) {
                    const a = [s.x, s.y], b = [s.x + di, s.y + dj];
                    if (T.hasTunnel(a, b)) {
                        const p = T.site(...a), q = T.site(...b), len = Math.hypot(q.wx - p.wx, q.wy - p.wy),
                            ux = (q.wx - p.wx) / len, uy = (q.wy - p.wy) / len,
                            cells = [...T.tunnel(hc.CavernsTileGenerator.tunnelKey(a.join(), b.join())).cells].map(k => {
                                const [wx, wy] = hc.hex.center(...k.split(',').map(Number));
                                return {along:(wx - p.wx) * ux + (wy - p.wy) * uy, aside:(wx - p.wx) * -uy + (wy - p.wy) * ux};
                            });
                        // Lines across, away from the ends; runs of cells on one, a cell or more apart.
                        for (let d = len * 0.25; d < len * 0.75; d += 0.5) {
                            const on = cells.filter(c => Math.abs(c.along - d) < 0.5).map(c => c.aside).sort((x, y) => x - y);
                            const runs = on.filter((x, n) => n === 0 || x - on[n - 1] > 1.5).length;
                            most = Math.max(most, runs);
                        }
                    }
                }
            }
            return most;
        });
    };
    expect(await crossings(0)).toBe(1);
    expect(await crossings(100)).toBeGreaterThanOrEqual(3);
});

test('without tangle a tunnel runs straight; with it, it winds', async ({page}) => {
    await startGame(page);
    // How far a tunnel's cells get from the straight line between the caverns' centres.
    const stray = async tangle => {
        await inCaverns(page, {tangle, tunnelWidthMin:1, tunnelWidthMax:1});
        return page.evaluate(() => {
            const T = hc.app.game.tileGenerator, [i, j] = hc.hex.dirs.find(([i, j]) => T.parentOf(i, j)?.join() === '0,0'),
                a = T.site(0, 0), b = T.site(i, j), len = Math.hypot(b.wx - a.wx, b.wy - a.wy);
            let most = 0;
            for (const k of T.tunnel(hc.CavernsTileGenerator.tunnelKey('0,0', i + ',' + j)).cells) {
                const [wx, wy] = hc.hex.center(...k.split(',').map(Number));
                most = Math.max(most, Math.abs((wx - a.wx) * (b.wy - a.wy) - (wy - a.wy) * (b.wx - a.wx)) / len);
            }
            return most;
        });
    };
    expect(await stray(0)).toBeLessThanOrEqual(1);
    expect(await stray(100)).toBeGreaterThan(3);
});

test('stalagmites, stalactites and holes are only on cavern floor off the tunnels\' paths, of the subtypes chosen', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {stalagmiteFrequency:40, stalactiteFrequency:40, holeFrequency:40, holeTable:{sinkhole:1}, healFrequency:0, harmFrequency:0, lootFrequency:0});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator;
        window.caves.make(4);
        const placed = [...g.tiles.values()].filter(t => t.subtype !== 'cave_rock' && t.kind !== 'floor'),
            offFloor = placed.filter(t => {
                const near = T.near(...T.blocks.of(t.x, t.y));
                return !T.isCavernFloor(t.x, t.y, near);
            });
        return {
            kinds:[...new Set(placed.map(t => t.subtype))].sort(),
            offFloor:offFloor.length,
            some:placed.length > 10
        };
    });
    expect(r).toEqual({kinds:['sinkhole', 'stalactite', 'stalagmite'], offFloor:0, some:true});
});

test('heals, harms and loot come at about their frequencies, from their tables', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0, healFrequency:50, harmFrequency:30, lootFrequency:0, harmTable:{trap:1, mine:0}});
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        window.caves.make(6);
        const fixtures = [...g.fixtures.values()], open = hc.hex.disk(0, 0, 6).flatMap(b => g.tileGenerator.blocks.cells(b.x, b.y))
            .filter(c => g.tiles.get(g.key(c.x, c.y))?.subtype !== 'cave_rock').length,
            count = type => fixtures.filter(f => f.type === type).length;
        return {
            heal:count('heal') / open, harm:count('harm') / open, loot:count('loot'),
            harmTypes:[...new Set(fixtures.filter(f => f.type === 'harm').map(f => f.subtype))]
        };
    });
    expect(r.heal).toBeGreaterThan(0.03);
    expect(r.heal).toBeLessThan(0.07);
    expect(r.harm).toBeGreaterThan(0.015);
    expect(r.harm).toBeLessThan(0.045);
    expect(r.loot).toBe(0);
    expect(r.harmTypes).toEqual(['trap']);
});

test('a table attr is weights for subtypes; one with an unknown subtype or a bad weight is skipped with a warning', async ({page}) => {
    const problems = await startGame(page);
    expect(await page.evaluate(() => {
        const clean = hc.TileGenerator.cleanAttrs('caverns', {
                holeTable:{pit:2, chasm:1}, healTable:{heal:1, nowhere:1}, harmTable:{harm:-1}, lootTable:[]
            }, 'Test'),
            rng = hc.makeRng(1),
            picks = new Set();
        for (let i = 0; i < 50; i++) picks.add(hc.attrs.pick({pit:1, chasm:0, sinkhole:3}, rng));
        return [clean, [...picks].sort(), hc.attrs.pick({pit:0}, rng)];
    })).toEqual([{holeTable:{pit:2, chasm:1}}, ['pit', 'sinkhole'], undefined]);
    expect(problems.warnings.filter(w => /^Test/.test(w)).map(w => w.split(' cannot')[0]).sort()).toEqual([
        'Test attr harmTable', 'Test attr healTable', 'Test attr lootTable'
    ]);
});

test('the Caverns map plays in caverns, and a saved game in it carries on the same', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => new Promise(done => hc.maps.loadMap('caverns', gameMap => {
        const g = hc.app.game;
        g.gameMap = gameMap;
        g.reset();
        const data = JSON.parse(JSON.stringify(g.exportToObj()));
        g.tileGenerator.makeBlock(5, 5);
        const later = [...g.tiles.values()].map(t => JSON.stringify(t)).sort();
        g.importFromObj(data);
        g.tileGenerator.makeBlock(5, 5);
        done([g.tileGenerator.type, g.getPlayerCore() && !g.tiles.has('0,0'), JSON.stringify(later) === JSON.stringify([...g.tiles.values()].map(t => JSON.stringify(t)).sort())]);
    })));
    expect(r).toEqual(['caverns', true, true]);
});

test('with a maxSize, the network is grown from the seed to that many open cells, and the rest is rock', async ({page}) => {
    await startGame(page);
    const grown = async () => {
        await inCaverns(page, {maxSize:3000, cavernDeadEndFactor:100, tunnelDeadEndFactor:100, stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0});
        return page.evaluate(() => {
            const g = hc.app.game, T = g.tileGenerator, n = T.network;
            window.caves.make(12);
            // Walk from the start; the sites in the network can be reached.
            const seen = new Set(['0,0']), todo = [[0, 0]];
            for (const [x, y] of todo) {
                for (const [dx, dy] of hc.hex.dirs) {
                    const k = (x + dx) + ',' + (y + dy), t = g.tiles.get(k);
                    if (!seen.has(k) && T.madeBlocks.has(T.blocks.key(x + dx, y + dy)) && (!t || t.kind === 'floor')) {
                        seen.add(k);
                        todo.push([x + dx, y + dy]);
                    }
                }
            }
            // (Those within 2 of the start's on the lattice, whose cells have all been made.)
            const near = n.order.map(key => key.split(',').map(Number)).filter(([i, j]) => hc.hexDist({x:i, y:j}, {x:0, y:0}) <= 2),
                reached = near.length > 3 && near.every(([i, j]) => {
                    const s = T.site(i, j), c = hc.hex.cellAtWorld(s.wx, s.wy);
                    return seen.has(c.x + ',' + c.y);
                }),
                outside = hc.hex.disk(0, 0, 3).filter(q => !n.sites.has(q.x + ',' + q.y));
            return {
                order:n.order.join(' '),
                size:n.cells.size >= 3000 && n.cells.size < 3000 + 1500,
                reached,
                walked:seen.size <= n.cells.size,
                outside:outside.length > 0 && outside.every(q => T.cavern(q.x, q.y).size === 0)
            };
        });
    };
    const a = await grown(), b = await grown();
    expect(a).toEqual(b); // the same seed grows the same network
    expect(a).toMatchObject({size:true, reached:true, walked:true, outside:true});
});

test('sprawl makes the network reach farther; without a maxSize there\'s no network', async ({page}) => {
    await startGame(page);
    const farthest = async (sprawl, seed) => {
        await inCaverns(page, {maxSize:4000, sprawl}, seed);
        return page.evaluate(() => Math.max(...hc.app.game.tileGenerator.network.order.map(k => {
            const [i, j] = k.split(',').map(Number);
            return hc.hexDist({x:i, y:j}, {x:0, y:0});
        })));
    };
    let blob = 0, sprawled = 0;
    for (const seed of [1, 2, 3, 4]) {
        blob += await farthest(0, seed);
        sprawled += await farthest(100, seed);
    }
    expect(sprawled).toBeGreaterThan(blob);
    await inCaverns(page, {maxSize:0, growth:50});
    expect(await page.evaluate(() => hc.app.game.tileGenerator.network)).toBeNull();
});

test('growth is how much is grown at the start; the rest grows as you explore, and a save carries on the same', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {maxSize:4000, growth:50});
    expect(await page.evaluate(() => hc.app.game.tileGenerator.network.cells.size >= 2000)).toBe(true);
    // Without growth, only what's near the start is grown at first (here, not all of it).
    await inCaverns(page, {maxSize:20000, growth:0});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, n = T.network,
            atStart = n.cells.size,
            data = JSON.parse(JSON.stringify(g.exportToObj())),
            more = () => {
                for (const b of hc.hex.disk(0, 0, 10)) g.tileGenerator.makeBlock(b.x, b.y);
                return [...g.tiles.values()].map(t => JSON.stringify(t)).sort().join();
            },
            explored = more(),
            size = n.cells.size;
        g.importFromObj(data);
        return {atStart:atStart < 20000, grew:size > atStart, capped:size < 20000 + 1500, same:more() === explored};
    });
    expect(r).toEqual({atStart:true, grew:true, capped:true, same:true});
});
