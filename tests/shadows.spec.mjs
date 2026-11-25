import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

/*  How bright the canvas is (r + g + b) at a point of cell (x, y): fy of the way from the
    middle of its top edge (0) to the middle of its bottom edge (1), or past either; with
    shadows on and off. */
const brightness = (page, x, y, fy) => page.evaluate(([x, y, fy]) => {
    const V = hc.view,
        // (Drawn first, and with no pan going on, so the cell is where it's looked for.)
        at = () => {
            V.stopPan();
            V.render(performance.now());
            const ys = hc.hex.corners(x, y).map(([wx, wy]) => V.worldToScreen(wx, wy)[1]),
                top = Math.min(...ys), bottom = Math.max(...ys),
                [cx] = V.cellCenter(x, y),
                d = V.canvas.getContext('2d').getImageData(Math.round(cx * V.dpr), Math.round((top + fy * (bottom - top)) * V.dpr), 1, 1).data;
            return d[0] + d[1] + d[2];
        },
        on = at();
    hc.cfg.SHADOW.on = false;
    const off = at();
    hc.cfg.SHADOW.on = true;
    return {on, off};
}, [x, y, fy]);

test('the light comes from init.json5\'s "shadow", and a subtype may have its own shadowLength', async ({page}) => {
    expect(await page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
        const {on, ...light} = hc.cfg.SHADOW;
        done([on, Object.keys(light).sort(), Object.keys(light).every(k => light[k] === data.shadow[k]), hc.solids.get('stone_wall').shadowLength]);
    })))).toEqual([true, ['angle', 'blur', 'color', 'length'], true, null]);
});

test('with the light above, a solid casts a shadow on the floor below it, and a hole one into it from its top rim', async ({page}) => {
    await page.evaluate(() => {
        const g = hc.app.game;
        // A light straight above (whatever init.json5 has)
        Object.assign(hc.cfg.SHADOW, {angle:90, color:'#0003', blur:2, length:0.5});
        g.tiles.set(g.key(2, 0), g.makeTile(2, 0, 'solid', 'stone_wall'));
        g.tiles.set(g.key(-2, 0), g.makeTile(-2, 0, 'hole', 'pit'));
        hc.app.centerOn(false);
    });
    // Just below the solid: darker with shadows; just above it: the same.
    const below = await brightness(page, 2, 0, 1.15),
        above = await brightness(page, 2, 0, -0.15);
    expect(below.on).toBeLessThan(below.off);
    expect(above.on).toBe(above.off);
    // In the hole, near its top rim: darker; near its bottom: the same.
    const top = await brightness(page, -2, 0, 0.1),
        bottom = await brightness(page, -2, 0, 0.9);
    expect(top.on).toBeLessThan(top.off);
    expect(bottom.on).toBe(bottom.off);
});

test('Shadows is a preference in Settings', async ({page}) => {
    expect(await page.evaluate(() => {
        hc.settings.set('shadows', false);
        const out = [hc.cfg.SHADOW.on, JSON.parse(localStorage.getItem('hc.prefs')).shadows];
        hc.settings.set('shadows', true);
        return out;
    })).toEqual([false, false]);
});
