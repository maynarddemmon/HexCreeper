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

/*  Waits until the App exists and its game has started. */
export const waitForGame = page => page.waitForFunction(() => window.hc?.app?.ready && window.hc.app.game.playerCore != null);

/*  Clears the board for a rules test: no enemies, no tiles, and no waves, so a test can
    place exactly what it needs. */
export const clearBoard = page => page.evaluate(() => {
    const g = hc.app.game;
    for (const e of g.piecesOf('enemy')) g.removePiece(e);
    g.tiles.clear();
    g.spawnWave = () => {};
});

/*  Where a cell's centre is on the page, for clicking it. */
export const cellOnPage = (page, x, y) => page.evaluate(([x, y]) => {
    const r = hc.view.canvas.getBoundingClientRect(),
        [sx, sy] = hc.view.cellCenter(x, y);
    return [r.left + sx, r.top + sy];
}, [x, y]);

/*  A visible button by its exact text. */
export const button = (page, text) => page.getByRole('button', {name:text, exact:true}).filter({visible:true});
