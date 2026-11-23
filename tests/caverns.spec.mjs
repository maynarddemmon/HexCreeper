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
            return !t ? 'open' : t.subtype === T.attrs.rockSolid ? 'rock' : t.subtype;
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
                if (!seen.has(k) && Math.abs(x + dx) < 70 && Math.abs(y + dy) < 70 && (!t || g.isEffectTile(t))) {
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
            if (!seen.has(k) && T.madeBlocks.has(T.blocks.key(x + dx, y + dy)) && (!t || g.isEffectTile(t))) {
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

test('junctions have no cavern; a dead-end tunnel can curl into a ring', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {junctionChance:100, tunnelDeadEndFactor:60, tunnelLassoChance:100});
    const r = await page.evaluate(() => {
        const T = hc.app.game.tileGenerator, sites = hc.hex.disk(0, 0, 3),
            lassos = sites.map(s => T.lasso(s.x, s.y)).filter(Boolean),
            // A lasso's cells go all the way round its centre, and not over it.
            ring = l => [0, 1, 2, 3, 4, 5, 6, 7].every(n => {
                const c = hc.hex.cellAtWorld(l.center[0] + l.radius * Math.cos(n * Math.PI / 4), l.center[1] + l.radius * Math.sin(n * Math.PI / 4));
                return l.cells.has(c.x + ',' + c.y);
            }) && !l.cells.has(Object.values(hc.hex.cellAtWorld(...l.center)).join());
        return {
            start:T.cavern(0, 0).size > 0,
            others:sites.filter(s => s.x || s.y).every(s => T.cavern(s.x, s.y).size === 0),
            lassos:lassos.length > 0 && lassos.every(ring)
        };
    });
    expect(r).toEqual({start:true, others:true, lassos:true});
});

test('a cavern loop leaves its cavern and comes back; joined caverns open straight into each other', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {junctionChance:0, cavernLoopChance:100, cavernJoinChance:100, stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, start = T.cavern(0, 0),
            loop = [...T.cavernLoop(0, 0).cells],
            [i, j] = hc.hex.dirs.find(([i, j]) => T.isJoined([0, 0], [i, j])),
            a = T.site(0, 0), b = T.site(i, j);
        window.caves.make(6);
        // The straight line between the joined caverns' centres.
        const line = [];
        for (let n = 0; n <= 100; n++) line.push(hc.hex.cellAtWorld(a.wx + (b.wx - a.wx) * n / 100, a.wy + (b.wy - a.wy) * n / 100));
        return {
            loopOut:loop.some(k => !start.has(k)),
            loopBack:loop.filter(k => start.has(k)).length > 1,
            joined:line.every(c => window.caves.cell(c.x, c.y) !== 'rock')
        };
    });
    expect(r).toEqual({loopOut:true, loopBack:true, joined:true});
});

test('a cell comes out the same whatever order the blocks are made in', async ({page}) => {
    await startGame(page);
    const made = async order => {
        await inCaverns(page, {stalagmiteFrequency:50, holeFrequency:50, healFrequency:20});
        return page.evaluate(order => {
            const g = hc.app.game, blocks = hc.hex.disk(0, 0, 4);
            g.tiles.clear();
            g.tileGenerator.madeBlocks.clear();
            for (const b of order === 'out' ? blocks : blocks.reverse()) g.tileGenerator.makeBlock(b.x, b.y);
            return [...g.tiles.values()].map(t => JSON.stringify([t.x, t.y, t.kind, t.subtype, t.pool])).sort();
        }, order);
    };
    expect(await made('out')).toEqual(await made('in'));
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
        const placed = [...g.tiles.values()].filter(t => t.subtype !== 'cave_rock'),
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

test('heal, harm and loot tiles come at about their frequencies, from their tables', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {stalagmiteFrequency:0, stalactiteFrequency:0, holeFrequency:0, healFrequency:50, harmFrequency:30, lootFrequency:0, harmTable:{trap:1, mine:0}});
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        window.caves.make(6);
        const tiles = [...g.tiles.values()], open = hc.hex.disk(0, 0, 6).flatMap(b => g.tileGenerator.blocks.cells(b.x, b.y))
            .filter(c => g.tiles.get(g.key(c.x, c.y))?.subtype !== 'cave_rock').length,
            count = kind => tiles.filter(t => t.kind === kind).length;
        return {
            heal:count('heal') / open, harm:count('harm') / open, loot:count('loot'),
            harmTypes:[...new Set(tiles.filter(t => t.kind === 'harm').map(t => t.subtype))]
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
                    if (!seen.has(k) && T.madeBlocks.has(T.blocks.key(x + dx, y + dy)) && (!t || g.isEffectTile(t))) {
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
