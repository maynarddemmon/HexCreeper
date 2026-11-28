import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
});

// Runs fn (in the page) with init.json5's data, then puts its species, backgrounds and
// enemies back as they were.
const withData = (page, fn) => page.evaluate(fn => new Promise(done => hc.maps.loadIndex(data => {
    const out = new Function('data', 'return (' + fn + ')(data);')(data);
    hc.species.define(data.species);
    hc.backgrounds.define(data.backgrounds);
    hc.defineEnemies(data.enemies, data.enemyGroups);
    done(out);
})), fn.toString());

test('a species has a range and a typical value for each stat: [3, 18] and 10 if it doesn\'t say', async ({page}) => {
    const r = await page.evaluate(() => {
        const human = hc.species.get('human'), goblin = hc.species.get('goblin');
        return {human:[human.name, human.ranges.str, human.ranges.cha, human.typical.str, human.typical.cha], goblin:[goblin.ranges.agl, goblin.typical.agl]};
    });
    expect(r.human).toEqual(['Human', [3, 18], [3, 18], 10, 10]);
    expect(r.goblin[1]).toBeGreaterThanOrEqual(r.goblin[0][0]);
    expect(r.goblin[1]).toBeLessThanOrEqual(r.goblin[0][1]);
});

test('a piece gets its species\' typical stats and base damage, but for what its profile says', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            elf:{name:'Elf', stats:{agl:[3, 14, 18]}, damage:[1, 8]},
            dwarf:{name:'Dwarf', stats:{con:[3, 13, 18]}}
        });
        hc.enemies.define({
            ranger:{name:'Ranger', species:'elf', stats:{dex:13}},
            brute:{name:'Brute', species:'dwarf', damage:[2, 5]}
        });
        const g = hc.app.game, p = g.addPiece('core', 'enemy', 9, 9), out = {ranger:hc.enemies.get('ranger').species};
        g.giveProfile(p, 'ranger');
        out.elf = [p.species, p.stats.agl, p.stats.dex, p.stats.str, p.damage];
        g.giveProfile(p, 'brute');
        out.dwarf = [p.species, p.stats.con, p.damage];
        g.removePiece(p);
        return out;
    });
    // A dwarf's base damage isn't given: [1, 4].
    expect(r).toEqual({ranger:['elf'], elf:['elf', 14, 13, 10, [1, 8]], dwarf:['dwarf', 13, [2, 5]]});
    await clearBoard(page);
    const pieces = await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 2, 0);
        e.enemyId = 'goblin';
        g.giveProfile(e, 'goblin');
        return [g.getPlayerCore().species, e.species, hc.enemies.get('goblin_reaver').species];
    });
    expect(pieces).toEqual(['human', 'goblin', ['goblin']]);
});

test('a profile can be for any of a list of species: the first, unless it\'s given another of them', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            human:{name:'Human', playable:true},
            elf:{name:'Elf', stats:{agl:[3, 14, 18]}, playable:true},
            orc:{name:'Orc', stats:{int:[3, 6, 10]}}
        });
        hc.enemies.define({
            wanderer:{name:'Wanderer', species:['human', 'elf']},
            sage:{name:'Sage', species:['human', 'orc'], stats:{int:12}}
        });
        const g = hc.app.game, p = g.addPiece('core', 'enemy', 9, 9), out = [];
        for (const s of [undefined, 'elf', 'orc']) {
            g.giveProfile(p, 'wanderer', s);
            out.push([p.species, p.stats.agl]);
        }
        g.removePiece(p);
        // The sage's int is over an orc's max, so it's left out.
        return {out, playable:hc.species.list().filter(s => s.playable).map(s => s.id), wanderer:hc.enemies.get('wanderer').species, sage:!!hc.enemies.get('sage')};
    });
    expect(r).toEqual({out:[['human', 10], ['elf', 14], ['human', 10]], playable:['human', 'elf'], wanderer:['human', 'elf'], sage:false});
});

test('a sub-species extends a species, its own ranges and typical values over the other\'s', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            goblin:{name:'Goblin', stats:{str:[4, 8, 14], agl:[6, 12, 18]}},
            hobgoblin:{extends:'goblin', name:'Hobgoblin', stats:{str:[8, 18]}}
        });
        const h = hc.species.get('hobgoblin');
        return [h.name, h.ranges.str, h.ranges.agl, h.typical.str, h.typical.agl];
    });
    // Its str, [8, 18], replaces the goblin's whole: its typical str is half way, 13.
    expect(r).toEqual(['Hobgoblin', [8, 18], [6, 18], 13, 12]);
});

test('[min, max] has a typical value half way, rounded', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({odd:{name:'Odd', stats:{str:[3, 18], agl:[4, 14], con:[0, 5]}}});
        const o = hc.species.get('odd');
        return [o.typical.str, o.typical.agl, o.typical.con, o.ranges.con];
    });
    expect(r).toEqual([11, 9, 3, [0, 5]]);
});

test('bad species and profiles are left out, with an error: no species, stats out of range', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    const r = await withData(page, () => {
        hc.species.define({
            ok:{name:'OK', stats:{str:[0, 3, 5]}},
            odd:{name:'Odd', stats:{str:[3, 20, 18]}},
            backwards:{name:'Backwards', stats:{str:[12, 6]}},
            long:{name:'Long', stats:{str:[1, 2, 3, 4]}},
            bare:{name:'Bare', stats:{str:10}}
        });
        hc.enemies.define({
            fine:{name:'Fine', species:'ok', stats:{str:0}},
            none:{name:'None'},
            unknown:{name:'Unknown', species:'dwarf'},
            strong:{name:'Strong', species:'ok', stats:{str:6}}
        });
        return [hc.species.list().map(s => s.id), hc.enemies.list().map(c => c.id)];
    });
    expect(r).toEqual([['ok'], ['fine']]);
    expect(errors.some(e => e.includes('Bad species odd'))).toBe(true);
    expect(errors.some(e => e.includes('Bad enemy unknown'))).toBe(true);
});

test('stat points can\'t take a stat over its species\' max, and the sheet\'s + stops there', async ({page}) => {
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        c.stats.str = 17;
        c.statPoints.available = 2;
        return [g.statRange(c, 'str'), g.spendStatPoints(c, {str:2}), g.spendStatPoints(c, {str:1}), c.stats.str, c.statPoints.available];
    });
    expect(r).toEqual([[3, 18], false, true, 18, 1]);
    await page.evaluate(() => {
        hc.app.game.selectedId = hc.app.game.playerCoreId;
    });
    await page.keyboard.press('h');
    await expect(page.getByRole('button', {name:'Raise Strength'})).toHaveClass(/disabled/);
    await expect(page.getByRole('button', {name:'Raise Agility'})).not.toHaveClass(/disabled/);
});
