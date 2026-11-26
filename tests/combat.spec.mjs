import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  Builds a row of three player pieces (left child, core, right child) and moves to the next
    turn so they can all act. Returns the direction perpendicular to the row as [dx, dy]. */
const setupRow = page => page.evaluate(() => {
    const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
    // Pick a direction pair (d, -d) for the row and a "forward" direction not along it.
    const row = D.find(([dx, dy]) => dx === 1 && dy === 0);
    const fwd = D.find(([dx, dy]) => dy === -1 && dx === 1);
    g.gold = 100;
    g.playerPlace(row[0], row[1], c); g.playerPlace(-row[0], -row[1], c);
    g.playerWait();
    return fwd;
});

test.beforeEach(async ({page}) => {
    await startGame(page);
    await clearBoard(page);
});

test('a group attack hits with every member in line, for no gold; then the group advances', async ({page}) => {
    const fwd = await setupRow(page);
    const r = await page.evaluate(fwd => {
        const g = hc.app.game, c = g.getPlayerCore();
        for (const p of g.piecesOf('player')) g.addPiece('core', 'enemy', p.x + fwd[0], p.y + fwd[1]);
        const s0 = g.gold, m = g.findMove(c, c.x + fwd[0], c.y + fwd[1]);
        g.playerAct(c, m.x, m.y);
        return {hits:m.hits.length, gained:g.gold - s0, left:g.piecesOf('enemy').length, at:[c.x, c.y]};
    }, fwd);
    expect(r).toEqual({hits:3, gained:0, left:0, at:fwd});
});

test('killing a squad leader destroys the squad and every piece counts as a kill', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs, d = D[0];
        const lead = g.addPiece('core', 'enemy', d[0], d[1]);
        const far = D.map(([dx, dy]) => ({x:lead.x + dx, y:lead.y + dy})).filter(q => hc.hexDist(q, c) > 1 && !g.pieceAt(q.x, q.y));
        g.addPiece('core', 'enemy', far[0].x, far[0].y, lead.id);
        g.addPiece('core', 'enemy', far[1].x, far[1].y, lead.id);
        g.recomputeRanks();
        lead.hp = 1;
        const k0 = g.kills;
        g.playerAct(c, lead.x, lead.y);
        return {kills:g.kills - k0, left:g.piecesOf('enemy').length};
    });
    expect(r).toEqual({kills:3, left:0});
});

test('after a kill the attacker advances, unless that would land on harm', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1];
        g.addPiece('core', 'enemy', d[0], d[1]);
        g.playerAct(c, d[0], d[1]);
        const advanced = c.x === d[0] && c.y === d[1];
        g.playerWait();
        const tx = c.x + d[0], ty = c.y + d[1];
        g.addPiece('core', 'enemy', tx, ty);
        g.fixtures.set(g.key(tx, ty), {...g.makeFixture(tx, ty, 'harm'), revealedAt:g.turn});
        const hp = c.hp;
        g.playerAct(c, tx, ty);
        return {advanced, stayed:c.x === d[0] && c.y === d[1], hp:c.hp === hp};
    });
    expect(r).toEqual({advanced:true, stayed:true, hp:true});
});

test('a kill with Attack leaves the attacker where it is', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1],
            e = g.addPiece('core', 'enemy', d[0], d[1]);
        g.playerAttack(c, d[0], d[1]);
        return [g.pieces.has(e.id), c.x, c.y];
    });
    expect(r).toEqual([false, 0, 0]);
});

test('moving a parent carries its subtree, keeping its shape', async ({page}) => {
    const fwd = await setupRow(page);
    const r = await page.evaluate(fwd => {
        const g = hc.app.game, c = g.getPlayerCore();
        const shape = () => g.piecesOf('player').map(p => [p.x - c.x, p.y - c.y].join()).sort().join('|');
        const before = shape();
        g.playerAct(c, c.x + fwd[0], c.y + fwd[1]);
        return {same:shape() === before, moved:c.x === fwd[0] && c.y === fwd[1]};
    }, fwd);
    expect(r).toEqual({same:true, moved:true});
});

test('a linked piece must stay within link range of its parent', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), d = hc.hex.dirs[1];
        g.gold = 100; g.playerPlace(d[0], d[1], c);
        const a = g.pieceAt(d[0], d[1]);
        let steps = 0;
        for (let t = 0; t < 6; t++) {
            g.playerWait();
            if (!g.playerAct(a, a.x + d[0], a.y + d[1])) break;
            steps++;
        }
        return {dist:hc.hexDist(a, c), steps, range:hc.app.game.rules.linkRange};
    });
    // It starts 1 step away, so it can take (range - 1) steps outward and no more.
    expect(r).toEqual({dist:r.range, steps:r.range - 1, range:3});
});

test('gold looted is kept as a total; spending only lowers what you have', async ({page}) => {
    await startGame(page);
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), [a, b] = hc.hex.dirs;
        g.fixtures.set(g.key(a[0], a[1]), {...g.makeFixture(a[0], a[1], 'loot'), pool:11});
        g.playerAct(c, a[0], a[1]);
        const afterLoot = [g.gold, g.lootTaken];
        g.playerWait();
        g.playerPlace(c.x + b[0], c.y + b[1], c); // costs 5
        return {afterLoot, afterPlace:[g.gold, g.lootTaken]};
    });
    expect(r).toEqual({afterLoot:[11, 11], afterPlace:[6, 11]});
});


// ---- Stats and the dice (see Combat.js) ----

// Combat as the game has it (clearBoard makes it sure): the rules' and profiles' own.
const realCombat = page => page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
    const g = hc.app.game;
    hc.characters.define(data.characters);
    hc.defineEnemies(data.enemies, data.enemyGroups);
    for (const id of ['hitMin', 'hitMax', 'damageBonus', 'penetrationBonus']) g.rules[id] = hc.settings.resolveRules({})[id];
    for (const p of g.piecesOf('player')) g.giveProfile(p);
    done();
})));

test('pieces get their profiles: you an adventurer\'s, an enemy its own, or a creeper\'s', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            gob = g.addPiece('core', 'enemy', 3, 0, null, 'goblin'),
            plain = g.addPiece('core', 'enemy', 5, 0);
        return [[c.level, c.hp, c.maxHp, c.stats.con, c.damage], [gob.hp, gob.stats.agl, gob.xpValue], [plain.hp, plain.xpValue]];
    });
    expect(r).toEqual([[1, 15, 15, 10, [1, 6]], [5, 12, 5], [4, 4]]);
});

test('the hit chance comes from accuracy against defence, kept from hitMin to hitMax', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), gob = g.addPiece('core', 'enemy', 3, 0, null, 'goblin'),
            out = [g.hitChance(c, gob), g.hitChance(gob, c)]; // str 10 + 1 vs agl 12 + 1; str 8 + 1 vs agl 10 + 1
        g.rules.hitChance = '200';
        out.push(g.hitChance(c, gob));
        g.rules.hitChance = '-50';
        out.push(g.hitChance(c, gob));
        return out;
    });
    expect(r).toEqual([44, 44, 95, 5]);
});

test('damage: the weapon\'s plus the str bonus, less armor after penetration; armor can soak a hit', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), gob = g.addPiece('core', 'enemy', 3, 0, null, 'goblin');
        const out = [g.damageRange(c), g.damageRange(gob)]; // str 10: +0; str 8: -1 (not below 0)
        c.stats.str = 18;                                    // +4 damage, +2 penetration
        out.push(g.damageRange(c), g.armorAgainst(c, 5), g.armorAgainst(c, 1));
        // A hit that always lands on armor it can't get through does nothing.
        g.rules.hitMin = g.rules.hitMax = 100;
        gob.armor = 100;
        for (let i = 0; i < 20; i++) g.strike(c, gob);
        out.push(gob.hp);
        return out;
    });
    expect(r).toEqual([[1, 6], [0, 3], [5, 10], 3, 0, 5]);
});

test('damage odds: the chance of each amount a hit does, after armor, from the damageRoll rule', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), e = g.addPiece('core', 'enemy', 3, 0),
            sixths = odds => odds.map(o => Math.round(o * 6 * 1000) / 1000);
        g.rules.damageRoll = 'min + floor(roll * (max - min + 1))';
        c.damage = [1, 6];
        e.armor = 2;
        const one = sixths(g.damageOdds(c, e));
        // Two d6: 2 to 12, 7 (5 after armor) the likeliest.
        g.rules.damageRoll = 'min + floor(roll * 6) + floor(roll2 * 6)';
        c.damage = [2, 12];
        const two = g.damageOdds(c, e);
        return {one, total:two.reduce((a, o) => a + o, 0), likeliest:two.indexOf(Math.max(...two))};
    });
    // 1 and 2 are soaked; 3 to 6 do 1 to 4.
    expect(r.one).toEqual([2, 1, 1, 1, 1]);
    expect(r.total).toBeCloseTo(1, 9);
    expect(r.likeliest).toBe(5);
});

test('attacks roll from the seed, and hit about as often as the chance says', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            // 1000 attacks on a goblin that can't die; how many hit, and their damage
            run = () => {
                g.combatRolls = 0;
                const gob = g.addPiece('core', 'enemy', 3, 0, null, 'goblin');
                gob.fixedHp = gob.hp = gob.maxHp = 1e9;
                let hits = 0, total = 0;
                for (let i = 0; i < 1000; i++) {
                    const before = gob.hp;
                    g.strike(c, gob);
                    if (gob.hp < before) {
                        hits++;
                        total += before - gob.hp;
                    }
                }
                g.removePiece(gob);
                return [hits, total];
            };
        return [run(), run(), g.hitChance(c, g.addPiece('core', 'enemy', 9, 0, null, 'goblin'))];
    });
    const [[hits, total], again, chance] = r;
    expect(again).toEqual([hits, total]);           // the same rolls again
    expect(Math.abs(hits / 10 - chance)).toBeLessThan(5); // within 5% of 44%
    expect(Math.abs(total / hits - 3.5)).toBeLessThan(0.3); // 1 to 6, 3.5 on average
});

test('killing enemies gives xp; enough goes up a level, with its HP', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(), out = [];
        g.rules.hitMin = g.rules.hitMax = 100;
        c.damage = [99, 99];
        c.hp = 10;
        // Goblins (5 xp each) next to the core, killed one at a time (with Attack, so the
        // core stays where it is)
        for (let i = 0; i < 4; i++) {
            g.addPiece('core', 'enemy', 1, 0, null, 'goblin');
            c.ap = 100;
            g.playerAttack(c, 1, 0);
            out.push([c.xp, c.level]);
        }
        return [out, c.hp, c.maxHp];
    });
    // 20 xp for level 2: max HP 10 + 5 + 1 x (2 + 2) = 19, and HP up by the 4 more.
    expect(r).toEqual([[[5, 1], [10, 1], [15, 1], [0, 2]], 14, 19]);
});
