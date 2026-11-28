// Shared helpers for driving the game from tests.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = 8766,
    BASE_URL = 'http://localhost:' + PORT;

/*  Loads the game and waits until it is ready to play. Returns an object that collects page
    errors, console warnings and console errors for the rest of the test.

    The help that opens on a first visit is skipped unless skipHelp is false. Your
    character is TEST_CHARACTER (as if you'd created it last time: see waitForGame).
    Requests to other origins (e.g. the Font Awesome CDN
    used by myt) are answered with an empty response so the tests never depend on the
    network. The game starts on the endless map whatever init.json5's defaultMap is, so
    the tests don't change with it. */
export const startGame = async (page, {skipHelp=true} = {}) => {
    const problems = {pageErrors:[], warnings:[], errors:[]};
    page.on('pageerror', err => problems.pageErrors.push(err.message));
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'warning') problems.warnings.push(msg.text());
        if (type === 'error') problems.errors.push(msg.text());
    });

    await page.route(url => url.origin !== BASE_URL, route => route.fulfill({status:200, body:''}));
    await page.route('**/data/init.json5', async route => {
        const response = await route.fetch();
        route.fulfill({response, body:(await response.text()).replace(/"defaultMap":\s*"[^"]*"/, '"defaultMap":"endless"')});
    });
    if (skipHelp) await page.addInitScript(() => {localStorage.setItem('hc.helpSeen', 'true');});
    await page.addInitScript(ch => {
        if (!localStorage.getItem('hc.character')) localStorage.setItem('hc.character', JSON.stringify(ch));
    }, TEST_CHARACTER);

    await page.goto('/index.html');
    await waitForGame(page);
    return problems;
};

/*  The character tests play: a human urchin, as a plain human would be in what the rules
    use (str, agl, con, wis: 10). The urchin's adjustments (dex and wil up a point, int
    and cha down: see entities.json5) and its creation points (on int and cha) are on
    stats nothing uses yet. If the urchin's adjustments change, so must this. */
export const TEST_CHARACTER = {
    name:'Tess', description:'', species:'human', background:'urchin',
    stats:{str:10, agl:10, con:10, dex:11, int:10, wis:10, wil:11, cha:10}
};

/*  Waits until the App exists and its game has started. Without a save, the game starts
    from the map brief, so its Start button is clicked when it shows, and then your
    character is created: the last you made (TEST_CHARACTER, from startGame), confirmed. */
export const waitForGame = async page => {
    const isReady = () => window.hc?.app?.ready && window.hc.app.game.getPlayerCore() != null,
        start = button(page, '✓ Start'),
        confirm = button(page, '✓ Confirm');
    let stuck = 0;
    while (!await page.evaluate(isReady)) {
        if (await start.count()) await start.click();
        if (await confirm.count()) {
            // (Disabled: the character isn't one creation allows, as the data is now.)
            if (await confirm.evaluate(b => b.classList.contains('disabled'))) {
                if (++stuck > 40) throw new Error('TEST_CHARACTER can\'t be created with the data as it is: see helpers.mjs');
            } else {
                await confirm.click();
            }
        }
        await page.waitForTimeout(50);
    }
};

/*  Clears the board for a rules test: no enemies, no tiles, and no waves, so a test can
    place exactly what it needs. Combat is made sure, so rules tests don't depend on the
    dice (see Combat.js; combat.spec tests the rolls): every attack hits and does 1 damage,
    a piece of yours has 2 HP and a creeper (an enemy without a name) 1. And every
    piece acts once a turn: a pool of 1 action point, all of it back each turn, and no
    initiative. Your pieces start with theirs, and so does every enemy added, so it acts
    in the enemies' next turn; a new piece of yours still starts with none. */
export const clearBoard = page => page.evaluate(() => {
    const g = hc.app.game,
        sure = (table, id, hp) => table.byId.set(id, {...table.get(id), damage:[1, 1], penetration:0, armor:0, hp});
    for (const e of g.piecesOf('enemy')) g.removePiece(e);
    g.tiles.clear();
    g.fixtures.clear();
    g.ground.clear();
    g.spawnGenerator.spawnWave = () => {};
    g.rules.hitMin = g.rules.hitMax = 100;
    g.rules.damageBonus = g.rules.penetrationBonus = '0';
    g.rules.apPool = g.rules.apRecovery = '1';
    g.rules.apInitiative = '0';
    sure(hc.enemies, 'creeper', 1);
    // (Yours have no profile of their own to make sure: see Combat.giveProfile.)
    const giveProfile = g.giveProfile;
    g.giveProfile = function(p, ...args) {
        giveProfile.call(this, p, ...args);
        if (p.owner === 'player') {
            Object.assign(p, {damage:[1, 1], penetration:0, armor:0, fixedHp:2});
            p.maxHp = p.hp = 2;
        }
    };
    for (const p of g.piecesOf('player')) {
        g.giveProfile(p);
        p.ap = g.apMax(p);
    }
    const addPiece = g.addPiece;
    g.addPiece = function(...args) {
        const p = addPiece.apply(this, args);
        if (p.owner === 'enemy') p.ap = this.apMax(p);
        return p;
    };
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

/*  Puts a tile (a solid or hole) at (x, y), made as the game makes them (Game.makeTile),
    with props on top. Returns it. */
export const putTile = (page, x, y, kind, subtype, props = {}) => page.evaluate(([x, y, kind, subtype, props]) => {
    const g = hc.app.game,
        t = {...g.makeTile(x, y, kind, subtype), ...props};
    g.tiles.set(g.key(x, y), t);
    return t;
}, [x, y, kind, subtype, props]);

/*  Puts a fixture (heal, harm or loot) of kind subtype at (x, y), made as the game makes
    them (Game.makeFixture), already revealed, with its magnitude shown, and props on top.
    Returns it. */
export const putFixture = (page, x, y, subtype, props = {}) => page.evaluate(([x, y, subtype, props]) => {
    const g = hc.app.game,
        f = {...g.makeFixture(x, y, subtype), revealedAt:g.turn, shown:true, ...props};
    g.fixtures.set(g.key(x, y), f);
    return f;
}, [x, y, subtype, props]);

/*  Where a cell's centre is on the page, for clicking it. */
export const cellOnPage = (page, x, y) => page.evaluate(([x, y]) => {
    const r = hc.view.canvas.getBoundingClientRect(),
        [sx, sy] = hc.view.cellCenter(x, y);
    return [r.left + sx, r.top + sy];
}, [x, y]);

/*  A visible button by its exact text. */
export const button = (page, text) => page.getByRole('button', {name:text, exact:true}).filter({visible:true});

/*  Starts the game a map's brief is for: Start, then your character confirmed as it
    comes (the last you made: see waitForGame). */
export const pressStart = async page => {
    await button(page, '✓ Start').click();
    await button(page, '✓ Confirm').click();
};

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
