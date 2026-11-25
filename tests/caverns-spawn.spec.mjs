import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
});

test('an expr attr is a formula of its variables, checked when it\'s given', async ({page}) => {
    const r = await page.evaluate(() => {
        const {expr, normalize, evaluate, formulaProblem} = hc.attrs,
            names = ['rank', 'size'],
            def = expr('e', '1', names);
        return {
            values:['rank * 2 + size / 10', '-2 ^ 2', '2 ^ 3 ^ 2', 'max(rank, 3) - floor(size / 7)', '(rank + 1) % 3']
                .map(f => evaluate(f, names, {rank:4, size:30})),
            ok:['rank +', 'rank * pieces', 'sqr(rank)', '3 3', 'rank)'].map(f => normalize(def, f)),
            problems:['rank * pieces', 'sqr(rank)'].map(f => formulaProblem(f, names))
        };
    });
    expect(r).toEqual({
        values:[11, -4, 512, 0, 2],
        ok:[undefined, undefined, undefined, undefined, undefined],
        problems:['no variable pieces', 'no function sqr']
    });
});

test('a tiers attr picks from the tier a number is in, the highest above them all, none below', async ({page}) => {
    const r = await page.evaluate(() => {
        const {tiers, normalize, pickTier} = hc.attrs,
            def = tiers('t', [], () => [{value:'a'}, {value:'b'}, {value:'c'}]),
            t = normalize(def, [{min:2, max:4, table:{a:1}}, {min:5, max:8, table:{b:1}}, {min:10, max:12, table:{c:1}}]),
            rng = () => 0.5;
        return {
            picks:[1, 2, 4, 6, 9, 11, 50].map(n => pickTier(t, n, rng) ?? null),
            bad:[[{min:3, max:1, table:{a:1}}], [{min:0, table:{d:1}}], [], [{max:3, table:{a:1}}]].map(v => normalize(def, v) ?? null)
        };
    });
    expect(r).toEqual({picks:[null, 'a', 'a', 'b', null, 'c', 'c'], bad:[null, null, null, null]});
});

// The caverns map, with the spawn chances given, and a cavern and a tunnel (not where you
// start) near the start: {cavern, tunnel}, each a cell of it.
const caverns = (page, attrs) => page.evaluate(attrs => new Promise(done => hc.maps.loadMap('caverns', m => {
    const g = hc.app.game;
    hc.cfg.ANIM.on = false;
    m.spawnGenerator.attrs = {...m.spawnGenerator.attrs, ...attrs};
    g.gameMap = m;
    g.seed = 7;
    g.reset();
    const tg = g.tileGenerator, found = {},
        cells = hc.hex.disk(0, 0, 40).sort((a, b) => hc.hexDist(a, {x:0, y:0}) - hc.hexDist(b, {x:0, y:0}));
    for (const {x, y} of cells) {
        if (found.cavern && found.tunnel) break;
        const region = tg.regionAt(x, y);
        if (region && !region.start && !found[region.kind]) found[region.kind] = [x, y];
    }
    done(found);
})), attrs);

// Puts your core on cell (x, y), as if it had moved there.
const moveCore = (page, x, y) => page.evaluate(([x, y]) => {
    const g = hc.app.game, c = g.getPlayerCore();
    g.board.delete(g.key(c.x, c.y));
    c.x = x;
    c.y = y;
    g.board.set(g.key(x, y), c.id);
    g.piecesMoved();
    return g.piecesOf('enemy').map(e => [e.enemyId, e.band]);
}, [x, y]);

test('the caverns map knows which cavern or tunnel a cell is in', async ({page}) => {
    const found = await caverns(page, {});
    expect(Object.keys(found).sort()).toEqual(['cavern', 'tunnel']);
    expect(await page.evaluate(() => {
        const r = hc.app.game.tileGenerator.regionAt(0, 0);
        return [r.kind, r.start, r.size === r.cells.size, r.size > 10];
    })).toEqual(['cavern', true, true, true]);
});

test('going into a cavern or tunnel for the first time may spawn a band, by the chances', async ({page}) => {
    // Always in caverns, never in tunnels; a spawn makes caverns never again.
    const found = await caverns(page, {cavernSpawnChance:100, tunnelSpawnChance:0, cavernSpawnChanceModifierOnSuccess:-100,
        challengeTable:[{min:0, table:{goblin_trio:1}}]});
    expect(await moveCore(page, ...found.tunnel)).toEqual([]);
    const spawned = await moveCore(page, ...found.cavern);
    expect(spawned.length).toBe(3);
    expect(new Set(spawned.map(([, band]) => band)).size).toBe(1); // a trio, one band
    const r = await page.evaluate(found => {
        const g = hc.app.game, s = g.spawnGenerator, sight = g.cellsInSight(),
            region = g.tileGenerator.regionAt(...found),
            enemies = g.piecesOf('enemy'),
            copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return {
            inside:enemies.every(e => region.cells.has(e.x + ',' + e.y)),
            unseen:!sight || enemies.every(e => !sight.has(g.key(e.x, e.y))),
            chance:{...s.chance},
            saved:[copy.spawnGenerator.chance.cavern, copy.spawnGenerator.entered.has(region.id)]
        };
    }, found.cavern);
    expect(r).toEqual({inside:true, unseen:true, chance:{cavern:0, tunnel:5}, saved:[0, true]});
    // Back in, nothing more: it's been entered.
    await moveCore(page, 0, 0);
    expect((await moveCore(page, ...found.cavern)).length).toBe(3);
});

test('the challenge comes from the enemyChallenge formula', async ({page}) => {
    // A challenge of 0 is below every tier: nothing spawns, and the chance goes up.
    const found = await caverns(page, {cavernSpawnChance:100, cavernSpawnChanceModifierOnFailure:-30, enemyChallenge:'level - 1',
        challengeTable:[{min:1, table:{goblin:1}}]});
    expect(await moveCore(page, ...found.cavern)).toEqual([]);
    expect(await page.evaluate(() => hc.app.game.spawnGenerator.chance.cavern)).toBe(70);
});
