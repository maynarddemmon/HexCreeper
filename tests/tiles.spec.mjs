import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

for (const grid of ['hex', 'square']) {
    test.describe(grid, () => {
        test('the start quadrant and its neighbours get 1 heal and 1 harm tile each', async ({page}) => {
            await startGame(page, {grid});
            const r = await page.evaluate(() => {
                const g = hc.app.game, n = hc.GRID.chunkNeighbourCount + 1, tiles = [...g.tiles.values()];
                return {quads:g.generatedQuads.size === n, heal:tiles.filter(t => t.kind === 'heal').length === n,
                    harm:tiles.filter(t => t.kind === 'harm').length === n, timers:tiles.every(t => t.timer >= 2 && t.timer <= 8)};
            });
            expect(r).toEqual({quads:true, heal:true, harm:true, timers:true});
        });
        
        test.describe('rules', () => {
            test.beforeEach(async ({page}) => {
                await startGame(page, {grid});
                await clearBoard(page);
            });
            
            test('a harm tile hurts whoever moves onto it, and stays', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, c = g.playerCore, d = hc.GRID.dirs[0];
                    g.tiles.set(g.key(d[0], d[1]), {x:d[0], y:d[1], kind:'harm', timer:0});
                    const hp = c.hp;
                    g.playerAct(c, d[0], d[1]);
                    return {lost:hp - c.hp, stays:g.isHarm(d[0], d[1])};
                });
                expect(r).toEqual({lost:1, stays:true});
            });
            
            test('countdown tiles are inert until they arm, then act on a piece standing there', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, c = g.playerCore;
                    g.tiles.set(g.key(0, 0), {x:0, y:0, kind:'harm', timer:2});
                    const inert = !g.isHarm(0, 0);
                    g.playerWait(); const after1 = c.hp;
                    g.playerWait(); const after2 = c.hp;
                    return {inert, after1, after2};
                });
                expect(r).toEqual({inert:true, after1:2, after2:1});
            });
            
            test('heal value drops as nearby quadrants are visited', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, n = hc.GRID.chunkNeighbourCount;
                    const v0 = g.healValue(0, 0);
                    for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);
                    return {v0, max:Math.floor(n / 2) + 1, v1:g.healValue(0, 0)};
                });
                expect(r.v0).toBe(r.max);
                expect(r.v1).toBe(1);
            });
            
            test('harm tiles vanish once every neighbouring quadrant is visited', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, d = hc.GRID.dirs[0];
                    g.tiles.set(g.key(d[0], d[1]), {x:d[0], y:d[1], kind:'harm', timer:0});
                    g.tiles.set(g.key(-d[0], -d[1]), {x:-d[0], y:-d[1], kind:'harm', timer:5});
                    for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);
                    g.visitedQuads.delete('0,0');
                    g.updateQuadrants();
                    return g.tiles.size;
                });
                expect(r).toBe(0);
            });
            
            test('healing flows up to a damaged ancestor first, then down; leftovers become score', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                    g.score = 1000;
                    g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
                    const a = g.pieceAt(D[0][0], D[0][1]);
                    const kids = g.placeSquares().filter(q => hc.cheb(q, a) === 1 && hc.cheb(q, c) > 1).slice(0, 2);
                    for (const q of kids) g.playerPlace(q.x, q.y, a);
                    const leaf = g.pieceAt(kids[0].x, kids[0].y);
                    for (const p of g.piecesOf('player')) p.hp = p.maxHp;
                    c.hp = c.maxHp - 1; leaf.hp = leaf.maxHp - 1;
                    g.applyHeal(a, 1, true);
                    const oneUp = c.hp === c.maxHp && leaf.hp === leaf.maxHp - 1;
                    c.hp -= 1;
                    g.applyHeal(a, 2, true);
                    const upAndDown = c.hp === c.maxHp && leaf.hp === leaf.maxHp;
                    const s0 = g.score;
                    g.applyHeal(a, 3, true);
                    return {oneUp, upAndDown, leftover:g.score - s0};
                });
                expect(r).toEqual({oneUp:true, upAndDown:true, leftover:3});
            });
            
            test('eating n heal tiles in one move makes each worth n times', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                    g.score = 100;
                    g.playerPlace(D[0][0], D[0][1], c);
                    g.playerWait();
                    const a = g.pieceAt(D[0][0], D[0][1]), m = D[2];
                    for (const p of [c, a]) g.tiles.set(g.key(p.x + m[0], p.y + m[1]), {x:p.x + m[0], y:p.y + m[1], kind:'heal', timer:0});
                    for (const [i, j] of hc.GRID.chunkNeighbours(0, 0)) g.visitedQuads.add(i + ',' + j);   // value 1 each
                    const s0 = g.score;
                    g.playerAct(c, c.x + m[0], c.y + m[1]);
                    return g.score - s0;   // both at full HP: 2 tiles x 2 = 4 score
                });
                expect(r).toBe(4);
            });
            
            test('the paid heal costs 5 x core rank, heals core rank, and wastes leftovers', async ({page}) => {
                const r = await page.evaluate(() => {
                    const g = hc.app.game, c = g.playerCore, D = hc.GRID.dirs;
                    g.score = 100;
                    g.playerPlace(D[0][0], D[0][1], c); g.playerPlace(D[3][0], D[3][1], c);
                    const cost = g.healCost(), amount = g.healAmount();
                    c.hp = c.maxHp - 1;
                    const s0 = g.score, t0 = g.turn;
                    g.playerHeal(c);
                    return {cost, amount, paid:s0 - g.score, full:c.hp === c.maxHp, sameTurn:g.turn === t0, again:g.playerHeal(c)};
                });
                expect(r).toEqual({cost:10, amount:2, paid:10, full:true, sameTurn:true, again:false});
            });
        });
    });
}
