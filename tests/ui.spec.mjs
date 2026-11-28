import {test, expect} from '@playwright/test';
import {startGame, clearBoard, cellOnPage, button, waitForGame, pressStart} from './helpers.mjs';

const settingsTitle = page => page.getByText('Settings', {exact:true}).filter({visible:true});

test('the header has every button, and End Turn ends the turn', async ({page}) => {
    await startGame(page);
    for (const name of ['End Turn', 'Center', 'Save', 'Export', 'Import', 'New game', 'Settings', 'Help']) {
        await expect(button(page, name)).toBeVisible();
    }
    await button(page, 'End Turn').click();
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(2);
});

test('help opens on a first visit only, loaded from data/help.txt', async ({page}) => {
    await startGame(page, {skipHelp:false});
    const title = page.getByText('How to Play', {exact:true}).filter({visible:true});
    await expect(title).toBeVisible();
    await expect(page.getByText(/Grow it into a swarm of linked pieces/)).toBeVisible();
    await button(page, 'X Close').click();
    await expect(title).toHaveCount(0);

    await page.reload();
    await waitForGame(page);
    await page.waitForTimeout(300);
    await expect(title).toHaveCount(0);

    await button(page, 'Help').click();
    await expect(title).toBeVisible();
});

test('keys are ignored while a dialog is open', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await button(page, 'Settings').click();
    await expect(settingsTitle(page)).toBeVisible();
    await page.keyboard.press('Enter');   // closes the dialog (its default button), not the turn
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('New Game shows the map\'s brief, which warns once the game has started', async ({page}) => {
    await startGame(page);
    const warning = page.getByText('Starting abandons the game in progress.').filter({visible:true});
    await button(page, 'New game').click();
    await expect(page.getByRole('textbox', {name:'Seed', exact:true}).filter({visible:true})).toBeVisible();
    await expect(warning).toHaveCount(0);
    await button(page, '✗ Cancel').click();
    
    await button(page, 'End Turn').click();
    await button(page, 'New game').click();
    await expect(warning).toBeVisible();
    await pressStart(page);
    expect(await page.evaluate(() => hc.app.game.turn)).toBe(1);
});

test('losing the core offers to play again', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.draw();
    });
    await expect(page.getByText('Core Destroyed', {exact:true}).filter({visible:true})).toBeVisible();
    await button(page, 'Play Again').click();
    await pressStart(page);
    expect(await page.evaluate(() => [hc.app.game.over, hc.app.game.turn])).toEqual([false, 1]);
});

test('after losing, recentering goes to the start cell', async ({page}) => {
    await startGame(page);
    await page.evaluate(() => {
        const g = hc.app.game, e = g.addPiece('core', 'enemy', 50, 50);
        g.damage(g.getPlayerCore(), 99, e);
        hc.view.cam.x = 40; hc.view.cam.y = -30;
        hc.view.draw();
    });
    await button(page, 'X Close').click();
    await button(page, 'Center').click();
    await expect.poll(() => page.evaluate(() => [hc.view.cam.x, hc.view.cam.y])).toEqual([0, 0]); // after the pan
    
    await page.evaluate(() => {hc.view.cam.x = 40; hc.view.cam.y = -30;});
    await page.keyboard.press('s');
    await expect.poll(() => page.evaluate(() => [hc.view.cam.x, hc.view.cam.y])).toEqual([0, 0]); // after the pan
});

test('Esc cancels choosing where to place', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {hc.app.game.setGold(100); hc.view.draw();});
    await page.keyboard.press('p');
    await expect(page.getByText(/Place piece: choose an empty cell/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/Place piece: choose an empty cell/)).toBeHidden();
});

test('click selects your piece; shift-click moves onto it instead', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [dx, dy] = hc.hex.dirs[1];
        g.setGold(100); g.playerPlace(dx, dy, c); g.playerWait();
        g.selectedId = c.id;
        hc.app.centerOn(false);
    });
    const [dx, dy] = await page.evaluate(() => hc.hex.dirs[1]),
        pt = await cellOnPage(page, dx, dy);
    await page.mouse.click(pt[0], pt[1]);
    expect(await page.evaluate(() => hc.app.game.selectedId !== hc.app.game.playerCoreId && hc.app.game.getPlayerCore().x === 0)).toBe(true);
    await page.evaluate(() => {hc.app.game.selectedId = hc.app.game.playerCoreId;});
    await page.keyboard.down('Shift');
    await page.mouse.click(pt[0], pt[1]);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(([dx, dy]) => {const c = hc.app.game.getPlayerCore(); return c.x === dx && c.y === dy;}, [dx, dy])).toBe(true);
});

test('shift-click moves just the piece, in Fixed or Follow', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.setGold(100);
        g.playerPlace(1, 0, c);
        g.playerWait();
        g.selectedId = c.id;
        hc.app.centerOn(false);
    });
    // Where the core and the piece linked to it are, after a shift-click to the core's left
    const shiftClick = async () => {
        await page.evaluate(() => {
            const g = hc.app.game;
            g.selectedId = g.playerCoreId;
        });
        await page.keyboard.down('Shift');
        await page.mouse.click(...await cellOnPage(page, -1, 0));
        await page.keyboard.up('Shift');
        return page.evaluate(() => hc.app.game.piecesOf('player').map(p => [p.x, p.y]).sort());
    };
    // Shift down or up, with the pointer still, shows what a click would do.
    await page.mouse.move(...await cellOnPage(page, -1, 0));
    const shiftShown = () => page.evaluate(() => hc.view.shift);
    await page.keyboard.down('Shift');
    expect(await shiftShown()).toBe(true);
    await page.keyboard.up('Shift');
    expect(await shiftShown()).toBe(false);
    expect(await shiftClick()).toEqual([[-1, 0], [1, 0]]); // the core alone
});

test('clicking a cell the selected piece can jump to jumps it there', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game;
        g.rules.apPool = '2';
        g.getPlayerCore().ap = 200;
        g.selectedId = g.playerCoreId;
        hc.app.centerOn(false);
    });
    const core = () => page.evaluate(() => {
        const c = hc.app.game.getPlayerCore();
        return [c.x, c.y, c.ap];
    });
    // Hovering shows it there, as a ghost, and a click jumps.
    await page.mouse.move(...await cellOnPage(page, 2, -1));
    expect(await page.evaluate(() => hc.view.jumpAt(hc.app.game.getPlayerCore(), hc.view.hover))).toEqual({x:2, y:-1});
    await page.mouse.click(...await cellOnPage(page, 2, -1));
    // (Spent, so the turn ended, and it got a point back.)
    expect(await core()).toEqual([2, -1, 100]);
});

test('alt-click on a piece the selected one can swap with swaps them; a click selects it', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.setGold(100);
        g.playerPlace(1, 0, c);
        g.playerWait();
        g.selectedId = c.id;
        hc.app.centerOn(false);
    });
    const state = () => page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        return {core:[c.x, c.y], selected:[g.getSelected().x, g.getSelected().y]};
    });
    // Alt held over it: shown as the pair swapped
    await page.mouse.move(...await cellOnPage(page, 1, 0));
    await page.keyboard.down('Alt');
    expect(await page.evaluate(() => [hc.view.alt, !!hc.view.swapAt(hc.app.game.getSelected(), hc.view.hover)])).toEqual([true, true]);
    await page.mouse.click(...await cellOnPage(page, 1, 0));
    await page.keyboard.up('Alt');
    expect(await state()).toEqual({core:[1, 0], selected:[1, 0]});
    // A plain click on the other piece selects it.
    await page.mouse.click(...await cellOnPage(page, 0, 0));
    expect(await state()).toEqual({core:[1, 0], selected:[0, 0]});
});

test('keyboard moves the selected piece, but not the arrow keys; Space ends the turn', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const at = () => page.evaluate(() => [hc.app.game.getPlayerCore().x, hc.app.game.getPlayerCore().y, hc.app.game.turn]);
    await page.keyboard.press('ArrowRight');
    expect(await at()).toEqual([0, 0, 1]);
    await page.keyboard.press('d');   // east
    expect(await at()).toEqual([1, 0, 2]);
    await page.keyboard.press('Space');
    expect(await at()).toEqual([1, 0, 3]);
});

test('W and X go up and down, zigzagging, and to the other side when the next is blocked', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    // (With one piece, each move ends the turn.)
    const core = () => page.evaluate(() => [hc.app.game.getPlayerCore().x, hc.app.game.getPlayerCore().y]),
        press = key => page.keyboard.press(key);
    // Up-left (Q), then up-right (E): straight up two rows.
    await press('w');
    expect(await core()).toEqual([0, -1]);
    await press('w');
    expect(await core()).toEqual([1, -2]);
    // Down, which goes left (Z) next, back the way it came; then right (C).
    await press('x');
    expect(await core()).toEqual([0, -1]);
    await press('x');
    expect(await core()).toEqual([0, 0]);
    // Up-left is next, but blocked, so up-right.
    await page.evaluate(() => {
        const g = hc.app.game;
        g.tiles.set(g.key(0, -1), g.makeTile(0, -1, 'solid', 'boulder'));
    });
    await press('w');
    expect(await core()).toEqual([1, -1]);
});

test('Enter opens the selected piece\'s menu; the arrow keys move between its items, and Enter picks one', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    await page.evaluate(() => {hc.app.game.setGold(100); hc.view.draw();});
    const focused = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => hc.view.menuOpen)).toBe(true);
    expect(await focused()).toMatch(/^Character/);
    await page.keyboard.press('ArrowUp');     // wraps round to the last item that can be used
    expect(await focused()).toMatch(/^Tree/);
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Character/);
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Inventory/);
    for (let i = 0; i < 12 && !/^Place/.test(await focused()); i++) await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Place/);
    await page.keyboard.press('Space');       // the focused item's, not the end of the turn
    await expect(page.getByText(/Place piece: choose an empty cell/)).toBeVisible();
    expect(await page.evaluate(() => [hc.view.menuOpen, hc.app.game.turn])).toEqual([false, 1]);
});

test('nearing the edge of the board pans it by one hex; elsewhere it stays put', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    // The core 20px outside the follow margin on the right, so one step east brings it in.
    const start = await page.evaluate(() => {
        const V = hc.view;
        hc.app.centerOn(false);
        V.cam.x -= (V.W / 2 - (V.W / 2 * hc.cfg.FOLLOW_MARGIN / 100 + 20)) / V.cam.size;
        V.draw();
        return V.cam.x;
    });
    await page.keyboard.press('a'); // west: away from the edge, so no pan
    expect(await page.evaluate(() => hc.view.cam.x)).toBe(start);
    await page.keyboard.press('Space');
    await page.keyboard.press('d'); // back east
    await page.keyboard.press('Space');
    await page.keyboard.press('d'); // east, within the margin
    expect(await page.evaluate(() => hc.view.camTarget()[0])).toBe(start + 1); // panning there...
    await expect.poll(() => page.evaluate(() => hc.view.cam.x)).toBe(start + 1); // ...and there
});

test('the follow margin is a preference, kept from 5 to 45%', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const out = [hc.cfg.FOLLOW_MARGIN];
        hc.settings.set('followMargin', 99);
        out.push(hc.cfg.FOLLOW_MARGIN, JSON.parse(localStorage.getItem('hc.prefs')).followMargin);
        hc.settings.set('followMargin', 2);
        return [...out, hc.cfg.FOLLOW_MARGIN];
    })).toEqual([30, 45, 45, 5]);
});

test('the canvas keeps its pixels matched to its size on the page as the window resizes', async ({page}) => {
    await startGame(page);
    // Its size on the page times the pixel ratio, and its backing store's
    const sizes = () => page.evaluate(() => {
        const c = hc.view.canvas, r = c.getBoundingClientRect();
        return [[Math.round(r.width * devicePixelRatio), Math.round(r.height * devicePixelRatio)], [c.width, c.height]];
    });
    for (const [width, height] of [[1280, 500], [900, 700], [1280, 720]]) {
        await page.setViewportSize({width, height});
        await expect.poll(async () => {
            const [shown, store] = await sizes();
            return shown.join() === store.join();
        }).toBe(true);
    }
});

test('the selection stays on a piece after it moves', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, core = g.getPlayerCore();
        g.setGold(100);
        g.playerPlace(1, 0, core);
        g.playerPlace(-1, 0, core);
        g.playerWait();
        const a = g.pieceAt(1, 0);
        g.selectedId = a.id;
        g.playerAct(a, 2, 0);
        return [g.selectedId === a.id, g.canMove(a), g.turn];
    });
    expect(r).toEqual([true, false, 2]); // a can't move again, but stays selected
});

test('the info panel: the map and seed on a line, then the selected piece\'s name, level and bars', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        c.needs.thirst = 0;
        c.hp = 1;
        hc.view.draw();
        return [g.gameMap.name, g.seed, c.maxHp, g.needBounds(c, 'thirst').max / 100];
    });
    const [map, seed, maxHp, maxThirst] = r;
    await expect(page.getByText(`${map} · seed ${seed}`, {exact:true})).toBeVisible();
    await expect(page.getByText('Tess · level 1', {exact:true})).toBeVisible();
    const bar = label => page.locator('.myt-HudBar').filter({has:page.getByText(label, {exact:true})});
    for (const label of ['AP', 'HP', 'Thirst', 'Hunger', 'Fatigue', 'XP']) await expect(bar(label)).toBeVisible();
    await expect(bar('HP')).toContainText(`1/${maxHp}`);
    await expect(bar('Thirst')).toContainText(`0/${maxThirst}`);
    await expect(bar('AP')).toContainText('1/1');
    // Another piece, selected: its own
    await page.evaluate(() => {
        const g = hc.app.game;
        g.setGold(100);
        const {x, y} = g.placeCells(g.getPlayerCore())[0];
        g.playerPlace(x, y, g.getPlayerCore());
        g.selectedId = g.pieceAt(x, y).id;
        g.pieceAt(x, y).parentId = null;
        hc.view.draw();
    });
    await expect(page.getByText('Detached piece · level 1', {exact:true})).toBeVisible();
});

test('the info panel: a need\'s value is green while it does the piece good, red while it harms it; AP past whole points is lighter', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const bar = label => page.locator('.myt-HudBar').filter({has:page.getByText(label, {exact:true})});
    await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), b = n => g.needBounds(c, n);
        g.rules.thirstHighRecovery = '0.1';
        g.rules.hungerLowHp = '-0.25';
        g.rules.fatigueLowStats = '0';
        g.rules.fatigueLowRecovery = '0';
        g.rules.fatigueLowHp = '0';
        c.needs.thirst = b('thirst').max;
        c.needs.hunger = b('hunger').min;
        c.needs.fatigue = b('fatigue').min;    // low, but it does nothing
        c.ap = 150;
        g.rules.apPool = '2';
        hc.view.draw();
    });
    const color = async label => (await bar(label).locator('.myt-PlainText').last().evaluate(e => e.style.color));
    expect(await color('Thirst')).toBe('var(--gain)');
    expect(await color('Hunger')).toContain('var(--');
    expect(await color('Hunger')).not.toBe('var(--gain)');
    expect(await color('Fatigue')).toBe(await color('XP'));
    // The AP bar: a whole point in white, the half past it lighter
    const widths = await bar('AP').evaluate(e => [...e.querySelectorAll('div')].filter(d => d.style.backgroundColor.includes('ap-bar'))
        .map(d => [d.style.backgroundColor, parseFloat(d.style.width)]));
    const full = widths.find(([c]) => c === 'var(--ap-bar)')[1], partial = widths.find(([c]) => c.includes('partial'))[1];
    expect(partial).toBeCloseTo(full * 1.5, 0);
});
