import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putFixture, cellOnPage, button} from './helpers.mjs';

/*  Items and inventories (see Items.js). Tests add their own item kinds to the data's:
    "pebble" (1 g, 1 cm³, stacks of 3), "brick" (1 kg, 500 cm³) and "box" (holds 2
    things, up to 600 g). */
const addTestItems = page => page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
    hc.items.define({
        ...data.items,
        pebble:{name:'pebble', description:'', volume:1, weight:1, stack:3},
        brick:{name:'brick', description:'', volume:500, weight:1000},
        box:{name:'box', description:'', volume:2000, weight:100, inventory:{capacity:2, weight:600}}
    });
    done();
})));

test('an item\'s weight is its volume times its material\'s density, unless it says', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const steel = hc.solids.getMaterial('steel').density;
        return [hc.items.get('dagger').weight, 65 * steel, hc.items.get('husk').weight, hc.items.get('gold_coin').stack,
            hc.items.get('corpse').inventory.weight, hc.items.get('small_corpse').name];
    });
    expect(r[0]).toBeCloseTo(r[1]);
    expect(r.slice(2)).toEqual([3000, 100000, Infinity, 'corpse']);
});

test('items of a kind that stacks go into its stacks, up to a stack each, then new ones', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await addTestItems(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            counts = () => c.inventory.items.map(it => it.kind + ':' + it.count);
        g.addItem(c, g.makeItem('pebble', 2));
        const one = counts();
        g.addItem(c, g.makeItem('pebble', 5));
        const more = counts();
        // A named one doesn't stack.
        const odd = g.makeItem('pebble');
        odd.name = 'odd pebble';
        g.addItem(c, odd);
        return [one, more, counts(), g.countOf(c, 'pebble'), g.itemLabel(c.inventory.items[1]), g.itemLabel(odd)];
    });
    expect(r).toEqual([['pebble:2'], ['pebble:3', 'pebble:3', 'pebble:1'], ['pebble:3', 'pebble:3', 'pebble:1', 'pebble:1'], 8,
        '3 pebbles', 'odd pebble']);
});

test('an inventory\'s limits: capacity (a stack each), weight and volume; nothing goes in itself', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await addTestItems(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            box = g.makeItem('box'), inner = g.makeItem('box');
        const out = [g.addItem(box, g.makeItem('brick'))];          // 1000 g: over 600
        out.push(g.addItem(box, g.makeItem('pebble', 3)), g.addItem(box, g.makeItem('pebble', 1)));  // two stacks
        // No room for a third stack (the first limit it's over: a brick is too heavy too)
        out.push(g.addProblem(box, g.makeItem('brick')), g.addProblem(box, g.makeItem('pebble', 3)));
        out.push(g.fitCount(box, g.makeItem('pebble', 10)));          // only the second stack's room
        out.push(g.addItem(box, box), g.addItem(inner, g.makeItem('pebble')), g.addItem(box, inner));
        // The weight it holds counts against what holds it; the box's limits are its kind's.
        g.rules.carryWeight = '100';
        out.push(g.addProblem(c, box), g.inventoryTotals({inventory:{items:[box]}}).weight, g.itemWeight(box));
        g.rules.carryWeight = '1000000';
        g.rules.carryVolume = '1999';
        out.push(g.addProblem(c, box));
        g.rules.carryVolume = '1000000';
        g.rules.carryCapacity = '0';
        out.push(g.addProblem(c, box));
        return out;
    });
    expect(r).toEqual(['weight', '', '', 'capacity', 'capacity', 2, 'loop', '', 'capacity', 'weight', 104, 104, 'volume', 'capacity']);
});

test('a piece that dies leaves its corpse, named for it, holding what it had; a species can leave none', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            e = g.addPiece('core', 'enemy', 1, 0, null, 'goblin_reaver'),
            had = e.inventory.items.map(it => it.kind);
        g.damage(e, 100, c);
        const ground = g.groundAt(1, 0).inventory.items,
            corpse = ground[0];
        // A creeper leaves a husk; with a corpse of "none", only what it had.
        g.addPiece('core', 'enemy', -1, 0);
        g.damage(g.pieceAt(-1, 0), 10);
        const husk = g.groundAt(-1, 0).inventory.items.map(it => it.name);
        hc.species.get('creeper').corpse = 'none';
        const bare = g.addPiece('core', 'enemy', 0, 1);
        g.addItem(bare, g.makeItem('dagger'), true);
        g.damage(bare, 10);
        delete hc.species.get('creeper').corpse;
        return {
            had, ground:ground.length, kind:corpse.kind, name:corpse.name, inside:corpse.inventory.items.map(it => it.kind),
            husk, bare:g.groundAt(0, 1).inventory.items.map(it => it.kind)
        };
    });
    expect(r.had[0]).toBe('dagger');
    expect(r).toMatchObject({
        ground:1, kind:'small_corpse', name:'goblin corpse', inside:r.had, husk:['creeper husk'], bare:['dagger']
    });
});

test('your piece\'s corpse is named for it', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const name = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.damage(c, 100);
        return g.groundAt(c.x, c.y).inventory.items[0].name;
    });
    expect(name).toBe('corpse of Tess');
});

test('enemies carry what their profile gives them, rolled for each', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            jerky = Array.from({length:30}, (_, i) => g.countOf(g.addPiece('core', 'enemy', 3 + i, 5, null, 'goblin'), 'mushroom_jerky')),
            reaver = g.addPiece('core', 'enemy', 0, 9, null, 'hobgoblin_reaver');
        return [Math.min(...jerky), Math.max(...jerky), reaver.inventory.items.map(it => it.kind)];
    });
    expect(r).toEqual([0, 2, ['short_sword', 'belt_pouch']]);
});

test('loot gives gold coins to the piece that takes it; what it can\'t carry falls on the ground', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await putFixture(page, 1, 0, 'loot', {pool:50});
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            coin = hc.items.get('gold_coin').weight;
        g.rules.carryWeight = String(coin * 20.5);   // 20 coins
        g.playerAct(c, 1, 0);
        return [g.countOf(c, 'gold_coin'), g.goldHeld(), g.lootTaken, g.countOf(g.groundAt(1, 0), 'gold_coin')];
    });
    expect(r).toEqual([20, 20, 50, 30]);
});

test('placing a piece spends gold from what its parent carries first, then the others\'', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.setGold(10);
        g.playerPlace(1, 0, c);              // 5
        const p = g.pieceAt(1, 0);
        g.giveItem(p, g.makeItem('gold_coin', 3));
        g.playerPlace(2, 0, p);              // 5: p's 3, then 2 of the core's
        return [g.countOf(c, 'gold_coin'), g.countOf(p, 'gold_coin'), g.goldHeld(), g.placeCost(), g.canAffordPlace()];
    });
    expect(r).toEqual([3, 0, 3, 6, false]);
});

test('your piece takes from the ground under it, and drops there, each for an action', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await addTestItems(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            ground = g.groundAt(c.x, c.y, true),
            box = g.makeItem('box'), pebbles = g.makeItem('pebble', 3), brick = g.makeItem('brick');
        g.addItem(box, pebbles);
        g.addItem(ground, box);
        g.addItem(ground, brick);
        const out = [];
        // (So the turn doesn't end once no piece has the points: there's always placing.)
        g.rules.placeCost = '0';
        // Out of the box on the ground: as much as it can carry (2 g: 2 of the 3).
        g.rules.carryWeight = '2';
        out.push(g.takeProblem(c, brick.id), g.playerTake(c, pebbles.id), g.countOf(c, 'pebble'), g.countOf(box, 'pebble'), c.ap);
        out.push(g.takeProblem(c, pebbles.id));   // no points left
        g.rules.carryWeight = '1000000';
        c.ap = g.apMax(c);
        out.push(g.playerTake(c, box.id), g.groundAt(c.x, c.y).inventory.items.map(it => it.kind));
        c.ap = g.apMax(c);
        // Dropping what's in something it carries
        out.push(g.playerDrop(c, pebbles.id), g.countOf(c, 'pebble'), g.countOf(g.groundAt(c.x, c.y), 'pebble'));
        c.ap = g.apMax(c);
        out.push(g.dropProblem(c, 999), g.playerDrop(c, c.inventory.items[0].id));
        // The ground keeps nothing it doesn't hold.
        c.ap = g.apMax(c);
        for (const it of [...g.groundAt(c.x, c.y).inventory.items]) {
            c.ap = g.apMax(c);
            g.playerTake(c, it.id);
        }
        out.push(g.groundAt(c.x, c.y));
        return out;
    });
    expect(r).toEqual(['weight', true, 2, 1, 0, 'ap', true, ['brick'], true, 2, 1, 'missing', true, undefined]);
});

test('inventories and what\'s on the ground are saved', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            corpse = g.makeItem('corpse');
        g.addItem(corpse, g.makeItem('dagger'));
        g.addItem(g.groundAt(3, 3, true), corpse);
        g.setGold(17);
        const saved = JSON.parse(JSON.stringify(g.exportToObj()));
        g.reset();
        g.importFromObj(saved);
        const again = g.groundAt(3, 3).inventory.items[0];
        // Not shared with the save
        saved.ground[0].inventory.items.length = 0;
        return [g.goldHeld(), again.kind, again.inventory.items[0].kind, g.nextItemId === saved.nextItemId,
            g.groundAt(3, 3).inventory.items.length];
    });
    expect(r).toEqual([17, 'corpse', 'dagger', true, 1]);
});

test('a save with a bad inventory is refused', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game,
            saved = g.exportToObj();
        saved.pieces[0].inventory = {items:[{id:1, kind:'dagger', count:0}]};
        try {
            g.importFromObj(saved);
            return 'loaded';
        } catch (err) {
            return err.message;
        }
    });
    expect(r).toBe('Malformed game data');
});

test('weights and volumes show in the Units preference\'s units', async ({page}) => {
    await startGame(page);
    const r = await page.evaluate(() => {
        const out = [hc.formatWeight(2360), hc.formatVolume(300), hc.formatWeight(66500)];
        hc.settings.set('units', 'imperial');
        out.push(hc.formatWeight(2360), hc.formatVolume(3785.411784 * 2.5));
        hc.settings.set('units', 'metric');
        return out;
    });
    expect(r).toEqual(['2.36 kg', '0.3 L', '66.5 kg', '5.2 lb', '2.5 gal']);
});

test('the Inventory dialog (H) lists what your piece carries and what\'s on the ground; Take takes it', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const ids = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            corpse = g.makeItem('corpse'), dagger = g.makeItem('dagger');
        corpse.name = 'goblin corpse';
        g.addItem(corpse, dagger);
        g.addItem(g.groundAt(c.x, c.y, true), corpse);
        g.setGold(12);
        return {dagger:dagger.id, corpse:corpse.id};
    });
    await page.keyboard.press('h');
    const dialog = page.locator('body');
    await expect(dialog.getByText('Tess · Inventory')).toBeVisible();
    await expect(dialog.getByText('12 gold coins')).toBeVisible();
    await expect(dialog.getByText('goblin corpse')).toBeVisible();
    await expect(dialog.getByText('dagger', {exact:true})).toBeVisible();
    // The corpse is too heavy (66.5 kg); the dagger in it can be taken.
    const take = id => page.locator(`[data-item="${id}"]`);
    await expect(take(ids.corpse)).toHaveClass(/disabled/);
    await expect(take(ids.corpse)).toHaveAttribute('title', 'It\'s too heavy.');
    await take(ids.dagger).click();
    // It's carried now, to drop; with no points left, nothing more can be.
    await expect(take(ids.dagger)).toHaveText('Drop');
    await expect(take(ids.dagger)).toHaveAttribute('title', 'Not enough action points.');
    await expect(take(ids.corpse)).toHaveAttribute('title', 'Not enough action points.');
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        return [c.inventory.items.map(it => it.kind), g.groundAt(c.x, c.y).inventory.items[0].inventory.items.length];
    });
    expect(r).toEqual([['gold_coin', 'dagger'], 0]);
    await button(page, 'X Close').click();
    await expect(dialog.getByText('Tess · Inventory')).toBeHidden();
});

test('pointing at a cell with things on the ground says what they are', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.addItem(g.groundAt(2, 0, true), g.makeItem('gold_coin', 7));
        g.addItem(g.groundAt(2, 0), g.makeItem('club'));
        hc.view.draw();
    });
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText('On the ground: 7 gold coins, club')).toBeVisible();
});
