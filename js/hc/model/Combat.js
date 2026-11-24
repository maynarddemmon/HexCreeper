/*  Stats, levels and combat (a module included in Game).
    
    Every piece has a profile, from data/init.json5: yours from `characters` (the
    "adventurer" for now), an enemy's from `enemies` (its enemyId, or "creeper" for one
    without). A profile has
        stats        str, agl, con, dex, int, wis, wil, cha (10 if not given)
        level        1 if not given
        damage       [min, max], what its weapon does (before its str bonus)
        penetration  how much of a target's damage reduction its weapon goes through
        armor        its damage reduction: taken off each hit's damage
        hp           its max HP, if fixed (else the maxHp rule works it out)
        xp           (enemies) what killing it is worth (5 x its level if not given)
    and a piece gets a copy (so it can change: a level, and later more), with its xp.
    
    An attack: a d100 roll; it hits if that's no more than the hit chance (the hitChance
    rule, of the attacker's accuracy and the target's defence, kept from hitMin to hitMax).
    Then its damage, rolled from its range plus the damageBonus rule, less the target's
    armor after the attacker's penetration (its weapon's plus the penetrationBonus rule),
    which can't go below 0: armor can soak a hit completely. No criticals or fumbles yet.
    Rolls come from the game's seed, in turn, so a game plays the same again.
    
    Killing enemies gives the piece that did it their xp; at the xpToLevel rule's xp it
    goes up a level, and its max HP with it (and its HP by as much). */
(pkg => {
    'use strict';
    
    const {Subtypes, attrs:{evaluate}} = pkg,
        STATS = pkg.STATS = ['str', 'agl', 'con', 'dex', 'int', 'wis', 'wil', 'cha'],
        STAT_VARS = pkg.STAT_VARS = ['level', ...STATS],
        isInt = v => Number.isInteger(v) && v >= 0,
        
        /*  A profile as init.json5 has it, made usable, or null if it isn't. */
        parseProfile = entry => {
            const stats = {}, level = entry.level ?? 1, damage = entry.damage ?? [1, 4];
            for (const s of STATS) {
                const v = entry.stats?.[s] ?? 10;
                if (!isInt(v)) return null;
                stats[s] = v;
            }
            if (!(Number.isInteger(level) && level >= 1) ||
                !(Array.isArray(damage) && damage.length === 2 && damage.every(isInt) && damage[0] <= damage[1]) ||
                !isInt(entry.penetration ?? 0) || !isInt(entry.armor ?? 0) ||
                !(entry.hp === undefined || (Number.isInteger(entry.hp) && entry.hp >= 1)) ||
                !isInt(entry.xp ?? 0)) return null;
            return {stats, level, damage:[...damage], penetration:entry.penetration ?? 0, armor:entry.armor ?? 0,
                hp:entry.hp, xp:entry.xp ?? 5 * level};
        },
        
        // What a profile is if init.json5 doesn't say (or has no such one)
        DEFAULT_ENEMTY = 'creeper',
        DEFAULT_CHARACTER_CLASS = 'adventurer',
        FALLBACK = parseProfile({});
    
    pkg.characters = new Subtypes('character', parseProfile);
    pkg.enemies = new Subtypes('enemy', parseProfile);
    
    pkg.Combat = new JS.Module('Combat', {
        /*  Gives piece p the profile its owner's table has for id (yours: a character's,
            "adventurer" if none; an enemy's: its enemyId's, "creeper" if none), at full
            HP. */
        giveProfile: function(p, id) {
            const enemy = p.owner === 'enemy',
                profile = (enemy ? pkg.enemies : pkg.characters).get(id ?? (enemy ? DEFAULT_ENEMTY : DEFAULT_CHARACTER_CLASS)) ?? FALLBACK;
            p.stats = {...profile.stats};
            p.level = profile.level;
            p.xp = 0;
            p.damage = [...profile.damage];
            p.penetration = profile.penetration;
            p.armor = profile.armor;
            p.fixedHp = profile.hp;
            p.xpValue = profile.xp;
            p.maxHp = this.maxHpOf(p);
            p.hp = p.maxHp;
        },
        
        // A rule's formula (of a piece's level and stats) for piece p, rounded down.
        statRule: function(rule, p) {
            return Math.floor(evaluate(this.rules[rule], STAT_VARS, {level:p.level, ...p.stats})) || 0;
        },
        
        /*  Piece p's max HP: fixed by its profile, or the maxHp rule's. At least 1. */
        maxHpOf: function(p) {return Math.max(1, p.fixedHp ?? this.statRule('maxHp', p));},
        
        /*  How likely (in %) attacker a's attack on piece d is to hit. */
        hitChance: function(a, d) {
            const chance = Math.floor(evaluate(this.rules.hitChance, ['accuracy', 'defence'], {
                accuracy:this.statRule('meleeAccuracy', a),
                defence:this.statRule('defence', d)
            })) || 0;
            return Math.min(this.rules.hitMax, Math.max(this.rules.hitMin, chance));
        },
        
        /*  The damage attacker a's hit does, before armor: [min, max], neither below 0. */
        damageRange: function(a) {
            const bonus = this.statRule('damageBonus', a);
            return a.damage.map(n => Math.max(0, n + bonus));
        },
        
        /*  How much of armor (damage reduction) gets through attacker a's penetration. */
        armorAgainst: function(a, armor) {
            return Math.max(0, armor - a.penetration - Math.max(0, this.statRule('penetrationBonus', a)));
        },
        
        /*  The next roll for combat, from 0 up to (not including) 1, in turn from the seed
            (combatRolls, saved with the game). */
        combatRoll: function() {
            return this.rngFor('combat', this.combatRolls++)();
        },
        
        /*  Attacker a attacks piece d: a hit roll, then damage, less its armor (see above).
            Returns the pieces destroyed (see damage), or [] if none. */
        strike: function(a, d) {
            let lost = [];
            const roll = 1 + Math.floor(this.combatRoll() * 100);
            if (roll > this.hitChance(a, d)) {
                this.fx(d.x, d.y, 'miss', '--miss', {bump:{from:a}});
            } else {
                const [min, max] = this.damageRange(a),
                    dmg = Math.max(0, min + Math.floor(this.combatRoll() * (max - min + 1)) - this.armorAgainst(a, d.armor));
                if (dmg > 0) {
                    lost = this.damage(d, dmg, a);
                } else {
                    this.fx(d.x, d.y, '0', '--miss', {bump:{from:a}});
                }
            }
            return lost;
        },
        
        /*  Piece p gains xp, going up a level (or more) at the xpToLevel rule's xp. */
        gainXp: function(p, xp) {
            p.xp += xp;
            for (let need = this.statRule('xpToLevel', p); need > 0 && p.xp >= need; need = this.statRule('xpToLevel', p)) {
                p.xp -= need;
                p.level++;
                const max = this.maxHpOf(p);
                p.hp += Math.max(0, max - p.maxHp);
                p.maxHp = max;
                this.fx(p.x, p.y, 'Level ' + p.level + '!', '--gain', {delay:200});
            }
        },
        
        // Your highest level, and the total of your pieces' levels
        maxLevel: function() {return Math.max(0, ...this.piecesOf('player').map(p => p.level));},
        totalLevels: function() {return this.piecesOf('player').reduce((n, p) => n + p.level, 0);}
    });
})(hc);
