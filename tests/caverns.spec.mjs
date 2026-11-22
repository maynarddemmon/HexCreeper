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
