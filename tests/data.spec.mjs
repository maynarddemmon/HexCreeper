import {test, expect} from '@playwright/test';
import {startGame, BASE_URL} from './helpers.mjs';

// Serves data/<file> as it is, but for what change makes of its text.
const rewrite = (page, file, change) => page.route('**/data/' + file, async route => {
    const response = await route.fetch();
    route.fulfill({response, body:change(await response.text())});
});

// Serves data/<file> as text.
const serve = (page, file, text) => page.route('**/data/' + file, route => route.fulfill({status:200, contentType:'text/plain', body:text}));

test('the data is init.json5\'s tables and those of the files it includes: rules, environs and entities', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => done({
        tables:Object.keys(data).sort(),
        maps:data.maps.length > 0,
        rules:typeof data.rules.hitMin,
        species:!!hc.species.get('human'),
        solids:hc.solids.list().length > 0
    }))));
    expect(r).toEqual({
        tables:['backgrounds', 'defaultMap', 'effects', 'enemies', 'enemyGroups', 'fixtures', 'floors', 'holes', 'maps', 'materials', 'rules', 'shadow', 'solids', 'species'],
        maps:true, rules:'number', species:true, solids:true
    });
});

test('an included file can include more; a table in two files is an error, the first kept', async ({page}) => {
    await rewrite(page, 'rules.json5', text => text.replace(/^\{/, '{"include":["more.json5"],'));
    await serve(page, 'more.json5', '{"include":["most.json5"], "moreTable":{"x":1}}');
    // (environs.json5 has a "shadow" too, after.)
    await serve(page, 'most.json5', '{"mostTable":{"y":2}, "shadow":{"angle":45}}');
    const problems = await startGame(page);
    const r = await page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => done([data.moreTable, data.mostTable, data.shadow, 'include' in data]))));
    expect(r).toEqual([{x:1}, {y:2}, {angle:45}, false]);
    expect(problems.errors.filter(e => e.includes('Table shadow is in more than one data file'))).toHaveLength(1);
});

test('a file included twice, or one that can\'t be loaded, is an error, and there\'s no data', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await page.route(url => url.origin !== BASE_URL, route => route.fulfill({status:200, body:''}));
    await rewrite(page, 'rules.json5', text => text.replace(/^\{/, '{"include":["entities.json5", "missing.json5"],'));
    await serve(page, 'missing.json5', '{not json5');
    await page.addInitScript(() => {localStorage.setItem('hc.helpSeen', 'true');});
    await page.goto('/index.html');
    await page.waitForFunction(() => window.hc?.maps);
    expect(await page.evaluate(() => new Promise(done => hc.maps.loadIndex(done)))).toBe(null);
    expect(errors.some(e => e.includes('Data file entities.json5 is included more than once'))).toBe(true);
    expect(errors.some(e => e.includes('Unable to parse') && e.includes('missing.json5'))).toBe(true);
});
