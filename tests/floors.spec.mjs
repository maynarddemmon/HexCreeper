import {test, expect} from '@playwright/test';
import {startGame, clearBoard, putFixture, cellOnPage} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

// Floor tiles of kind subtype at the cells given, [[x, y], ...]
const putFloors = (page, subtype, cells) => page.evaluate(([subtype, cells]) => {
    const g = hc.app.game;
    for (const [x, y] of cells) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'floor', subtype));
}, [subtype, cells]);

test('floor kinds come from init.json5, with a moveCost; bad ones are refused', async ({page}) => {
    const errors = [];
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    expect(await page.evaluate(() => hc.floors.list().map(f => [f.id, f.moveCost]))).toEqual([['loose_stone', 1.5], ['mud', 2], ['ice', 1.5]]);
    expect(await page.evaluate(() => {
        hc.floors.define({ok:{name:'Ok'}, free:{name:'Free', moveCost:0}, odd:{name:'Odd', moveCost:'lots'}});
        const out = hc.floors.list().map(f => [f.id, f.moveCost]);
        return new Promise(done => hc.maps.loadIndex(data => {
            hc.floors.define(data.floors);
            done(out);
        }));
    })).toEqual([['ok', 1]]);
    expect(errors.filter(e => /^Bad floor/.test(e)).sort()).toEqual(['Bad floor free', 'Bad floor odd']);
});

test('a floor blocks neither sight nor movement, and a fixture can sit on it', async ({page}) => {
    await putFloors(page, 'mud', [[1, 0]]);
    await putFixture(page, 1, 0, 'loot', {pool:5});
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), score = g.score;
        return [g.isOpen(1, 0), g.seeThrough(1, 0), g.playerAct(c, 1, 0), c.x, g.score - score];
    })).toEqual([true, 1, true, 1, 5]);
});

test('a step onto dear going costs its moveCost times an action; a group pays for its dearest cell', async ({page}) => {
    await putFloors(page, 'mud', [[1, 0], [1, -1]]);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.apPool = '4';
        g.score = 100;
        c.ap = 400;
        g.playerAct(c, 1, 0);                    // onto mud: 2
        out.push(c.ap);
        g.playerAct(c, 2, 0);                    // onto plain floor: 1
        out.push(c.ap);
        // Back, with a piece below it that lands on mud: the group pays 2.
        g.playerPlace(3, 0, c);
        g.pieceAt(3, 0).ap = 0;
        c.ap = 400;
        g.moveMode = 'fixed';
        g.playerAct(c, 1, 0);                    // the core onto mud, its child onto (2, 0)
        out.push(c.ap, g.pieceAt(2, 0) ? 'moved' : 'not');
        g.playerAct(c, 0, 0);                    // the core onto plain floor, the child onto mud
        out.push(c.ap);
        return out;
    })).toEqual([200, 100, 200, 'moved', 0]);
});

test('dear going never costs more than a piece\'s whole pool, but needs all of it', async ({page}) => {
    await putFloors(page, 'mud', [[1, 0]]);
    expect(await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.apPool = '1.5';
        g.rules.apRecovery = '0';   // (so the turn ending, once it's spent, gives nothing back)
        c.ap = 140;
        out.push(g.findMove(c, 1, 0), g.moveCost(c, g.findMove(c, 1, 0, 'fixed', false)));
        c.ap = 150;
        out.push(g.playerAct(c, 1, 0), c.ap);
        return out;
    })).toEqual([null, 150, true, 0]);
});

test('enemies count dear going on their way to you', async ({page}) => {
    // A corridor along y = 0, walled in, with mud at (1, 0)
    expect(await page.evaluate(() => {
        const g = hc.app.game;
        for (const {x, y} of hc.hex.disk(0, 0, 4)) {
            if (y !== 0) g.tiles.set(g.key(x, y), g.makeTile(x, y, 'solid', 'stone_wall'));
        }
        g.tiles.set('1,0', g.makeTile(1, 0, 'floor', 'mud'));
        const field = g.distanceField(g.piecesOf('player'));
        // (1, 0) steps onto your core's plain cell: 1; (2, 0) onto the mud first: 2 more.
        return [field.get('1,0'), field.get('2,0'), field.get('3,0')];
    })).toEqual([1, 3, 4]);
});

test('Go to goes round dear going when that\'s cheaper', async ({page}) => {
    await putFloors(page, 'mud', [[1, 0], [2, 0], [3, 0]]);
    const route = await page.evaluate(() => {
        hc.cfg.VISION.fog = false;
        return hc.app.game.routeTo(hc.app.game.getPlayerCore(), 4, 0);
    });
    expect(route.at(-1)).toEqual([4, 0]);
    expect(route.some(([x, y]) => y === 0 && x >= 1 && x <= 3)).toBe(false);
});

test('pointing at a floor says what it is and what a step onto it costs', async ({page}) => {
    await putFloors(page, 'mud', [[2, 0]]);
    await page.evaluate(() => {
        hc.app.centerOn(false);
        hc.view.draw();
    });
    await page.mouse.move(...await cellOnPage(page, 2, 0));
    await expect(page.getByText('Mud (a step onto it costs ×2) · Thick mud that sucks at your feet.')).toBeVisible();
});
