import {test, expect} from '@playwright/test';
import {startGame, clearBoard, button} from './helpers.mjs';

test.describe('fog of war', () => {
    test.beforeEach(async ({page}) => {
        await startGame(page);
        await clearBoard(page);
    });
    
    test('cells within the vision radius are in sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const sight = hc.app.game.cellsInSight(), R = hc.cfg.VISION.radius;
            return {edge:sight.has(R + ',0'), beyond:sight.has((R + 1) + ',0'), count:sight.size === 3*R*R + 3*R + 1};
        });
        expect(r).toEqual({edge:true, beyond:false, count:true});
    });
    
    test('solid tiles block sight but can be seen themselves', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, solid = (x, y) => g.tiles.set(g.key(x, y), {x, y, kind:'solid', timer:0});
            for (let y = -3; y <= 3; y++) solid(2, y);
            const sight = g.cellsInSight();
            return {wall:sight.has('2,0'), behind:sight.has('3,0'), farBehind:sight.has('6,0'), beside:sight.has('0,3')};
        });
        expect(r).toEqual({wall:true, behind:false, farBehind:false, beside:true});
    });
    
    test('hole tiles don\'t block sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            for (let y = -3; y <= 3; y++) g.tiles.set(g.key(2, y), {x:2, y, kind:'hole', timer:0});
            const sight = g.cellsInSight();
            return {hole:sight.has('2,0'), behind:sight.has('3,0'), farBehind:sight.has('6,0')};
        });
        expect(r).toEqual({hole:true, behind:true, farBehind:true});
    });
    
    test('a line along an edge is blocked only when both cells beside it are solid', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, solid = (x, y) => g.tiles.set(g.key(x, y), {x, y, kind:'solid', timer:0}),
                target = {x:2, y:-1}; // the line from (0,0) runs between (1,-1) and (1,0)
            solid(1, -1);
            const one = g.canSee(g.playerCore, target);
            solid(1, 0);
            return {one, both:g.canSee(g.playerCore, target)};
        });
        expect(r).toEqual({one:true, both:false});
    });
    
    test('cells stay seen once in sight', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            g.cellsInSight();
            hc.cfg.VISION.radius = 1;
            return {inSight:g.cellsInSight().has('3,0'), seen:g.seenCells.has('3,0'), neverSeen:g.seenCells.has('13,0')};
        });
        expect(r).toEqual({inSight:false, seen:true, neverSeen:false});
    });
});

test('fog of war can be turned off and its radius changed in Settings', async ({page}) => {
    await startGame(page);
    await clearBoard(page); // so no random solid tile blocks the cells checked below
    await button(page, 'Settings').click();
    const radius = page.locator('input[data-setting="visionRadius"]');
    await radius.fill('5');
    await radius.press('Enter');
    expect(await page.evaluate(() => hc.app.game.cellsInSight().has('5,0') && !hc.app.game.cellsInSight().has('6,0'))).toBe(true);
    
    await page.getByText('Fog of war', {exact:true}).click();
    expect(await page.evaluate(() => [hc.app.game.cellsInSight(), JSON.parse(localStorage.getItem('hc.settings')).endless.fog])).toEqual([null, false]);
    
    await button(page, 'Reset to Defaults').click();
    expect(await page.evaluate(() => [hc.cfg.VISION.fog, hc.cfg.VISION.radius])).toEqual([true, 12]);
});
