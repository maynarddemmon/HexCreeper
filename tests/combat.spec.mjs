import {test, expect} from '@playwright/test';
import {startGame, clearBoard} from './helpers.mjs';

/*  Builds a row of three player pieces (left child, core, right child) and moves to the next
    turn so they can all act. Returns the direction perpendicular to the row as [dx, dy]. */
const setupRow = page => page.evaluate(() => {
    const g = hc.app.game, c = g.getPlayerCore(), D = hc.hex.dirs;
    // Pick a direction pair (d, -d) for the row and a "forward" direction not along it.
    const row = D.find(([dx, dy]) => dx === 1 && dy === 0);
    const fwd = D.find(([dx, dy]) => dy === -1 && dx === 1);
    g.setGold(100);
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
        const s0 = g.goldHeld(), m = g.findMove(c, c.x + fwd[0], c.y + fwd[1]);
        g.playerAct(c, m.x, m.y);
        return {hits:m.hits.length, gained:g.goldHeld() - s0, left:g.piecesOf('enemy').length, at:[c.x, c.y]};
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
        g.setGold(100); g.playerPlace(d[0], d[1], c);
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
        const afterLoot = [g.goldHeld(), g.lootTaken];
        g.playerWait();
        g.playerPlace(c.x + b[0], c.y + b[1], c); // costs 5
        return {afterLoot, afterPlace:[g.goldHeld(), g.lootTaken]};
    });
    expect(r).toEqual({afterLoot:[11, 11], afterPlace:[6, 11]});
});


// ---- Stats and the dice (see Combat.js) ----

// Combat as the game has it (clearBoard makes it sure): the rules' and profiles' own.
const realCombat = page => page.evaluate(() => new Promise(done => hc.maps.loadIndex(data => {
    const g = hc.app.game;
    delete g.giveProfile;    // (clearBoard's, which makes yours sure)
    hc.defineEnemies(data.enemies, data.enemyGroups);
    for (const id of ['hitMin', 'hitMax', 'damageBonus', 'penetrationBonus']) g.rules[id] = hc.settings.resolveRules({})[id];
    for (const p of g.piecesOf('player')) g.giveProfile(p);
    done();
})));

test('pieces get their profiles: you a human\'s, an enemy its own, or a creeper\'s', async ({page}) => {
    await realCombat(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore(),
            gob = g.addPiece('core', 'enemy', 3, 0, null, 'goblin'),
            plain = g.addPiece('core', 'enemy', 5, 0);
        return [[c.level, c.hp, c.maxHp, c.stats.con, c.damage], [gob.hp, gob.stats.agl, gob.xpValue], [plain.hp, plain.xpValue]];
    });
    // xp in hundredths
    expect(r).toEqual([[1, 15, 15, 10, [1, 2]], [5, 12, 500], [4, 400]]);
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
        // Unarmed (a human's own damage: no weapon equipped); a goblin's dagger, or its own, 1 to 4
        for (const it of [...g.equipment(c), ...g.equipment(gob)]) delete it.equipped;
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
    expect(r).toEqual([[1, 2], [0, 3], [5, 6], 3, 0, 5]);
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
        return [run(), run(), g.hitChance(c, g.addPiece('core', 'enemy', 9, 0, null, 'goblin')), g.damageRange(c)];
    });
    const [[hits, total], again, chance, [min, max]] = r;
    expect(again).toEqual([hits, total]);           // the same rolls again
    expect(Math.abs(hits / 10 - chance)).toBeLessThan(5); // within 5% of 44%
    expect(Math.abs(total / hits - (min + max) / 2)).toBeLessThan(0.3); // its damage's average (a goblin has no armor)
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
    // 20 xp for level 2: max HP 10 + 5 + 1 x (2 + 2) = 19, and HP up by the 4 more. (xp in
    // hundredths)
    expect(r).toEqual([[[500, 1], [1000, 1], [1500, 1], [0, 2]], 14, 19]);
});

// A chain of your pieces: the core, a below it, b below a, each with the given rank; an
// enemy next to b worth 20 xp (2000 hundredths), killed by b (on a cleared board). Their
// xp, with no levelling up.
const chainKill = (page, ranks, rules = {}) => page.evaluate(([ranks, rules]) => {
    const g = hc.app.game, c = g.getPlayerCore();
    Object.assign(g.rules, {xpToLevel:'1000'}, rules);
    for (const p of g.piecesOf('player')) if (p !== c) g.removePiece(p);
    const a = g.addPiece('core', 'player', 1, 0, c.id),
        b = g.addPiece('core', 'player', 2, 0, a.id),
        e = g.addPiece('core', 'enemy', 3, 0);
    g.recomputeRanks = () => {};
    [c.rank, a.rank, b.rank] = ranks;
    e.xpValue = 2000;
    b.ap = 100;
    g.playerAttack(b, 3, 0);
    return [c.xp, a.xp, b.xp, g.pieces.has(e.id)];
}, [ranks, rules]);

test('xp is shared up the links: a bonus for the parent\'s rank first, then a share of all that, of the passer\'s rank', async ({page}) => {
    await clearBoard(page);
    // b: 20 + 20 x 2/20 (a's rank 2) = 22. Passes 22 x 1/20 (its rank 1) = 1.1 to a, which
    // gets 1.1 x 3/20 (the core's rank 3) = 0.165 more: 1.265 (rounded to 1.27), and
    // passes 1.27 x 2/20 = 0.127 (0.13) to the core, which has no parent.
    expect(await chainKill(page, [3, 2, 1])).toEqual([13, 127, 2200, false]);
});

test('xp sharing is two rules', async ({page}) => {
    await clearBoard(page);
    expect(await chainKill(page, [1, 1, 1], {childXPBonus:'0', parentXPShare:'xp / 2'})).toEqual([500, 1000, 2000, false]);
});

test('a kill is the last of your pieces to hurt the enemy\'s, however it dies', async ({page}) => {
    await clearBoard(page);
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        for (const p of g.piecesOf('player')) if (p !== c) g.removePiece(p);
        const e = g.addPiece('core', 'enemy', 1, 0);
        e.hp = e.maxHp = 3;
        c.ap = 100;
        g.playerAttack(c, 1, 0);           // 1 damage: c's now
        const hurt = [e.hp, e.lastHitBy === c.id];
        g.damage(e, 5, null);              // dies of something else
        const gone = g.pieces.has(e.id);
        g.playerWait();                    // (its xp comes at the end of the action, or turn)
        return [hurt, gone, c.xp];
    });
    expect(r).toEqual([[2, true], false, 400]);
});

test('a multi-kill: the kills of one action give each killer the multiKillBonusXP rule\'s of its xp, the count being all of them', async ({page}) => {
    const fwd = await setupRow(page);
    const r = await page.evaluate(fwd => {
        const g = hc.app.game, c = g.getPlayerCore(), mine = g.piecesOf('player');
        Object.assign(g.rules, {xpToLevel:'1000', childXPBonus:'0', parentXPShare:'0'}); // (no sharing)
        // Your three pieces in a row, each with an enemy in front, worth 5 xp; the middle
        // one's has two more linked below it, out of the way.
        for (const p of mine) g.addPiece('core', 'enemy', p.x + fwd[0], p.y + fwd[1]).xpValue = 500;
        const lead = g.pieceAt(c.x + fwd[0], c.y + fwd[1]);
        for (const [x, y] of [[c.x + 2 * fwd[0], c.y + 2 * fwd[1]], [c.x + 3 * fwd[0], c.y + 3 * fwd[1]]]) g.addPiece('core', 'enemy', x, y, lead.id).xpValue = 500;
        g.recomputeRanks();
        for (const p of mine) p.xp = 0;
        c.ap = 100;
        g.playerAct(c, c.x + fwd[0], c.y + fwd[1]);
        return {left:g.piecesOf('enemy').length, xp:mine.map(p => [p === c, p.xp]), log:g.combatLog.filter(e => e.kind === 'multikill').map(e => e.count)};
    }, fwd);
    // 5 kills: 5% more for each after the first, 20%. The core killed three (15 xp, 18
    // with it), the others one each (5, and 6).
    expect(r.left).toBe(0);
    expect(r.xp.sort((a, b) => b[0] - a[0])).toEqual([[true, 1800], [false, 600], [false, 600]]);
    expect(r.log).toEqual([5]);
});

test('a single kill gets its xp as it is, and the multi-kill bonus is a rule', async ({page}) => {
    const r = await page.evaluate(() => {
        const g = hc.app.game, c = g.getPlayerCore();
        g.rules.xpToLevel = '1000';
        const kill = () => {
            const e = g.addPiece('core', 'enemy', 1, 0);
            e.xpValue = 500;
            c.ap = 100;
            g.playerAttack(c, 1, 0);
            return c.xp;
        };
        const one = kill();
        g.rules.multiKillBonusXP = 'xp * killCount * 2';
        return [one, kill() - one];
    });
    expect(r).toEqual([500, 1000]);
});
