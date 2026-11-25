import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

// Starts a new game in caverns, with these attrs for the tile generator and the given seed,
// and no enemies.
const inCaverns = (page, attrs = {}, seed = 7) => page.evaluate(([attrs, seed]) => {
    const g = hc.app.game;
    g.gameMap = {...g.gameMap, tileGenerator:{type:'caverns', attrs}};
    g.seed = seed;
    g.reset();
    for (const e of g.piecesOf('enemy')) g.removePiece(e);
}, [attrs, seed]);

// The sites with a stream within r of the start's on the lattice, the tunnels with one
// between them, and whether each has a stream next to it, whether every tunnel with one is a
// tunnel, between two sites with one, and whether the start cell and its neighbours are dry.
const streamsCheck = (page, r) => page.evaluate(r => {
    const g = hc.app.game, T = g.tileGenerator, CTG = hc.CavernsTileGenerator,
        wet = T.streamsAround(0, 0, r),
        sites = hc.hex.disk(0, 0, r).map(q => [q.x, q.y]).filter(q => wet.sites.has(q.join())),
        edges = [...wet.edges].map(tk => tk.split('|').map(k => k.split(',').map(Number)));
    for (const b of hc.hex.disk(0, 0, 3)) T.makeBlock(b.x, b.y);
    return {
        sites:sites.length,
        edges:edges.length,
        joined:sites.every(q => hc.hex.dirs.some(([di, dj]) => wet.edges.has(CTG.tunnelKey(q.join(), [q[0] + di, q[1] + dj].join())))),
        tunnels:edges.every(([a, b]) => T.hasTunnel(a, b) && wet.sites.has(a.join()) && wet.sites.has(b.join())),
        startDry:hc.hex.disk(0, 0, 1).every(q => !['stream', 'pool'].includes(g.tiles.get(q.x + ',' + q.y)?.subtype))
    };
}, r);

test('streams are off by default', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {floorFrequency:0});
    expect(await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, wet = T.streamsAround(0, 0, 5);
        for (const b of hc.hex.disk(0, 0, 6)) T.makeBlock(b.x, b.y);
        return [wet.sites.size, [...g.tiles.values()].filter(t => t.subtype === 'stream' || t.subtype === 'pool').length];
    })).toEqual([0, 0]);
});

test('a stream wanders along tunnels from its spring; every cavern or tunnel with one has one with it next to it', async ({page}) => {
    await startGame(page);
    for (const seed of [7, 8]) {
        await inCaverns(page, {streamChance:10}, seed);
        const r = await streamsCheck(page, 5);
        expect(r.sites).toBeGreaterThan(5);
        expect(r).toEqual({...r, joined:true, tunnels:true, startDry:true});
    }
});

test('its channel runs down the middle of the tunnels it takes, and pools are in the caverns it runs through', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {streamChance:100, streamWidth:50, poolChance:100, poolSizeMin:20, poolSizeMax:20, poolTerminusChance:0, tunnelWidthMin:4, tunnelWidthMax:4});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, CTG = hc.CavernsTileGenerator,
            wet = T.streamsAround(0, 0, 1);
        for (const b of hc.hex.disk(0, 0, 6)) T.makeBlock(b.x, b.y);
        const at = k => g.tiles.get(k)?.subtype ?? 'open',
            // A tunnel with a stream from the start's, outside the caverns: its spine is
            // water, and some of its cells on either side are dry.
            q = hc.hex.dirs.map(([di, dj]) => [di, dj]).find(n => wet.edges.has(CTG.tunnelKey('0,0', n.join()))),
            t = T.tunnel(CTG.tunnelKey('0,0', q.join())),
            caverns = [T.cavern(0, 0), T.cavern(...q)],
            outside = k => caverns.every(c => !c.has(k)) && hc.hexDist({x:0, y:0}, {x:+k.split(',')[0], y:+k.split(',')[1]}) > 1,
            spine = [...t.spine].filter(outside),
            cells = [...t.cells].filter(outside),
            // A cavern the stream runs through (not the start's): a fifth of it is pool.
            c = q[0] || q[1] ? T.cavern(...q) : null,
            pool = c && [...c].filter(k => at(k) === 'pool').length / c.size;
        return {
            spineWet:spine.length > 0 && spine.every(k => ['stream', 'pool'].includes(at(k))),
            banks:cells.some(k => at(k) === 'open'),
            pool:T.siteBase(...q).junction || Math.abs(pool - 0.2) < 0.05
        };
    });
    expect(r).toEqual({spineWet:true, banks:true, pool:true});
});

test('each branch runs through at most streamLength sites, and a pool may end it', async ({page}) => {
    await startGame(page);
    // Caverns only, each with a pool that ends the stream: a stream reaches its spring and
    // the one or two caverns it goes on to.
    await inCaverns(page, {streamChance:30, junctionChance:0, poolChance:100, poolTerminusChance:100});
    const ended = await page.evaluate(() => {
        const T = hc.app.game.tileGenerator,
            springs = hc.hex.disk(0, 0, 6).map(q => T.spring(q.x, q.y)).filter(Boolean);
        return springs.length > 3 && springs.every(s => s.sites.size >= 2 && s.sites.size <= 3);
    });
    expect(ended).toBe(true);
    // Without pools, and no branching: a spring's stream reaches at most streamLength sites.
    await inCaverns(page, {streamChance:30, streamLength:3, streamBranchChance:0, poolChance:0});
    const short = await page.evaluate(() => {
        const T = hc.app.game.tileGenerator,
            springs = hc.hex.disk(0, 0, 6).map(q => T.spring(q.x, q.y)).filter(Boolean);
        return springs.length > 3 && springs.every(s => s.sites.size >= 2 && s.sites.size <= 3) && springs.some(s => s.sites.size === 3);
    });
    expect(short).toBe(true);
});

test('a tunnel with a stream never collapses', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {streamChance:20, collapseChance:100});
    const r = await page.evaluate(() => {
        const T = hc.app.game.tileGenerator, CTG = hc.CavernsTileGenerator,
            out = {wet:0, wetPlugged:0, dry:0, dryPlugged:0};
        for (const q of hc.hex.disk(0, 0, 4)) {
            for (const [di, dj] of hc.hex.dirs) {
                const n = [q.x + di, q.y + dj];
                if (T.hasTunnel([q.x, q.y], n)) {
                    const tk = CTG.tunnelKey(q.x + ',' + q.y, n.join()),
                        wet = T.isWetTunnel(tk),
                        plugged = T.tunnel(tk).plug.size > 0;
                    out[wet ? 'wet' : 'dry']++;
                    if (plugged) out[wet ? 'wetPlugged' : 'dryPlugged']++;
                }
            }
        }
        return out;
    });
    expect(r.wet).toBeGreaterThan(0);
    expect(r.wetPlugged).toBe(0);
    expect(r.dryPlugged).toBeGreaterThan(0);
});

test('a stream fills the shape at the end of a dead end it runs into', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {streamChance:100, junctionChance:100, tunnelDeadEndFactor:100, deadEndTable:{lasso:1}});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator,
            wet = T.streamsAround(0, 0, 3),
            ends = hc.hex.disk(0, 0, 3).filter(q => wet.sites.has(q.x + ',' + q.y) && T.deadEndShape(q.x, q.y));
        for (const b of hc.hex.disk(0, 0, 12)) T.makeBlock(b.x, b.y);
        return ends.length > 0 && ends.every(q => [...T.waterOf(T.deadEndShape(q.x, q.y))].some(k => g.tiles.get(k)?.subtype === 'stream'));
    });
    expect(r).toBe(true);
});

test('with streams, a cell comes out the same whatever order the blocks are made in', async ({page}) => {
    await startGame(page);
    const made = async order => {
        await inCaverns(page, {streamChance:10});
        return page.evaluate(order => {
            const g = hc.app.game, blocks = hc.hex.disk(0, 0, 5);
            g.tiles.clear();
            g.fixtures.clear();
            g.tileGenerator.madeBlocks.clear();
            for (const b of order === 'out' ? blocks : blocks.reverse()) g.tileGenerator.makeBlock(b.x, b.y);
            return [...g.tiles.values()].filter(t => t.kind === 'floor').map(t => JSON.stringify([t.x, t.y, t.subtype])).sort();
        }, order);
    };
    const out = await made('out');
    expect(out.some(t => t.includes('stream'))).toBe(true);
    expect(await made('in')).toEqual(out);
});

test('in a network, a stream carries on as it grows, a new tunnel to a dry site stays dry, and a save carries on the same', async ({page}) => {
    await startGame(page);
    await inCaverns(page, {maxSize:20000, growth:30, streamChance:15});
    const r = await page.evaluate(() => {
        const g = hc.app.game, T = g.tileGenerator, n = T.network, CTG = hc.CavernsTileGenerator,
            data = JSON.parse(JSON.stringify(g.exportToObj())),
            // (The generator is a new one after loading.)
            more = () => {
                for (const b of hc.hex.disk(0, 0, 10)) g.tileGenerator.makeBlock(b.x, b.y);
                return [...g.tiles.values()].map(t => JSON.stringify(t)).sort().join();
            },
            explored = more(),
            wetSites = n.order.filter(k => n.sites.get(k).stream !== null),
            wetEdges = [...n.wetEdges].map(tk => tk.split('|'));
        const out = {
            some:wetSites.length > 3,
            // Every tunnel with a stream is one of the network's, between two sites with one;
            // every site with one but a spring got it from its parent.
            edges:wetEdges.every(([a, b]) => n.edges.has(CTG.tunnelKey(a, b)) && n.sites.get(a).stream !== null && n.sites.get(b).stream !== null),
            carried:wetSites.every(k => {
                const p = n.sites.get(k).parent;
                return T.isSpring(...k.split(',').map(Number)) || p && n.wetEdges.has(CTG.tunnelKey(k, p.join()));
            }),
            joined:wetSites.every(k => [...n.wetEdges].some(tk => tk.split('|').includes(k)) || n.sites.get(k).stream > 0)
        };
        g.importFromObj(data);
        out.same = more() === explored;
        return out;
    });
    expect(r).toEqual({some:true, edges:true, carried:true, joined:true, same:true});
});

test('the Caverns and Ice caverns maps have streams', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => Promise.all(['caverns', 'ice_caverns'].map(id => new Promise(ok => {
        hc.maps.loadMap(id, m => ok(m.tileGenerator.attrs.streamChance > 0));
    }))))).toEqual([true, true]);
});
