import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('a group stands for its trees of enemies, groups in it included', async ({page}) => {
    const r = await page.evaluate(() => {
        // A tree as text: enemy(below, ...)
        const text = n => n.enemyId + (n.below.length ? '(' + n.below.map(text).join(',') + ')' : '');
        return ['goblin', 'goblin_trio', 'goblin_pack', 'nothing'].map(id => hc.enemyTrees(id)?.map(text) ?? null);
    });
    expect(r).toEqual([
        ['goblin'],
        ['goblin_reaver(goblin,goblin)'],
        ['goblin_reaver(goblin_reaver(goblin,goblin),goblin_reaver(goblin,goblin),goblin_reaver(goblin,goblin))'],
        null
    ]);
});

test('groups that can\'t be used are left out, with an error', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    const kept = await page.evaluate(() => {
        hc.defineEnemies({a:{name:'A'}, b:{name:'B'}}, {
            ok:{name:'OK', members:['a', {b:['a', 'pair']}]},
            pair:{name:'Pair', members:['a', 'b']},
            unknown:{name:'Unknown', members:['c']},
            below:{name:'Below', members:[{pair:['a']}]},
            self:{name:'Self', members:[{a:['loop']}]},
            loop:{name:'Loop', members:['self']},
            a:{name:'Clash', members:['b']},
            shape:{name:'Shape', members:[{a:'b'}]},
            empty:{name:'Empty', members:[]}
        });
        const out = hc.enemyGroups.list().map(g => g.id);
        // Back to init.json5's
        return new Promise(done => hc.maps.loadIndex(data => {
            hc.defineEnemies(data.enemies, data.enemyGroups);
            done(out);
        }));
    });
    expect(kept.sort()).toEqual(['ok', 'pair']);
    for (const id of ['unknown', 'below', 'self', 'loop', 'a', 'shape', 'empty']) {
        expect(errors.some(e => e.includes(id))).toBe(true);
    }
});

test('a group spawns at the first spot it fits at, as one band, and keeps its ids when saved', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        // No room at (20, 0): walled round.
        for (const {x, y} of hc.hex.disk(20, 0, 2)) if (x !== 20 || y !== 0) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'boulder'));
        const pieces = g.spawnGenerator.spawnGroup('goblin_pack', [[20, 0], [-20, 0]]),
            leader = pieces[0],
            copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(g.exportToObj())));
        return {
            count:pieces.length,
            at:[leader.x, leader.y],
            leaderKids:g.children(leader).length,
            rank:leader.rank,
            ids:[...new Set(pieces.map(p => p.enemyId))],
            bands:[...new Set(pieces.map(p => p.band))].length,
            saved:[copy.pieces.get(leader.id).enemyId, copy.pieces.get(leader.id).band === leader.band],
            nextBand:copy.newBand() > leader.band,
            nowhere:g.spawnGenerator.spawnGroup('goblin_pack', [[20, 0]])
        };
    });
    expect(r).toEqual({count:10, at:[-20, 0], leaderKids:3, rank:3, ids:['goblin_reaver', 'goblin'], bands:1, saved:['goblin_reaver', true], nextBand:true, nowhere:null});
});

test('hovering over a named enemy you can see says what it is', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game;
        g.spawnGenerator.spawnGroup('goblin', [[2, 0]]);
        hc.app.centerOn(false);
    });
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText(/^Goblin · A small humanoid/).filter({visible:true})).toBeVisible();
});
