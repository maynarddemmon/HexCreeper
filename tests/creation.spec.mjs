import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, TEST_CHARACTER} from './helpers.mjs';

// Creation as the code has it: 2 points, 2 below and 3 above a species' typical value.
const pinRules = page => page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
    hc.settings.setDefaultRules({...data.rules, creationPoints:2, creationNegAdj:2, creationPosAdj:3});
    Object.assign(hc.app.game.rules, {creationPoints:2, creationNegAdj:2, creationPosAdj:3});
    done();
})));

test.beforeEach(async ({page}) => {
    await startGame(page);
    await pinRules(page);
});

test('a character must have a name, a playable species and background that fit, and its points spent within limits', async ({page}) => {
    const r = await page.evaluate(ch => {
        const g = hc.app.game,
            problem = changes => g.characterProblem({...ch, ...changes}),
            stats = changes => ({...ch.stats, ...changes});
        return {
            ok:problem({}),
            name:[problem({name:''}), problem({name:'   '}), problem({name:'x'.repeat(65)}), problem({name:'x'.repeat(64)})],
            description:[problem({description:'x'.repeat(1025)}), problem({description:'x'.repeat(1024)})],
            species:[problem({species:'goblin'}), problem({species:'nobody'})],
            background:problem({background:'denizen'}),
            stats:[
                problem({stats:stats({int:10})}),                    // a point not spent
                problem({stats:stats({int:12, cha:10})}),            // spent another way
                problem({stats:stats({str:7, int:14, cha:12})}),     // 3 below: too far
                problem({stats:stats({str:8, int:14, cha:12})}),     // 2 below, 4 above: too far
                problem({stats:stats({str:8, int:13, cha:11})})      // 2 below, 3 above (and 1)
            ],
            range:g.creationRange('human', 'str')
        };
    }, TEST_CHARACTER);
    expect(r).toEqual({
        ok:'',
        name:['name', 'name', 'name', ''],
        description:['description', ''],
        species:['species', 'species'],
        background:'background',
        stats:['stats', '', 'stats', 'stats', ''],
        range:[8, 13]
    });
});

test('a new game\'s core is the character created; pieces placed are of its species and background', async ({page}) => {
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        delete g.giveProfile;    // (clearBoard's)
        g.character = {name:' Brin ', description:'Short and stubborn.', species:'dwarf', background:'reaver',
            stats:{...hc.species.get('dwarf').typical, str:hc.species.get('dwarf').typical.str + 2}};
        g.reset();
        const c = g.getPlayerCore();
        g.gold = 100;
        g.playerPlace(1, 0, c);
        const p = g.pieceAt(1, 0);
        return {core:[c.name, c.description, c.species, c.background, c.stats.str - hc.species.get('dwarf').typical.str, c.hp === c.maxHp],
            placed:[p.name, p.species, p.background], who:g.whoOf(c).name};
    });
    expect(r).toEqual({core:['Brin', 'Short and stubborn.', 'dwarf', 'reaver', 2, true], placed:[undefined, 'dwarf', 'reaver'], who:'Brin'});
});

// New game, Start: the creation sheet.
const openCreation = async page => {
    await button(page, 'New game').click();
    await button(page, '✓ Start').click();
    await expect(page.getByText('Create your character')).toBeVisible();
};

test('creating a character: from the last made, + and − within the limits, Confirm once named and spent', async ({page}) => {
    await openCreation(page);
    const name = page.getByRole('textbox', {name:'Name', exact:true}),
        raise = stat => page.getByRole('button', {name:'Raise ' + stat}),
        lower = stat => page.getByRole('button', {name:'Lower ' + stat}),
        confirm = button(page, '✓ Confirm'),
        points = page.getByText('Available Stat Points').locator('xpath=..');
    // The last made (TEST_CHARACTER): int and cha a point up, so none left.
    await expect(name).toHaveValue('Tess');
    await expect(points).toContainText('0');
    await expect(confirm).not.toHaveClass(/disabled/);
    await name.fill('  ');
    await expect(confirm).toHaveClass(/disabled/);
    await name.fill('Wren');
    await expect(confirm).not.toHaveClass(/disabled/);
    // Lowering gives points back, two at most below the typical value.
    await lower('Agility').click();
    await lower('Agility').click();
    await expect(lower('Agility')).toHaveClass(/disabled/);
    await expect(points).toContainText('2');
    await expect(confirm).toHaveClass(/disabled/);
    // Raising, three at most above.
    await raise('Strength').click();
    await raise('Strength').click();
    await expect(raise('Strength')).toHaveClass(/disabled/);   // none left
    await lower('Intelligence').click();
    await raise('Strength').click();
    await expect(raise('Strength')).toHaveClass(/disabled/);   // three above
    await page.getByRole('textbox', {name:'Description', exact:true}).fill('Quick to anger.');
    await confirm.click();
    const r = await page.evaluate(() => {
        const c = hc.app.game.getPlayerCore();
        return [c.name, c.description, c.stats.str, c.stats.agl, c.stats.int, c.stats.cha, JSON.parse(localStorage.getItem('hc.character')).name];
    });
    expect(r).toEqual(['Wren', 'Quick to anger.', 13, 8, 10, 11, 'Wren']);
});

test('species and background: those that fit nothing are disabled; choosing one the other doesn\'t fit changes the other', async ({page}) => {
    await page.evaluate(() => {
        hc.species.define({
            human:{name:'Human', playable:true},
            gnome:{name:'Gnome', playable:true, backgrounds:['tinker'], stats:{int:[3, 13, 18]}},
            ogre:{name:'Ogre', playable:true, backgrounds:['nobody']}
        });
        hc.backgrounds.define({
            urchin:{name:'Urchin', playable:true, species:['human']},
            tinker:{name:'Tinker', playable:true},
            hermit:{name:'Hermit', playable:true, species:['ogre', 'elf']}
        });
    });
    await openCreation(page);
    const species = page.getByRole('combobox', {name:'Species'}),
        background = page.getByRole('combobox', {name:'Background'}),
        disabled = select => select.evaluate(s => [...s.options].filter(o => o.disabled).map(o => o.value));
    expect(await disabled(species)).toEqual(['ogre']);
    expect(await disabled(background)).toEqual(['hermit']);
    await expect(species).toHaveValue('human');
    await expect(background).toHaveValue('urchin');
    // A gnome isn't an urchin: the first background that fits it. Its stats are a gnome's.
    await species.selectOption('gnome');
    await expect(background).toHaveValue('tinker');
    await expect(page.getByText('Intelligence', {exact:true}).locator('xpath=..')).toContainText('13');
    await expect(page.getByText('Available Stat Points').locator('xpath=..')).toContainText('2');
    // An urchin is only human.
    await background.selectOption('urchin');
    await expect(species).toHaveValue('human');
});

test('Cancel goes back to the map\'s brief, and the game goes on as it was', async ({page}) => {
    await page.evaluate(() => {hc.app.game.turn = 5;});
    await openCreation(page);
    await button(page, '✗ Cancel').click();
    await expect(button(page, '✓ Start')).toBeVisible();
    await button(page, '✗ Cancel').click();
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(5);
});

test('the character sheet shows your name and description', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game;
        g.getPlayerCore().description = 'Fond of <b>tags</b>.';
        g.selectedId = g.playerCoreId;
    });
    await page.keyboard.press('i');
    await expect(page.getByText('Tess · Human · Urchin · Level 1')).toBeVisible();
    await expect(page.getByText('Fond of <b>tags</b>.', {exact:true})).toBeVisible();
});

test('the first time, with no character made before: no name, the first species and background, typical stats', async ({page}) => {
    await page.evaluate(() => {localStorage.removeItem('hc.character');});
    await openCreation(page);
    await expect(page.getByRole('textbox', {name:'Name', exact:true})).toHaveValue('');
    await expect(page.getByRole('combobox', {name:'Species'})).toHaveValue('human');
    await expect(page.getByRole('combobox', {name:'Background'})).toHaveValue('urchin');
    await expect(page.getByText('Available Stat Points').locator('xpath=..')).toContainText('2');
    await expect(page.getByText('Strength', {exact:true}).locator('xpath=..')).toContainText('10');
    await expect(button(page, '✓ Confirm')).toHaveClass(/disabled/);
});
