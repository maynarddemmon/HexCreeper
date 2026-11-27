import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

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

test('backgrounds: urchin and reaver playable, denizen not; your pieces are human urchins, enemies denizens', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            plain = g.addPiece('core', 'enemy', 3, 0),
            gob = g.addPiece('core', 'enemy', 4, 0, null, 'goblin'),
            reaver = g.addPiece('core', 'enemy', 5, 0, null, 'goblin_reaver');
        return {
            playable:Object.fromEntries(['urchin', 'denizen', 'reaver'].map(id => [id, hc.backgrounds.get(id).playable])),
            you:[c.species, c.background],
            // (A creeper has no backgrounds of its own: a denizen.)
            enemies:[plain.background, hc.enemies.get('goblin').backgrounds.includes(gob.background), reaver.background]
        };
    });
    expect(r).toEqual({playable:{urchin:true, denizen:false, reaver:true}, you:['human', 'urchin'], enemies:['denizen', true, 'reaver']});
});

test('a species and a background fit if each allows the other', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            human:{name:'Human', playable:true},
            gnome:{name:'Gnome', playable:true, backgrounds:['tinker', 'urchin']}
        });
        hc.backgrounds.define({
            urchin:{name:'Urchin', playable:true},
            tinker:{name:'Tinker', playable:true, species:['gnome']},
            knight:{name:'Knight', playable:true, species:['human', 'gnome']}
        });
        const g = hc.app.game, fits = (s, b) => g.backgroundFits(s, b);
        return [
            fits('human', 'urchin'), fits('human', 'tinker'), fits('human', 'knight'),
            fits('gnome', 'urchin'), fits('gnome', 'tinker'), fits('gnome', 'knight'),
            fits('elf', 'urchin'), fits('human', 'nobody')
        ];
    });
    // A knight allows gnomes, but gnomes don't allow knights; nothing fits what isn't there.
    expect(r).toEqual([true, false, true, true, true, false, false, false]);
});

test('your pieces get the species and background they\'re given, if they fit, else the first playable ones that do', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            human:{name:'Human', playable:true},
            gnome:{name:'Gnome', playable:true, backgrounds:['tinker']}
        });
        hc.backgrounds.define({
            wanderer:{name:'Wanderer'},
            urchin:{name:'Urchin', playable:true, species:['human']},
            tinker:{name:'Tinker', playable:true}
        });
        const g = hc.app.game, p = g.addPiece('core', 'player', 9, 9), out = [];
        for (const [s, b] of [[undefined, undefined], ['gnome', undefined], ['gnome', 'urchin'], ['human', 'tinker'], ['human', 'wanderer']]) {
            g.giveProfile(p, undefined, s, b);
            out.push(p.species + ' ' + p.background);
        }
        g.removePiece(p);
        return out;
    });
    // (The wanderer isn't playable.)
    expect(r).toEqual(['human urchin', 'gnome tinker', 'gnome tinker', 'human tinker', 'human urchin']);
});

test('an enemy gets one of its backgrounds that fits its species, at random; none, with an error, if none do', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    const r = await withData(page, () => {
        hc.species.define({orc:{name:'Orc', backgrounds:['raider', 'brute', 'shaman']}});
        hc.backgrounds.define({
            raider:{name:'Raider'},
            brute:{name:'Brute'},
            shaman:{name:'Shaman', species:['goblin']},
            denizen:{name:'Denizen'}
        });
        hc.enemies.define({
            orc:{name:'Orc', species:'orc', backgrounds:['raider', 'brute', 'shaman']},
            plain:{name:'Plain', species:'orc'},
            lost:{name:'Lost', species:'orc', backgrounds:['shaman']}
        });
        const g = hc.app.game, seen = new Set();
        for (let i = 0; i < 40; i++) seen.add(g.addPiece('core', 'enemy', 20 + i, 0, null, 'orc').background);
        return {
            seen:[...seen].sort(),
            plain:g.addPiece('core', 'enemy', 0, 20, null, 'plain').background,
            lost:g.addPiece('core', 'enemy', 2, 20, null, 'lost').background,
            chosen:(() => {
                const p = g.addPiece('core', 'enemy', 4, 20);
                g.giveProfile(p, 'orc', undefined, 'brute');
                return p.background;
            })()
        };
    });
    // The shaman is only for goblins; an orc doesn't allow a denizen (the default).
    expect(r).toEqual({seen:['brute', 'raider'], plain:'', lost:'', chosen:'brute'});
    expect(errors.some(e => e.includes('Enemy lost has no background that fits its species orc'))).toBe(true);
});

test('the character sheet names the species and background', async ({page}) => {
    await page.evaluate(() => {
        hc.app.game.selectedId = hc.app.game.playerCoreId;
    });
    await page.keyboard.press('i');
    await expect(page.getByText('Tess · Human · Urchin', {exact:true})).toBeVisible();
});

test('a background adjusts its species\' typical stats: the baseline, kept in the species\' range', async ({page}) => {
    const r = await withData(page, () => {
        hc.species.define({
            human:{name:'Human', playable:true},
            gnome:{name:'Gnome', playable:true, stats:{str:[3, 7, 8]}}
        });
        hc.backgrounds.define({
            smith:{name:'Smith', playable:true, statAdj:{str:2, cha:-2}},
            bad:{name:'Bad', statAdj:{luck:1}},
            worse:{name:'Worse', statAdj:{str:1.5}}
        });
        const g = hc.app.game, p = g.addPiece('core', 'player', 9, 9),
            human = g.baselineStats('human', 'smith'), gnome = g.baselineStats('gnome', 'smith');
        g.giveProfile(p, undefined, 'human', 'smith');
        const out = {human:[human.str, human.cha, human.agl], gnome:gnome.str, piece:[p.stats.str, p.stats.cha],
            range:g.creationRange('human', 'smith', 'str'), bad:[!!hc.backgrounds.get('bad'), !!hc.backgrounds.get('worse')]};
        g.removePiece(p);
        return out;
    });
    // A gnome's str is at most 8. The range is 2 below and 3 above the baseline (12).
    expect(r).toEqual({human:[12, 8, 10], gnome:8, piece:[12, 8], range:[10, 15], bad:[false, false]});
});

test('the data: every playable species has a playable background that fits it', async ({page}) => {
    const lonely = await page.evaluate(() => {
        const g = hc.app.game, playable = hc.backgrounds.list().filter(b => b.playable);
        return hc.species.list().filter(s => s.playable && !playable.some(b => g.backgroundFits(s.id, b.id))).map(s => s.id);
    });
    expect(lonely).toEqual([]);
});
