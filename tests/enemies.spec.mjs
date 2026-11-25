import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

const adjacentToPlayer = `(g, e) => g.piecesOf('player').some(q => hc.hexDist(q, e) === 1)`;

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test.describe('waves', () => {
    test('wave size and squad size follow the highest player level, not the turn', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, out = [];
            out.push([g.spawnGenerator.waveSize(), g.spawnGenerator.squadCap()]);
            g.turn = 300;
            out.push([g.spawnGenerator.waveSize(), g.spawnGenerator.squadCap()]);
            g.getPlayerCore().level = 2;
            out.push([g.spawnGenerator.waveSize(), g.spawnGenerator.squadCap()]);
            return out;
        });
        expect(r).toEqual([[1, 2], [1, 2], [3, 3]]);
    });
    
    test('squads spawn as binary link trees, of creepers', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            const sizes = [3, 7].map(n => { const root = g.spawnGenerator.spawnSquad(n); return [g.group(root).length, root.rank, root.hp]; });
            return sizes;
        });
        expect(r).toEqual([[3, 2, 1], [7, 3, 1]]); // (a creeper has 1 HP, with clearBoard)
    });
});

for (const kind of ['harm', 'solid', 'hole']) {
    test(`enemies path around a wall of ${kind} tiles`, async ({page}) => {
        const r = await page.evaluate(kind => {
            const g = hc.app.game;
            // (A harm is a fixture; solids and holes are tiles.)
            const layer = kind === 'harm' ? g.fixtures : g.tiles,
                make = x => kind === 'harm' ? g.makeFixture(x, -2, 'harm') : g.makeTile(x, -2, kind);
            for (let x = -4; x <= 4; x++) layer.set(g.key(x, -2), {...make(x), revealedAt:g.turn});
            const e = g.addPiece('core', 'enemy', 1, -6);
            let stepped = false, hit = false;
            for (let i = 0; i < 20 && !hit; i++) {
                g.playerWait();
                if (g.pieces.has(e.id) && (layer.get(g.key(e.x, e.y))?.type ?? layer.get(g.key(e.x, e.y))?.kind) === kind) stepped = true;
                hit = g.over || g.getPlayerCore().hp < g.getPlayerCore().maxHp;
            }
            return {stepped, hit};
        }, kind);
        expect(r).toEqual({stepped:false, hit:true});
    });
}

test('a squad facing a wall strikes and pulls back out of reach', async ({page}) => {
    const r = await page.evaluate(adjSrc => {
        const adj = eval(adjSrc), g = hc.app.game, c = g.getPlayerCore();
        hc.app.game.rules.hpPer = 25;   // a sturdy wall, so the test is about the AI, not survival
        g.score = 1000;
        let L = c, R = c;
        for (let k = 1; k <= 3; k++) { g.playerPlace(-k, 0, L); L = g.pieceAt(-k, 0); g.playerPlace(k, 0, R); R = g.pieceAt(k, 0); }
        g.score = 0;
        for (const p of g.piecesOf('player')) p.hp = p.maxHp;
        const lead = g.addPiece('core', 'enemy', 0, -4), A = g.addPiece('core', 'enemy', -1, -4, lead.id), B = g.addPiece('core', 'enemy', 1, -4, lead.id);
        g.addPiece('core', 'enemy', -2, -4, A.id); g.addPiece('core', 'enemy', -1, -5, A.id);
        g.addPiece('core', 'enemy', 2, -4, B.id); g.addPiece('core', 'enemy', 1, -5, B.id);
        g.recomputeRanks();
        const total = () => g.piecesOf('player').reduce((a, p) => a + p.hp, 0);
        let hp = total(), dealt = 0, safeStrikes = 0;
        for (let t = 0; t < 12; t++) {
            g.playerWait();
            const d = hp - total(); hp = total(); dealt += d;
            if (d > 0 && !g.piecesOf('enemy').some(e => adj(g, e))) safeStrikes++;
        }
        return {rank:lead.rank, dealt, safeStrikes};
    }, adjacentToPlayer);
    expect(r.rank).toBe(3);
    expect(r.dealt).toBeGreaterThan(0);
    expect(r.safeStrikes).toBeGreaterThan(0);
});

// A creeper two steps from your core, with the points to step in and strike (but not to
// pull back), and 3 HP, so standing next to you costs it 0.6 of expose (12): it steps in
// only if the strike is worth more, at its hit chance (hit 10 per HP it can expect to do).
for (const [chance, strikes] of [[100, true], [5, false]]) {
    test(`a squad strikes by its odds: at ${chance}% a creeper ${strikes ? 'steps in to strike' : 'keeps its distance'}`, async ({page}) => {
        const r = await page.evaluate(chance => {
            const g = hc.app.game, c = g.getPlayerCore();
            g.rules.apPool = g.rules.apRecovery = '2';
            g.rules.hitMin = g.rules.hitMax = chance;
            hc.enemies.byId.set('creeper', {...hc.enemies.get('creeper'), hp:3});
            g.addPiece('core', 'enemy', c.x, c.y - 2);
            g.playerWait();
            return g.combatLog.filter(e => e.a?.owner === 'enemy').length;
        }, chance);
        expect(r > 0).toBe(strikes);
    });
}

test('a plan gone stale is made again: once a strike kills a piece, the next one planned on it isn\'t a step into its cell', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.score = 100;
        g.playerPlace(c.x, c.y - 1, c);
        const p = g.pieceAt(c.x, c.y - 1);
        // Two creepers next to that piece (2 HP), but not the core: each hit does 1 or 2
        // as they plan it (so the second strike is worth making), but does 2.
        hc.enemies.byId.set('creeper', {...hc.enemies.get('creeper'), damage:[1, 2], hp:3});
        const a = g.addPiece('core', 'enemy', c.x, c.y - 2);
        g.addPiece('core', 'enemy', c.x + 1, c.y - 2, a.id);
        g.recomputeRanks();
        g.rollDamage = () => 2;
        g.playerWait();
        return {
            gone:!g.pieces.has(p.id),
            strikes:g.combatLog.filter(e => e.a?.owner === 'enemy').length,
            inItsCell:!!g.pieceAt(c.x, c.y - 1)
        };
    });
    expect(r).toEqual({gone:true, strikes:1, inItsCell:false});
});

test('patience: a squad that can only wait commits within a few turns', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        hc.app.game.rules.hpPer = 25; g.recomputeRanks(); c.hp = c.maxHp;
        const lead = g.addPiece('core', 'enemy', 0, -4);
        g.addPiece('core', 'enemy', -1, -4, lead.id); g.addPiece('core', 'enemy', 1, -4, lead.id);
        g.recomputeRanks();
        for (let t = 1; t <= 8; t++) { g.playerWait(); if (c.hp < c.maxHp) return t; }
        return null;
    });
    expect(r).not.toBeNull();
    expect(r).toBeLessThanOrEqual(6);
});
