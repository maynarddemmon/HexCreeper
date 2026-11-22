// Shared helpers for driving the game from tests.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = 8766,
    BASE_URL = 'http://localhost:' + PORT;

/*  Loads the game and waits until it is ready to play. Returns an object that collects page
    errors, console warnings and console errors for the rest of the test.

    The help that opens on a first visit is skipped unless skipHelp is false. Requests to other origins (e.g. the Font Awesome CDN
    used by myt) are answered with an empty response so the tests never depend on the
    network. */
export const startGame = async (page, {skipHelp=true} = {}) => {
    const problems = {pageErrors:[], warnings:[], errors:[]};
    page.on('pageerror', err => problems.pageErrors.push(err.message));
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'warning') problems.warnings.push(msg.text());
        if (type === 'error') problems.errors.push(msg.text());
    });

    await page.route(url => url.origin !== BASE_URL, route => route.fulfill({status:200, body:''}));
    if (skipHelp) await page.addInitScript(() => {localStorage.setItem('hc.helpSeen', 'true');});

    await page.goto('/index.html');
    await waitForGame(page);
    return problems;
};

/*  Waits until the App exists and its game has started. Without a save, the game starts
    from the map brief, so its Start button is clicked when it shows. */
export const waitForGame = async page => {
    const isReady = () => window.hc?.app?.ready && window.hc.app.game.getPlayerCore() != null,
        start = button(page, '✓ Start');
    while (!await page.evaluate(isReady)) {
        if (await start.count()) await start.click();
        await page.waitForTimeout(50);
    }
};

/*  Clears the board for a rules test: no enemies, no tiles, and no waves, so a test can
    place exactly what it needs. */
export const clearBoard = page => page.evaluate(() => {
    const g = hc.app.game;
    for (const e of g.piecesOf('enemy')) g.removePiece(e);
    g.tiles.clear();
    g.spawnGenerator.spawnWave = () => {};
});

/*  Gives the map being played these attrs for its components ({tile, spawn, ai}: its tile
    and spawn generators and its enemy AI), on top of its own, so a new game in it (or a
    reset) has them, and gives the game's components them now. */
export const setComponentAttrs = (page, {tile = {}, spawn = {}, ai = {}}) => page.evaluate(([tile, spawn, ai]) => {
    const g = hc.app.game,
        m = g.gameMap ?? hc.Game.NO_MAP,
        add = (config, attrs) => ({type:config.type, attrs:{...config.attrs, ...attrs}});
    g.gameMap = {...m, tileGenerator:add(m.tileGenerator, tile), spawnGenerator:add(m.spawnGenerator, spawn), enemyAI:add(m.enemyAI, ai)};
    Object.assign(g.tileGenerator.attrs, tile);
    Object.assign(g.spawnGenerator.attrs, spawn);
    Object.assign(g.enemyAI.attrs, ai);
}, [tile, spawn, ai]);

/*  Puts a tile at (x, y), made as the game makes them (Game.makeTile), with props on top.
    A heal, harm or loot tile is already revealed, with its magnitude shown. Returns it. */
export const putTile = (page, x, y, kind, subtype, props = {}) => page.evaluate(([x, y, kind, subtype, props]) => {
    const g = hc.app.game,
        t = g.makeTile(x, y, kind, subtype);
    if (g.isEffectTile(t)) Object.assign(t, {revealedAt:g.turn, shown:true});
    Object.assign(t, props);
    g.tiles.set(g.key(x, y), t);
    return t;
}, [x, y, kind, subtype, props]);

/*  Where a cell's centre is on the page, for clicking it. */
export const cellOnPage = (page, x, y) => page.evaluate(([x, y]) => {
    const r = hc.view.canvas.getBoundingClientRect(),
        [sx, sy] = hc.view.cellCenter(x, y);
    return [r.left + sx, r.top + sy];
}, [x, y]);

/*  A visible button by its exact text. */
export const button = (page, text) => page.getByRole('button', {name:text, exact:true}).filter({visible:true});

// An item of the selected piece's menu, while it's open.
export const menuItem = (page, text) => page.getByRole('menuitem', {name:text, exact:true}).filter({visible:true});

// Opens the selected piece's menu, by clicking the piece again.
export const openMenu = async page => {
    const [x, y] = await page.evaluate(() => {
        const s = hc.app.game.getSelected();
        return [s.x, s.y];
    });
    await page.mouse.click(...await cellOnPage(page, x, y));
};
