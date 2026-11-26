import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('an entry can extend another, merging objects and replacing the rest, to any depth', async ({page}) => {
    const problems = await startGame(page);
    const r = await page.evaluate(() => {
        const t = new hc.Subtypes('thing', e => ({stats:e.stats, damage:e.damage, size:e.size}));
        t.define({
            big:{extends:'base', name:'Big', stats:{str:12}, damage:[2, 6]},
            base:{name:'Base', description:'A thing.', stats:{str:8, agl:12, deep:{a:1, b:2}}, damage:[1, 4], size:1},
            bigger:{extends:'big', name:'Bigger', stats:{con:14, deep:{b:3}}}
        });
        const strip = ({id, name, description, stats, damage, size}) => ({id, name, description, stats, damage, size});
        return t.list().map(strip);
    });
    expect(r).toEqual([
        {id:'big', name:'Big', description:'A thing.', stats:{str:12, agl:12, deep:{a:1, b:2}}, damage:[2, 6], size:1},
        {id:'base', name:'Base', description:'A thing.', stats:{str:8, agl:12, deep:{a:1, b:2}}, damage:[1, 4], size:1},
        {id:'bigger', name:'Bigger', description:'A thing.', stats:{str:12, agl:12, con:14, deep:{a:1, b:3}}, damage:[2, 6], size:1}
    ]);
    expect(problems.errors).toEqual([]);
});

test('an entry extending one that isn\'t there, or in a loop, or a bad one, is left out with an error', async ({page}) => {
    await startGame(page);
    const errors = [];
    page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
    const ids = await page.evaluate(() => {
        const t = new hc.Subtypes('thing', () => ({}));
        t.define({
            ok:{name:'Ok'},
            lost:{extends:'nowhere', name:'Lost'},
            a:{extends:'b', name:'A'},
            b:{extends:'a', name:'B'},
            self:{extends:'self', name:'Self'},
            onA:{extends:'a', name:'On A'},
            fine:{extends:'ok'}
        });
        return t.list().map(s => s.id + ':' + s.name);
    });
    expect(ids).toEqual(['ok:Ok', 'fine:Ok']);
    expect(errors.sort()).toEqual([
        'Bad thing a: it extends in a loop: a > b > a',
        'Bad thing b: it extends in a loop: a > b > a',
        'Bad thing lost: it extends "nowhere", which isn\'t there',
        'Bad thing onA: it extends a, which is bad',
        'Bad thing self: it extends in a loop: self > self'
    ]);
});

test('enemies extend: the goblin reaver is a goblin with its own stats over a goblin\'s', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const r = hc.enemies.get('goblin_reaver'), g = hc.app.game, p = g.addPiece('core', 'enemy', 9, 9);
        g.giveProfile(p, 'goblin_reaver');
        return [r.name, r.species, r.stats, r.damage, r.hp, r.xp, p.stats];
    })).toEqual(['Goblin Reaver', ['goblin'], {str:12, con:12}, [2, 6], 8, 10, {str:12, agl:12, con:12, dex:10, int:6, wis:8, wil:6, cha:6}]);
});

test('enemy groups don\'t extend', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => [hc.enemyGroups.extendable, hc.enemies.extendable])).toEqual([false, true]);
});
