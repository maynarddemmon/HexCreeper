import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

const adjacentToPlayer = `(g, e) => g.piecesOf('player').some(q => hc.hexDist(q, e) === 1)`;

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test.describe('waves', () => {
    test('wave size and squad size follow the highest player rank, not the turn', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs, out = [];
            out.push([g.waveSize(), g.squadCap()]);
            g.turn = 300;
            out.push([g.waveSize(), g.squadCap()]);
            g.score = 1000;
            g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
            out.push([g.waveSize(), g.squadCap()]);
            return out;
        });
        expect(r).toEqual([[1, 2], [1, 2], [3, 3]]);
    });
    
    test('squads spawn as binary link trees with ranks', async ({page}) => {
        const r = await page.evaluate(() => {
            const g = hc.app.game;
            const sizes = [3, 7].map(n => { const root = g.spawnSquad(n); return [g.group(root).length, root.rank, root.hp]; });
            return sizes;
        });
        expect(r).toEqual([[3, 2, 2], [7, 3, 3]]);
    });
});

test('enemies path around a wall of harm tiles', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game;
        for (let x = -4; x <= 4; x++) g.tiles.set(g.key(x, -2), {x, y:-2, kind:'harm', timer:0});
        const e = g.addPiece('core', 'enemy', 1, -6);
        let stepped = false, hit = false;
        for (let i = 0; i < 20 && !hit; i++) {
            g.playerWait();
            if (g.pieces.has(e.id) && g.isHarm(e.x, e.y)) stepped = true;
            hit = g.over || g.playerCore.hp < g.playerCore.maxHp;
        }
        return {stepped, hit};
    });
    expect(r).toEqual({stepped:false, hit:true});
});

test('a squad facing a wall strikes and pulls back out of reach', async ({page}) => {
    const r = await page.evaluate(adjSrc => {
        const adj = eval(adjSrc), g = hc.app.game, c = g.playerCore;
        hc.cfg.RANK.hpPer = 25;   // a sturdy wall, so the test is about the AI, not survival
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

test('patience: a squad that can only wait commits within a few turns', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.playerCore;
        hc.cfg.RANK.hpPer = 25; g.recomputeRanks(); c.hp = c.maxHp;
        const lead = g.addPiece('core', 'enemy', 0, -4);
        g.addPiece('core', 'enemy', -1, -4, lead.id); g.addPiece('core', 'enemy', 1, -4, lead.id);
        g.recomputeRanks();
        for (let t = 1; t <= 8; t++) { g.playerWait(); if (c.hp < c.maxHp) return t; }
        return null;
    });
    expect(r).not.toBeNull();
    expect(r).toBeLessThanOrEqual(6);
});
