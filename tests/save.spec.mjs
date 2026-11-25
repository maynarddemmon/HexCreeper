import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button, waitForGame} from './helpers.mjs';

const mapsTitle = page => page.getByText('Maps', {exact:true}).filter({visible:true});

// Plays a few turns so there's something worth saving: placed pieces, moves, tiles seen.
const playABit = page => page.evaluate(() => {
    const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
    g.score = 100;
    g.playerPlace(D[0][0], D[0][1], c);
    g.playerWait();
    g.playerWait();
    hc.view.draw();
});

// The parts of the game a save must bring back.
// The cells seen are brought up to date first, as drawing the board does, since a frame
// may not have been drawn since the last change.
const snapshot = page => page.evaluate(() => {
    hc.app.game.cellsInSight();
    const g = hc.app.game,
        T = g.tileGenerator,
        sorted = a => [...a].sort();
    return {
        turn:g.turn, score:g.score, scoreEarned:g.scoreEarned, over:g.over, quadRadius:hc.app.game.tileGenerator.quads.radius,
        pieces:[...g.pieces.values()].map(p => JSON.stringify(p)).sort(),
        tiles:[...g.tiles.values()].map(t => JSON.stringify(t)).sort(),
        components:[T.type, g.spawnGenerator.type, g.enemyAI.type, JSON.stringify(g.enemyAI.attrs)], rules:JSON.stringify(g.rules),
        terrainQuads:sorted(T.terrainQuads), tiledQuads:sorted(T.tiledQuads), visitedQuads:sorted(T.visitedQuads),
        seenCells:sorted(g.seenCells), borders:[...T.borders].map(String).sort(), corePath:g.corePath,
        coreAt:hc.app.game.pieceAt(g.getPlayerCore().x, g.getPlayerCore().y)?.id === g.playerCoreId,
        selectedId:g.selectedId
    };
});

const saveWithButton = async page => {
    await button(page, 'Save').click();
    await button(page, '✓ Confirm').click();
    await expect(page.getByText('Save Succeeded', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Acknowledge').click();
};

test('saving with the header button, then reloading, carries on the same game', async ({page}) => {
    await startGame(page);
    await playABit(page);
    await saveWithButton(page);
    // Taken after saving: what's in sight is only worked out as the board is drawn, so
    // before then the cells seen may not be up to date yet.
    const before = await snapshot(page);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hc.save')).version)).toBe(1);

    await page.reload();
    await waitForGame(page);
    expect(await snapshot(page)).toEqual(before);
});

test('a game\'s rules are saved with it, whatever its map now says', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.placeCost = '9 * coreLevel';
        const data = JSON.parse(JSON.stringify(g.exportToObj()));
        g.reset();
        const before = g.rules.placeCost;
        g.importFromObj(data);
        return [before, g.rules.placeCost];
    })).toEqual(['4 + ceil(levels / 2)', '9 * coreLevel']);
});

test('pieces\' status effects are saved with them; ones that make no sense are dropped', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.addEffect(c, 'exhausted', 2);
        const data = JSON.parse(JSON.stringify(g.exportToObj())),
            core = data.pieces.find(p => p.id === c.id);
        core.effects.push({id:'stunned', countdown:0}, {countdown:3}, 'dazed');
        g.importFromObj(data);
        const out = [g.getPlayerCore().effects];
        delete core.effects;    // from before effects
        g.importFromObj(data);
        out.push(g.getPlayerCore().effects);
        return out;
    })).toEqual([[{id:'exhausted', countdown:2}], []]);
});

test('without a save, a reload starts a new game', async ({page}) => {
    await startGame(page);
    await playABit(page);
    await page.reload();
    await waitForGame(page);
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('a save that can\'t be used is cleared, with a message, then the maps are shown', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {localStorage.setItem('hc.save', JSON.stringify({version:1, format:'compact', data:{turn:'nope'}}));});
    await page.reload();
    await waitForGame(page);
    await expect(page.getByText('Save Could Not Be Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await page.evaluate(() => [hc.app.game.turn, localStorage.getItem('hc.save')])).toEqual([1, null]);
    await expect(mapsTitle(page)).toHaveCount(0);
    await button(page, 'Acknowledge').click();
    await expect(mapsTitle(page)).toBeVisible();
});

test('after losing, a last save that can\'t be used shows the maps after the message', async ({page}) => {
    await startGame(page);
    await saveWithButton(page);
    await page.evaluate(() => {
        localStorage.setItem('hc.save', JSON.stringify({version:1, format:'compact', data:{turn:'nope'}}));
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.draw();
    });
    await button(page, 'Load Last Save').click();
    await expect(page.getByText('Save Could Not Be Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Acknowledge').click();
    await expect(mapsTitle(page)).toBeVisible();
});

test('after losing, the last save can be loaded', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await playABit(page);
    await saveWithButton(page);
    const before = await snapshot(page); // after saving, as above

    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.draw();
    });
    await expect(page.getByText('Core Destroyed', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Load Last Save').click();
    expect(await snapshot(page)).toEqual(before);
});

// Picks a file for the import after confirming it. contents is a string.
const importFile = async (page, contents) => {
    await button(page, 'Import').click();
    const chooser = page.waitForEvent('filechooser');
    await button(page, '✓ Confirm').click();
    await (await chooser).setFiles({name:'save.json', mimeType:'application/json', buffer:Buffer.from(contents)});
};

for (const format of ['compact', 'pretty']) {
    test(`a game exported to a ${format} file can be imported again, and is saved`, async ({page}) => {
        await startGame(page);
        await page.evaluate(format => {hc.cfg.EXPORT_FORMAT = format;}, format);
        await playABit(page);
        const before = await snapshot(page);
        
        const download = page.waitForEvent('download');
        await button(page, 'Export').click();
        const file = await download,
            contents = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
        expect(file.suggestedFilename()).toBe('hexcreeper-save.json');
        expect(JSON.parse(contents)).toMatchObject({version:1, format});
        expect(contents.includes('\n')).toBe(format === 'pretty');
        
        await button(page, 'New game').click();
        await button(page, '✓ Start').click();
        expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
        
        await importFile(page, contents);
        await expect(page.getByText('Import Succeeded', {exact:true}).filter({visible:true})).toBeVisible();
        expect(await snapshot(page)).toEqual(before);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hc.save')))).toMatchObject({format:'compact', data:{turn:before.turn}});
    });
}

for (const [what, contents, msg] of [
    ['not JSON', 'not a save', 'That file is not a HexCreeper save file.'],
    ['not a save', JSON.stringify({version:1, format:'compact', data:{turn:'nope'}}), 'That file could not be imported because it could not be applied.'],
    ['without a format', JSON.stringify({version:1, data:{}}), 'That file could not be imported because it is in an unknown format (undefined).'],
    ['in an unknown format', JSON.stringify({version:1, format:'zipped', data:{}}), 'That file could not be imported because it is in an unknown format (zipped).'],
    ['from an unsupported version', JSON.stringify({version:0.5, format:'compact', data:{}}), 'That file could not be imported because it is from an unsupported version (0.5).']
]) {
    test(`importing a file that is ${what} changes nothing`, async ({page}) => {
        await startGame(page);
        await playABit(page);
        const before = await snapshot(page);
        await importFile(page, contents);
        await expect(page.getByText('Import Failed', {exact:true}).filter({visible:true})).toBeVisible();
        await expect(page.getByText(msg, {exact:false})).toBeVisible();
        expect(await snapshot(page)).toEqual(before);
        expect(await page.evaluate(() => localStorage.getItem('hc.save'))).toBe(null);
    });
}
