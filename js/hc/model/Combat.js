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
        xp           (enemies) what killing it is worth (the xpValue rule's if not given)
    and a piece gets a copy (so it can change: a level, and later more), with its xp.
    
    The rules this uses are formulas (expr attrs: see Settings.js), their defaults in
    init.json5's "rules", to tune them there (or a map, for itself).
    
    An attack: a d100 roll; it hits if that's no more than the hit chance (the hitChance
    rule, of the attacker's accuracy and the target's defence, kept from hitMin to hitMax).
    Then its damage, rolled (the damageRoll rule, of the range and two rolls from 0 up to
    1) from its range plus the damageBonus rule, less the target's
    armor after the attacker's penetration (its weapon's plus the penetrationBonus rule),
    which can't go below 0: armor can soak a hit completely. No criticals or fumbles yet.
    Rolls come from the game's seed, in turn, so a game plays the same again.
    
    Killing enemies gives the piece that did it their xp; at the xpToLevel rule's xp it
    goes up a level, and its max HP with it (and its HP by as much).
    
    What happens is kept in the combat log (Game.combatLog, the last LOG_MAX entries, not
    saved), as plain data for the view to put into words: {turn, kind, ...}, kind one of
    'hit' (a, d, roll, chance, dmg), 'soak' and 'miss' (a, d, roll, chance), 'harm' (d,
    dmg: from a harm tile), 'destroyed' (d, linked: how many linked below it went too),
    'xp' (a, xp) and 'level' (a, level).
    a and d (attacker, defender) are who they were (see whoOf), so an entry still reads
    the same once the piece is gone.
    
    Action points: a piece acts (moves, attacks, swaps, detaches, attaches...) by spending
    them, the actionCost rule's an action (a jump the jumpCost rule's, each at least
    MIN_COST), so only with that many. They're kept in hundredths (AP_UNIT a point), as
    whole numbers, so they add up exactly. At the end of each turn, after the enemies',
    every piece gets back the apRecovery rule's points, up to its pool, the apPool rule's
    (but at least a point, and an action, so everything can act). A new piece starts with
    none (but your core starts a game with an action's). When an enemy first comes into your sight it gets the apInitiative
    rule's points, how quick it is to notice you and act, and your pieces theirs too (once a
    turn), up to their pools. The rules are of a piece's level and stats, not rounded. */
(pkg => {
    'use strict';
    
    const {Subtypes, attrs:{evaluate}} = pkg,
        STATS = pkg.STATS = ['str', 'agl', 'con', 'dex', 'int', 'wis', 'wil', 'cha'],
        STAT_VARS = pkg.STAT_VARS = ['level', ...STATS],
        DAMAGE_VARS = pkg.DAMAGE_VARS = ['min', 'max', 'roll', 'roll2'], // the damageRoll rule's
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
                hp:entry.hp, xp:entry.xp};
        },
        
        // What a profile is if init.json5 doesn't say (or has no such one)
        DEFAULT_ENEMTY = 'creeper',
        DEFAULT_CHARACTER_CLASS = 'adventurer',
        FALLBACK = parseProfile({}),
        
        LOG_MAX = 200,                       // combat log entries kept
        
        AP_UNIT = pkg.AP_UNIT = 100,         // a point, in the hundredths action points are kept in
        MIN_COST = 10;                       // the least an action can cost (so there's an end to them)
    
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
            p.xpValue = profile.xp ?? Math.max(0, this.statRule('xpValue', p));
            p.maxHp = this.maxHpOf(p);
            p.hp = p.maxHp;
            p.ap = 0;
        },
        
        // ---- Action points ----
        // A rule's formula (of a piece's level and stats) for piece p, in hundredths of a
        // point, rounded, and not below 0.
        apRule: function(rule, p) {
            return Math.max(0, Math.round(AP_UNIT * evaluate(this.rules[rule], STAT_VARS, {level:p.level, ...p.stats}))) || 0;
        },
        
        /*  The most action points piece p can have (its pool: at least a point, so it can
            act), and what it gets back a turn. */
        apMax: function(p) {return Math.max(AP_UNIT, this.actionCost(p), this.apRule('apPool', p));},
        apRecovery: function(p) {return this.apRule('apRecovery', p);},
        
        /*  What an action costs piece p, and a jump: at least MIN_COST. */
        actionCost: function(p) {return Math.max(MIN_COST, this.apRule('actionCost', p));},
        jumpCost: function(p) {return Math.max(MIN_COST, this.apRule('jumpCost', p));},
        
        /*  Whether piece p has the points for an action costing cost (an action's if not
            given), and the game's on. */
        canAfford: function(p, cost) {return !this.over && !!p && p.ap >= (cost ?? this.actionCost(p));},
        
        /*  Piece p spends cost action points (an action's if not given). */
        spend: function(p, cost) {p.ap = Math.max(0, p.ap - (cost ?? this.actionCost(p)));},
        
        /*  Piece p gets ap more action points, up to its pool (but never loses any). */
        giveAp: function(p, ap) {p.ap = Math.max(p.ap, Math.min(this.apMax(p), p.ap + ap));},
        
        /*  The end of a turn: every piece gets back its recovery, up to its pool. */
        recoverAp: function() {
            for (const p of this.pieces.values()) this.giveAp(p, this.apRecovery(p));
        },
        
        /*  Enemies coming into your sight for the first time (piece.noticed): each gets its
            initiative's points, and if any did, your pieces get theirs, once a turn
            (Game.initiativeTurn). */
        noticeEnemies: function() {
            const sight = this.cellsInSight(),
                seen = this.piecesOf('enemy').filter(e => !e.noticed && (!sight || sight.has(this.key(e.x, e.y))));
            for (const e of seen) {
                e.noticed = true;
                this.giveAp(e, this.apRule('apInitiative', e));
            }
            if (seen.length && this.initiativeTurn !== this.turn) {
                this.initiativeTurn = this.turn;
                for (const p of this.piecesOf('player')) this.giveAp(p, this.apRule('apInitiative', p));
            }
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
        
        /*  A roll of attacker a's damage, before armor (the damageRoll rule, of its range
            and two rolls), a whole number, not below 0. */
        rollDamage: function(a) {
            const [min, max] = this.damageRange(a);
            return Math.max(0, Math.floor(evaluate(this.rules.damageRoll, DAMAGE_VARS,
                {min, max, roll:this.combatRoll(), roll2:this.combatRoll()})) || 0);
        },
        
        /*  Attacker a's penetration: its weapon's, and its penetrationBonus if more than 0. */
        penetrationOf: function(a) {return a.penetration + Math.max(0, this.statRule('penetrationBonus', a));},
        
        /*  How much of armor (damage reduction) gets through attacker a's penetration. */
        armorAgainst: function(a, armor) {return Math.max(0, armor - this.penetrationOf(a));},
        
        /*  The damage attacker a's hit does to piece d, after its armor: [min, max]. */
        damageAgainst: function(a, d) {
            const armor = this.armorAgainst(a, d.armor);
            return this.damageRange(a).map(n => Math.max(0, n - armor));
        },
        
        // ---- The combat log ----
        /*  Who piece p is, for the log: {owner, core (whether it's your core), enemyId}. */
        whoOf: function(p) {
            const who = {owner:p.owner, core:p.id === this.playerCoreId};
            if (p.enemyId) who.enemyId = p.enemyId;
            return who;
        },
        
        /*  Adds entry ({kind, ...}) to the combat log, for this turn. */
        logCombat: function(entry) {
            const log = this.combatLog;
            log.push({turn:this.turn, ...entry});
            if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
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
            const roll = 1 + Math.floor(this.combatRoll() * 100),
                chance = this.hitChance(a, d),
                entry = {a:this.whoOf(a), d:this.whoOf(d), roll, chance};
            if (roll > chance) {
                this.logCombat({kind:'miss', ...entry});
                this.fx(d.x, d.y, 'miss', '--miss', {bump:{from:a}});
            } else {
                const dmg = Math.max(0, this.rollDamage(a) - this.armorAgainst(a, d.armor));
                if (dmg > 0) {
                    this.logCombat({kind:'hit', ...entry, dmg});
                    lost = this.damage(d, dmg, a);
                } else {
                    this.logCombat({kind:'soak', ...entry});
                    this.fx(d.x, d.y, '0', '--miss', {bump:{from:a}});
                }
            }
            return lost;
        },
        
        /*  Piece p gains xp, going up a level (or more) at the xpToLevel rule's xp. */
        gainXp: function(p, xp) {
            this.logCombat({kind:'xp', a:this.whoOf(p), xp});
            p.xp += xp;
            for (let need = this.statRule('xpToLevel', p); need > 0 && p.xp >= need; need = this.statRule('xpToLevel', p)) {
                p.xp -= need;
                p.level++;
                const max = this.maxHpOf(p);
                p.hp += Math.max(0, max - p.maxHp);
                p.maxHp = max;
                this.logCombat({kind:'level', a:this.whoOf(p), level:p.level});
                this.fx(p.x, p.y, 'Level ' + p.level + '!', '--gain', {delay:200});
            }
        },
        
        // Your highest level, and the total of your pieces' levels
        maxLevel: function() {return Math.max(0, ...this.piecesOf('player').map(p => p.level));},
        totalLevels: function() {return this.piecesOf('player').reduce((n, p) => n + p.level, 0);}
    });
})(hc);
