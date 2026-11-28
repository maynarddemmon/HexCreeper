import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  Equipment (see Items.js): items with an equip, in a piece's slots. */

test('item kinds that can be equipped: a slot, and a weapon\'s damage and penetration, armour\'s armor', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => ['long_sword', 'chain_shirt', 'leather_boots', 'corpse'].map(id => hc.items.get(id).equip));
    expect(r).toEqual([
        {slot:'weapon', damage:[2, 8], penetration:2, armor:0, cost:0.25}, {slot:'body', damage:null, penetration:0, armor:2, cost:1},
        {slot:'feet', damage:null, penetration:0, armor:0, cost:0.5}, null
    ]);
});

test('equipping: one in each slot, from what the piece carries itself, for its cost (or the equipCost rule\'s)', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [],
            give = kind => {
                const it = g.makeItem(kind);
                g.addItem(c, it, true);
                return it;
            },
            dagger = give('dagger'), sword = give('long_sword'), shirt = give('chain_shirt'), pouch = give('belt_pouch'),
            helm = g.makeItem('iron_helm');
        g.addItem(pouch, helm);
        g.rules.placeCost = '0';
        g.rules.apPool = '10';
        c.ap = g.apMax(c);
        out.push(g.equipProblem(c, pouch.id), g.equipProblem(c, helm.id), g.equipProblem(c, dagger.id, true));
        out.push(g.playerEquip(c, dagger.id), c.ap, g.equipProblem(c, dagger.id));
        // The sword in its place
        out.push(g.playerEquip(c, sword.id), g.equipment(c).map(it => it.kind));
        out.push(g.playerEquip(c, shirt.id), g.equippedIn(c, 'body') === shirt, g.equippedIn(c, 'head'));
        // Unequipping
        out.push(g.playerEquip(c, shirt.id, true), g.equipment(c).map(it => it.kind));
        // A kind without a cost: the equipCost rule's
        delete hc.items.get('chain_shirt').equip.cost;
        g.rules.equipCost = '20';
        out.push(g.equipProblem(c, shirt.id));
        hc.items.get('chain_shirt').equip.cost = 1;
        return out;
    });
    expect(r).toEqual(['unequippable', 'missing', 'unequipped', true, 975, 'equipped', true, ['long_sword'], true, true, undefined,
        true, ['long_sword'], 'ap']);
});

test('a weapon\'s damage and penetration replace the piece\'s own; armour adds to its armor', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            bonus = g.statRule('damageBonus', c), pen = Math.max(0, g.statRule('penetrationBonus', c)),
            before = [g.damageRange(c), g.penetrationOf(c), g.armorOf(c)];
        for (const kind of ['long_sword', 'chain_shirt', 'iron_helm', 'wooden_shield']) {
            const it = g.makeItem(kind);
            g.addItem(c, it, true);
            it.equipped = true;
        }
        return {bonus, pen, unarmed:c.damage, before, after:[g.damageRange(c), g.penetrationOf(c), g.armorOf(c)]};
    });
    expect(r.before).toEqual([r.unarmed.map(n => Math.max(0, n + r.bonus)), r.pen, 0]);
    expect(r.after).toEqual([[2 + r.bonus, 8 + r.bonus].map(n => Math.max(0, n)), 2 + r.pen, 4]);
});

test('enemies equip what they\'re given; what\'s left in a corpse stays equipped, and must be unequipped to be taken', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            e = g.addPiece('core', 'enemy', 1, 0, null, 'hobgoblin_reaver'),
            out = [g.equipment(e).map(it => it.kind), g.damageRange(e)[1] - Math.max(0, g.statRule('damageBonus', e))];
        g.damage(e, 100, c);
        const corpse = g.groundAt(1, 0).inventory.items[0];
        // (Not its food, which the data tunes)
        out.push(corpse.inventory.items.filter(it => !g.isConsumable(g.itemKind(it))).map(it => it.kind + (it.equipped ? '*' : '')));
        // Worn: it can't be taken, moved or taken with the rest, till it's unequipped, for
        // its equip cost.
        const sword = corpse.inventory.items.find(it => it.kind === 'long_sword');
        g.rules.apPool = '9';
        c.ap = 900;
        c.x = 1;
        g.board.delete('0,0');
        g.board.set('1,0', c.id);
        out.push(g.takeProblem(c, sword.id), g.transferProblem(c, sword.id, 'ground'), g.equipProblem(c, sword.id));
        g.playerTakeAll(c, corpse.id);
        out.push(corpse.inventory.items.map(it => it.kind), g.takeAllProblem(c, corpse.id));
        const ap = c.ap;
        out.push(g.playerEquip(c, sword.id, true), ap - c.ap, g.takeProblem(c, sword.id), g.playerTake(c, sword.id), !!sword.equipped);
        // Yours: dropping it unequips it.
        const dagger = g.makeItem('dagger');
        g.addItem(c, dagger, true);
        dagger.equipped = true;
        g.playerDrop(c, dagger.id);
        out.push(dagger.equipped);
        return out;
    });
    expect(r).toEqual([
        ['long_sword'], 8, ['long_sword*', 'belt_pouch', 'canteen', 'dagger'],
        'worn', 'worn', 'missing', ['long_sword'], 'worn',
        true, 25, '', true, false,
        undefined
    ]);
});

test('the Inventory dialog equips and unequips; the character sheet shows what\'s equipped and its armor', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const id = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), it = g.makeItem('chain_shirt');
        g.addItem(c, it, true);
        return it.id;
    });
    await page.keyboard.press('h');
    const btn = action => page.locator(`[data-item="${id}"][data-action="${action}"]`);
    await expect(btn('equip')).toHaveAttribute('title', 'Equip chain shirt (in place of what\'s equipped there), for 1 action points.');
    await btn('equip').click();
    await expect(page.getByText('chain shirt (body)')).toBeVisible();
    await expect(btn('unequip')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('i');
    await expect(page.getByText('chain shirt', {exact:true})).toBeVisible();
    const armor = page.getByText('Armor', {exact:true}).locator('xpath=..');
    await expect(armor).toContainText('2');
});

test('backgrounds give items: your character starts with them, equipped, and an enemy has them with its own', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            kinds = p => p.inventory.items.map(it => it.kind + (it.equipped ? '*' : '')).sort(),
            out = [hc.backgrounds.get('soldier').items.map(i => i.kind), kinds(c)];   // Tess, an urchin
        const base = g.baselineStats(g.character.species, 'soldier');
        g.character = {...g.character, background:'soldier', stats:{...base, str:base.str + 2}};
        g.reset();
        out.push(kinds(g.getPlayerCore()), g.goldHeld(), g.characterProblem(g.character));
        // A goblin reaver: its own short sword (equipped first) and mold cake, and a reaver's dagger
        const e = g.addPiece('core', 'enemy', 5, 5, null, 'goblin_reaver');
        out.push(kinds(e).filter(k => !k.startsWith('mold')));
        // Placed pieces get nothing.
        g.setGold(100);
        g.playerPlace(...Object.values(g.placeCells(g.getPlayerCore())[0]), g.getPlayerCore());
        out.push(g.piecesOf('player').map(p => p.inventory.items.length));
        return out;
    });
    expect(r[0]).toEqual(['canteen', 'short_sword', 'leather_armor', 'gold_coin']);
    expect(r[1].filter(k => !k.startsWith('mushroom'))).toEqual(['canteen', 'dagger*']);
    expect(r.slice(2)).toEqual([
        ['canteen', 'gold_coin', 'leather_armor*', 'short_sword*'], 5, '', ['canteen', 'dagger', 'short_sword*'], [4, 0]
    ]);
});

test('the Inventory dialog and the character sheet each switch to the other', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.keyboard.press('h');
    await expect(page.getByText('Tess · Inventory')).toBeVisible();
    await page.getByRole('button', {name:'Character', exact:true}).filter({visible:true}).click();
    await expect(page.getByText('Tess · Inventory')).toBeHidden();
    await expect(page.getByText('Tess · Human · Urchin')).toBeVisible();
    await page.getByRole('button', {name:'Inventory', exact:true}).filter({visible:true}).click();
    await expect(page.getByText('Tess · Human · Urchin')).toBeHidden();
    await expect(page.getByText('Tess · Inventory')).toBeVisible();
});
