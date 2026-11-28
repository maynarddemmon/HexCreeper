import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  Thirst, hunger and fatigue (see Needs.js), and eating and drinking (Items.js). The tests
    pin the rules and items they're written for (base 100: 25, 75, 100; ticks, effects, food
    and water), whatever the data's tuning. */

const pinNeeds = page => page.evaluate(() => {
    const g = hc.app.game, r = g.rules,
        set = (need, v) => Object.entries(v).forEach(([k, f]) => r[need + k] = f);
    for (const n of ['Thirst', 'Hunger', 'Fatigue']) {
        Object.assign(r, {['min' + n]:'0', ['lower' + n]:'25 * (con / 10)', ['upper' + n]:'75 * (con / 10)', ['max' + n]:'100 * (con / 10)'});
    }
    set('thirst', {TurnTick:'-0.25', ApTick:'-0.05', LowRecovery:'-0.25', HighRecovery:'0.1', LowHp:'0', HighHp:'0', MinMultiplier:'2'});
    set('hunger', {TurnTick:'-0.25', ApTick:'-0.05', LowRecovery:'0', HighRecovery:'0', LowHp:'-0.25', HighHp:'0.1', MinMultiplier:'2'});
    set('fatigue', {TurnTick:'-0.1', ApTick:'-0.15', LowStats:'0', HighStats:'0'});
    Object.assign(hc.items.get('mushroom_jerky'), {satiates:{'*':10}, quench:{'*':-2}, heals:{}, rests:{}});
    Object.assign(hc.items.get('centipede_jerky'), {satiates:{'*':15}, quench:{'*':-3}, heals:{}, rests:{}});
    Object.assign(hc.items.get('water'), {quench:{'*':25}, satiates:{}, heals:{}, rests:{}});
    for (const p of g.piecesOf('player')) g.giveNeeds(p);
});

test('your pieces have needs, starting at their upper; enemies don\'t; the bounds scale with con', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            e = g.addPiece('core', 'enemy', 4, 4, null, 'goblin'),
            tough = {level:1, stats:{...c.stats, con:20}};
        return [c.needs, e.needs, g.needBounds(c, 'thirst'), g.needBounds(tough, 'hunger'), g.needLevel(c, 'fatigue')];
    });
    expect(r).toEqual([{thirst:7500, hunger:7500, fatigue:7500}, undefined, {min:0, lower:2500, upper:7500, max:10000},
        {min:0, lower:5000, upper:15000, max:20000}, 'mid']);
});

test('needs go down each turn, and for each action point spent, kept within their bounds', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.placeCost = '0';
        g.playerWait();
        out.push({...c.needs});                 // a turn: -0.25, -0.25, -0.1
        g.spend(c, 200);                        // 2 points: -0.1, -0.1, -0.3
        out.push({...c.needs});
        g.changeNeed(c, 'thirst', -100000);
        g.changeNeed(c, 'hunger', 100000);
        out.push({...c.needs});
        return out;
    });
    expect(r).toEqual([
        {thirst:7475, hunger:7475, fatigue:7490}, {thirst:7465, hunger:7465, fatigue:7460}, {thirst:0, hunger:10000, fatigue:7460}
    ]);
});

test('thirst: low, less AP back; high, more; at its min, twice as little', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), base = g.apRecovery(c), out = [];
        for (const v of [8000, 2500, 0]) {
            c.needs.thirst = v;
            out.push([g.needLevel(c, 'thirst'), g.apRecovery(c) - base, g.needWords(c)]);
        }
        return out;
    });
    expect(r).toEqual([['high', 10, 'Hydrated'], ['low', -25, 'Parched'], ['min', -50, 'Dehydrated']]);
});

test('hunger: low, HP lost each turn (fractions carry over, and it can kill); high, HP back', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.placeCost = '0';
        g.rules.hungerTurnTick = '0';
        c.hp = c.maxHp = 10;
        c.needs.hunger = 2000;                  // low: -0.25 a turn
        for (let i = 0; i < 4; i++) g.playerWait();
        out.push([c.hp, c.hpCarry]);
        c.needs.hunger = 9000;                  // high: +0.1
        for (let i = 0; i < 10; i++) g.playerWait();
        out.push([c.hp, c.hpCarry]);
        c.needs.hunger = 0;                     // starving: -0.5
        c.hp = 1;
        c.hpCarry = 0;
        g.playerWait();
        g.playerWait();
        out.push(g.over);
        return out;
    });
    expect(r).toEqual([[9, 0], [10, 0], true]);
});

test('needs can change stats (fatigue\'s rules, 0 for now)', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [g.statVars(c).str];
        c.needs.fatigue = 1000;
        out.push(g.statVars(c).str);
        g.rules.fatigueLowStats = '-2';
        out.push(g.statVars(c).str, g.statRule('defence', c));
        return out;
    });
    expect(r).toEqual([10, 10, 8, 9]);
});

test('eating and drinking: a dose (what\'s left, if less, does less), for the consume cost', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.placeCost = '0';
        g.rules.apPool = '10';
        c.inventory.items.length = 0;
        const jerky = g.makeItem('centipede_jerky', 2), flask = g.makeItem('flask');
        g.addItem(c, jerky);
        g.addItem(c, flask);
        g.addItem(flask, g.makeItem('water', 100));
        c.ap = g.apMax(c);
        out.push(g.playerConsume(c, jerky.id), jerky.count, c.needs.hunger, c.needs.thirst, c.ap);
        const water = flask.inventory.items[0];
        out.push(g.playerConsume(c, water.id), flask.inventory.items.length, c.needs.thirst);
        out.push(g.consumeProblem(c, flask.id));
        return out;
    });
    // Jerky: hunger +15, thirst -3; 100 mL of a 250 mL dose: thirst +10. Each less a hundredth for the
    // 0.25 points it took (0.05 a point, rounded).
    expect(r).toEqual([true, 1, 8999, 7199, 975, true, 0, 8198, 'inedible']);
});

test('fluids go only in what holds fluids; flasks fill from a stream or pool, and pieces drink from one', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.placeCost = '0';
        g.rules.apPool = '10';
        c.ap = g.apMax(c);
        const flask = g.makeItem('flask'), pouch = g.makeItem('belt_pouch'), water = g.makeItem('water', 10);
        g.addItem(c, flask);
        g.addItem(c, pouch);
        out.push(g.addProblem(c, water), g.addProblem(pouch, water), g.addProblem(flask, g.makeItem('dagger')), g.addProblem(flask, water));
        out.push(g.fillProblem(c, flask.id), g.fillProblem(c, pouch.id));
        g.tiles.set(g.key(1, 0), {x:1, y:0, kind:'floor', subtype:'pool'});
        out.push(g.fluidSources(c).map(s => s.ref + '@' + s.dir));
        out.push(g.playerFill(c, flask.id), g.countOf(flask, 'water'), g.itemLabel(flask.inventory.items[0]));
        c.needs.thirst = 1000;
        out.push(g.playerDrink(c, 'source:1,0'), c.needs.thirst);
        return out;
    });
    // (A drink: +25, less a hundredth for the points it took.)
    expect(r).toEqual(['fluid', 'fluid', 'solid', '', 'dry', 'unfillable', ['source:1,0@1'], true, 250, '0.25 L water', true, 3499]);
});

test('needs are saved', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        c.needs.thirst = 1234;
        c.hpCarry = -40;
        const saved = JSON.parse(JSON.stringify(g.exportToObj()));
        g.reset();
        g.importFromObj(saved);
        const again = g.getPlayerCore();
        saved.pieces.find(p => p.id === again.id).needs.thirst = 1;
        return [again.needs.thirst, again.hpCarry];
    });
    expect(r).toEqual([1234, -40]);
});

test('the Inventory dialog eats, drinks and fills; the sheet shows needs', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const ids = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), flask = g.makeItem('flask'), jerky = g.makeItem('mushroom_jerky');
        c.inventory.items.length = 0;
        g.addItem(c, flask);
        g.addItem(c, jerky);
        flask.expanded = true;
        g.tiles.set(g.key(1, 0), {x:1, y:0, kind:'floor', subtype:'stream'});
        c.needs.thirst = 2000;
        return {flask:flask.id, jerky:jerky.id};
    });
    await page.keyboard.press('h');
    const btn = (attrs, action) => page.locator(`[${attrs}][data-action="${action}"]`);
    await expect(page.getByText('Stream (east)')).toBeVisible();
    await expect(btn(`data-item="${ids.jerky}"`, 'eat')).toHaveAttribute('title', 'Eat mushroom jerky (a bite: thirst -2, hunger +10), for 0.25 action points.');
    await btn(`data-item="${ids.flask}"`, 'fill').click();
    await expect(page.getByText('0.25 L water')).toBeVisible();
    await btn('data-holder="source:1,0"', 'drink').click();
    await btn('data-holder="piece"', 'takeAll').count();
    await page.getByRole('button', {name:'Character', exact:true}).filter({visible:true}).click();
    await expect(page.getByText('Hunger', {exact:true}).last()).toBeVisible(); // (the sheet's: the info panel has a Hunger bar)
    // 20, +25 from the stream, less the turn's ticks for the points spent (0.5 fill, 0.25 drink: 0.0375)
    await expect(page.getByText('44/100', {exact:true}).last()).toBeVisible();
});

test('food by species: a species\' own value, else the nearest it extends, else "*", else 0', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            cake = hc.items.get('mold_cake'),
            as = species => g.consumeEffects({species}, cake).satiates;
        cake.satiates = {goblin:100, orc:50, '*':5};
        const out = [hc.species.lineage('hobgoblin'), as('goblin'), as('hobgoblin'), as('orc'), as('human')];
        cake.satiates = {goblin:100, hobgoblin:90};
        out.push(as('hobgoblin'), as('human'), g.isConsumable(cake));
        // As a number: for any species. Less than a dose does as much less.
        const stalk = hc.items.get('crawler_stalk');
        out.push(g.consumeEffects(c, stalk), g.consumeEffects(c, hc.items.get('water'), 100).quench);
        return out;
    });
    expect(r).toEqual([['hobgoblin', 'goblin'], 100, 100, 50, 5, 90, 0, true,
        {quench:0, satiates:50, heals:2.5, rests:0}, 10]);
});

test('heals and rests: food can mend (or hurt) and rest (or tire)', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await pinNeeds(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.placeCost = '0';
        g.rules.apPool = '10';
        c.ap = g.apMax(c);
        c.hp = 1;
        c.maxHp = 10;
        const stalk = hc.items.get('crawler_stalk');
        stalk.rests = {'*':-20};
        const a = g.makeItem('crawler_stalk', 2);
        g.addItem(c, a);
        g.playerConsume(c, a.id);
        out.push(c.hp, c.hpCarry, c.needs.fatigue);
        stalk.heals = {human:-5};
        g.playerConsume(c, a.id);
        out.push(g.over);
        return out;
    });
    // 2.5 HP: 2 now, half carried; fatigue -20, less the eating's tick
    expect(r).toEqual([3, 50, 7500 - 2000 - 4, true]);
});
