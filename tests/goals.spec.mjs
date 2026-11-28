import {test, expect} from '@playwright/test';
import {startGame, button, clearBoard, pressStart} from './helpers.mjs';

/*  Evaluates an expression with the given values (and a "twice" function), or returns the
    message it was refused with. */
const evaluate = (page, src, values = {}) => page.evaluate(([src, values]) => {
    try {
        const fn = hc.expr.compile(src, Object.keys(values), ['twice']);
        return fn({value:name => values[name], call:(name, args) => args[0] * 2});
    } catch (err) {
        return 'error: ' + err.message;
    }
}, [src, values]);

/*  Plays the current map again with these goals and penalties in place of its own, on
    an empty board so nothing gets in the way. */
const playWith = (page, goals, penalties = []) => page.evaluate(([goals, penalties]) => {
    const g = hc.app.game;
    g.gameMap = {...g.gameMap, objectives:hc.goals.fromMap({goals, penalties})};
    hc.app.newGame();
    for (const p of g.piecesOf('enemy')) g.removePiece(p);
}, [goals, penalties]);

const wait = page => page.evaluate(() => {
    hc.app.game.playerWait();
    for (const p of hc.app.game.piecesOf('enemy')) hc.app.game.removePiece(p);
});

const state = page => page.evaluate(() => {
    const g = hc.app.game;
    return {over:g.over, outcome:g.outcome, lostBy:g.lostBy, objectives:g.objectives.map(({value, locked}) => ({value, locked}))};
});

const goal = (expression, more = {}) => ({name:expression, expression, ...more});

test('expressions: arithmetic, comparisons, logic, ternaries and calls', async ({page}) => {
    await startGame(page);
    const cases = [
        ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['10 % 4 - -1', 3], ['7 / 2', 3.5],
        ['a >= 3 && b < 2', true], ['a == 3 || b == 99', true], ['a === 3 && a !== 4', true], ['!(a > 2)', false],
        ['a > 5 ? 1 : b > 0 ? 2 : 3', 2], ['true && !false', true], ['a && 0', false],
        ['twice(a + 1) == 8', true], ['.5 + 1.25', 1.75]
    ];
    for (const [src, want] of cases) expect([src, await evaluate(page, src, {a:3, b:1})]).toEqual([src, want]);
});

test('expressions refuse bad syntax and any name or function they aren\'t given', async ({page}) => {
    await startGame(page);
    expect(await evaluate(page, 'a +', {a:1})).toMatch(/^error: Unexpected at 3/);
    expect(await evaluate(page, '(a', {a:1})).toMatch(/^error: Expected "\)"/);
    expect(await evaluate(page, 'a = 1', {a:1})).toMatch(/^error: Unexpected "="/);
    expect(await evaluate(page, 'a b', {a:1, b:1})).toMatch(/^error: Unexpected at 2/);
    for (const src of ['window', 'constructor', 'alert(1)', 'twice.constructor', 'hc']) {
        expect(await evaluate(page, src, {a:1})).toMatch(/^error: /);
    }
});

test('a map\'s goals and penalties get their defaults, and a bad one is refused', async ({page}) => {
    await startGame(page);
    const read = data => page.evaluate(data => {
        try {
            return hc.goals.fromMap(data);
        } catch (err) {
            return 'error: ' + err.message;
        }
    }, data);
    expect(await read({goals:[{name:'G', expression:'turn > 1'}], penalties:[{name:'P', description:'d', expression:'kills > 1', lockOnSuccess:true, required:false}]})).toEqual([
        {kind:'goal', name:'G', description:'', expression:'turn > 1', progress:'', lockOnSuccess:false, lockOnFailure:false, required:true},
        {kind:'penalty', name:'P', description:'d', expression:'kills > 1', progress:'', lockOnSuccess:true, lockOnFailure:false, required:false}
    ]);
    expect(await read({})).toEqual([]);
    expect(await read({goals:[{expression:'turn'}]})).toBe('error: The goal 1 needs a name');
    expect(await read({penalties:[{name:'P', expression:'tunr > 1'}]})).toBe('error: The penalty 1\'s expression: Unknown name "tunr" at 0');
    expect(await read({goals:[{name:'G', expression:'turn', required:'yes'}]})).toMatch(/must be true or false/);
    expect(await read({goals:{}})).toBe('error: "goals" must be a list');
    expect(await read({goals:[{name:'G', expression:'turn', progress:'{turn'}]})).toBe('error: The goal 1\'s progress: Unmatched "{" at 0');
    expect(await read({goals:[{name:'G', expression:'turn', progress:'turn}'}]})).toBe('error: The goal 1\'s progress: Unmatched "}" at 4');
    expect(await read({goals:[{name:'G', expression:'turn', progress:'{tunr}/3'}]})).toBe('error: The goal 1\'s progress: In "{tunr}": Unknown name "tunr" at 0');
    expect(await read({goals:[{name:'G', expression:'turn', progress:3}]})).toBe('error: The goal 1\'s progress must be text');
});

test('every value an expression can use is a number, at the start of a game', async ({page}) => {
    await startGame(page);
    const names = await page.evaluate(() => hc.goals.NAMES);
    expect([...names].sort()).toEqual(['coreDist', 'coreHp', 'coreLevel', 'coreMaxHp', 'coreX', 'coreY', 'enemies', 'gold', 'kills', 'lootOpened', 'lootTaken', 'maxLevel', 'pieces', 'piecesLost', 'piecesPlaced', 'quadsVisited', 'totalLevels', 'turn']);
    // n == n is false for NaN and undefined. Optional, so they don't end the game.
    await playWith(page, names.map(name => goal(`${name} == ${name} && ${name} * 0 == 0`, {required:false})));
    expect((await state(page)).objectives.every(s => s.value)).toBe(true);
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        return [hc.goals.compile('turn + coreHp + coreDist + quadsVisited')({value:n => ({turn:g.turn, coreHp:g.getPlayerCore().hp, coreDist:0, quadsVisited:g.tileGenerator.visitedQuads.size})[n]})];
    })).toEqual([await page.evaluate(() => 1 + hc.app.game.getPlayerCore().hp + hc.app.game.tileGenerator.visitedQuads.size)]);
});

test('kills, pieces lost and placed, and the core\'s distance are counted', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('kills == 1 && piecesLost == 1 && piecesPlaced == 1 && pieces == 1 && dist(3, 0) == 3 && coreDist == 0')]);
    await clearBoard(page); // so (1, 0) is open
    const done = await page.evaluate(() => {
        const g = hc.app.game;
        g.setGold(1000);
        g.playerPlace(1, 0, g.getPlayerCore());
        g.damage(g.pieceAt(1, 0), 99, null);
        g.damage(g.addPiece('core', 'enemy', 4, 4), 99, null);
        g.afterPlayerAction();
        return [g.kills, g.piecesLost, g.piecesPlaced, g.outcome];
    });
    expect(done).toEqual([1, 1, 1, 'won']);
});

test('progress text fills in its expressions as play goes on, and stops once locked', async ({page}) => {
    await startGame(page);
    await playWith(page, [
        goal('turn >= 3', {progress:'Turn {turn} of 3 ({turn / 3 * 100}%)', lockOnSuccess:true, required:false}),
        goal('kills > 0', {progress:'{max(kills, 7)} {kills > 0 ? 1 : 0}', required:false}),
        goal('turn > 50', {progress:'no braces'})
    ]);
    const progress = () => page.evaluate(() => hc.app.game.objectives.map(s => s.progress));
    expect(await progress()).toEqual(['Turn 1 of 3 (33.3%)', '7 0', 'no braces']);
    await wait(page);
    await wait(page);
    expect(await progress()).toEqual(['Turn 3 of 3 (100%)', '7 0', 'no braces']);
    await wait(page);
    expect(await progress()).toEqual(['Turn 3 of 3 (100%)', '7 0', 'no braces']); // locked
    
    const kept = await page.evaluate(() => {
        const copy = new hc.Game();
        copy.importFromObj(JSON.parse(JSON.stringify(hc.app.game.exportToObj())));
        return copy.objectives.map(s => s.progress);
    });
    expect(kept).toEqual(['Turn 3 of 3 (100%)', '7 0', 'no braces']);
});

test('a map is won once every required goal is met and no required penalty is', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await playWith(page, [goal('turn >= 3'), goal('kills > 100', {required:false})], [goal('turn == 3')]);
    await wait(page);
    expect(await state(page)).toEqual({over:false, outcome:null, lostBy:null, objectives:[{value:false, locked:false}, {value:false, locked:false}, {value:false, locked:false}]});
    await wait(page);  // turn 3: the goal's met, but so is the penalty
    expect((await state(page)).over).toBe(false);
    await wait(page);
    expect(await state(page)).toMatchObject({over:true, outcome:'won', lostBy:null});
    await expect(page.getByText('Map Complete')).toBeVisible();
    await expect(page.getByText('You completed Endless Play on turn 4.', {exact:false})).toBeVisible();
    await button(page, 'Maps').filter({hasText:'Maps'}).click(); // the dialog's, not the header's
    await expect(button(page, 'Play Open Ground')).toBeVisible();
});

test('lockOnSuccess keeps a goal met once it has been', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('turn == 2', {lockOnSuccess:true}), goal('turn >= 3')]);
    await wait(page);
    expect((await state(page)).objectives[0]).toEqual({value:true, locked:true});
    await wait(page);
    expect((await state(page)).outcome).toBe('won');
    
    await playWith(page, [goal('turn == 2'), goal('turn >= 3')]);
    await wait(page);
    await wait(page);
    expect(await state(page)).toMatchObject({over:false, objectives:[{value:false, locked:false}, {value:true, locked:false}]});
});

test('a required goal locked unmet, or penalty locked incurred, loses the map', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('turn < 2', {lockOnFailure:true}), goal('turn > 50')]);
    await wait(page);
    expect(await state(page)).toMatchObject({over:true, outcome:'lost', lostBy:0, objectives:[{value:false, locked:true}, {value:false, locked:false}]});
    await expect(page.getByText('Map Failed')).toBeVisible();
    await expect(page.getByText('"turn < 2" can no longer be achieved.', {exact:false})).toBeVisible();
    await button(page, 'Close').click();
    
    await playWith(page, [goal('turn > 50')], [goal('turn >= 2', {lockOnSuccess:true})]);
    await wait(page);
    expect(await state(page)).toMatchObject({over:true, outcome:'lost', lostBy:1});
    await expect(page.getByText('"turn >= 2" can no longer be avoided.', {exact:false})).toBeVisible();
});

test('optional goals and penalties neither win nor lose; with nothing required, nothing does', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('turn < 2', {lockOnFailure:true, required:false}), goal('turn >= 2', {required:false})], [goal('turn >= 2', {lockOnSuccess:true, required:false})]);
    await wait(page);
    await wait(page);
    expect(await state(page)).toMatchObject({over:false, outcome:null});
});

test('losing the core loses the map', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('turn > 50')]);
    await page.evaluate(() => {hc.app.game.damage(hc.app.game.getPlayerCore(), 999, null);});
    expect(await state(page)).toMatchObject({over:true, outcome:'lost', lostBy:null});
    await expect(page.getByText('Core Destroyed')).toBeVisible();
});

test('goals, their state and the outcome are saved with the game', async ({page}) => {
    await startGame(page);
    await playWith(page, [goal('turn == 2', {lockOnSuccess:true}), goal('turn > 50')]);
    await wait(page);
    const kept = await page.evaluate(() => {
        const g = hc.app.game, data = JSON.parse(JSON.stringify(g.exportToObj())), copy = new hc.Game();
        copy.importFromObj(data);
        return [copy.getMapObjectives().map(o => o.expression), copy.objectives, copy.outcome];
    });
    expect(kept).toEqual([['turn == 2', 'turn > 50'], [{value:true, locked:true, progress:''}, {value:false, locked:false, progress:''}], null]);
    
    const refused = await page.evaluate(() => {
        const data = hc.app.game.exportToObj();
        data.gameMap = {...data.gameMap, objectives:[{kind:'goal', name:'x', expression:'alert(1)'}]};
        try {
            new hc.Game().importFromObj(data);
            return null;
        } catch (err) {
            return err.message;
        }
    });
    expect(refused).toBe('Malformed goal: Unknown function "alert" at 0');
});

test('the brief and the info panel show the map\'s goals and penalties', async ({page}) => {
    await startGame(page);
    await expect(page.getByText('This map has no goals; play as long as you like.').filter({visible:true})).toHaveCount(0); // the brief is closed
    await expect(page.getByText('Goals', {exact:true}).filter({visible:true})).toHaveCount(0);   // no goals in Endless
    
    await button(page, 'Maps').click();
    await button(page, 'Play Open Ground').click();
    const visible = text => page.getByText(text, {exact:true}).filter({visible:true});
    await expect(visible('Far Afield')).toBeVisible();
    await expect(visible('Take your core 30 steps from where it started.')).toBeVisible();
    await expect(visible('Cull (optional)')).toBeVisible();
    await expect(visible('Penalty: Attrition')).toBeVisible();
    await pressStart(page);
    
    // (The info panel lists them with no heading.)
    await expect(visible('○ Far Afield')).toBeVisible();
    await expect(visible('○ Cull (optional)')).toBeVisible();
    await expect(visible('○ Penalty: Attrition')).toBeVisible();
    await expect(visible('Destroy 40 enemy pieces.')).toBeVisible();
    await expect(visible('0/40 destroyed')).toBeVisible();
    await expect(visible('0/30 steps')).toBeVisible();
    await page.evaluate(() => {
        const g = hc.app.game;
        g.kills = 40;
        g.evaluateObjectives();
    });
    await expect(visible('✓ Cull (optional) · locked')).toBeVisible();
    await expect(visible('40/40 destroyed')).toBeVisible();
});

test('a map whose goals are bad isn\'t loaded', async ({page}) => {
    await page.route('**/data/gamemap/warrens.json5', route => route.fulfill({status:200, body:'{"goals":[{"name":"G", "expression":"turn >"}]}'}));
    await startGame(page);
    await button(page, 'Maps').click();
    await button(page, 'Play The Warrens').click();
    await expect(page.getByText('Map Not Loaded')).toBeVisible();
});
