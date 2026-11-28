/*  Stats, levels and combat (a module included in Game).
    
    Every piece has a species, a background and, for an enemy, a profile, from
    data/entities.json5.
    
    A species (`species`) is what a creature is, a template for it: in "stats", for each
    stat, the range it can be in and its typical value, [min, typical, max], or [min,
    max] for a typical value half way (rounded); [3, 10, 18] if not given (a species
    that goes down to 0 should say so). It has a base "damage", [min, max] ([1, 4] if
    not given), is "playable" (true or false: false if not given) if you can choose it
    for a character, and may have "backgrounds", the ids of the backgrounds it can go
    with (any, if not given), and "corpse", the item kind it leaves when it dies ("corpse"
    if not given; "none" for nothing: see Items.js). Entries can extend others (a sub-species: see
    Subtypes.js), a stat's whole entry replacing the other's. Stats can't go outside the
    range (spending stat points can't raise one above its max).
    
    A background (`backgrounds`) is where a creature comes from: for now a name and a
    description, "playable" (false if not given) if you can choose it for a character,
    and maybe "species", the ids of the species it can go with (any, if not given). Later
    it will give skills and abilities. A species and a background fit if each allows
    the other (see backgroundFits); data can leave a species with none that fit, which
    is for the designer to fix.
    
    Your pieces are, until character creation, the first playable species (a human)
    with the first playable background that fits it (an urchin). An enemy's profile is
    what it is in a fight, from `enemies` (its enemyId, or "creeper" for one without).
    A profile has
        species      the id of the species it's for, or a list of them (it must have at
                     least one). A piece is the first, unless it's given another of them
                     (see giveProfile)
        backgrounds  the ids of the backgrounds it can have (["denizen"] if not given):
                     each piece gets one of those that fit its species, at random (none,
                     with an error, if none do)
        stats        str, agl, con, dex, int, wis, wil, cha, its own: its species'
                     typical values for any it doesn't give (and it must be within every
                     one of its species' ranges)
        level        1 if not given
        damage       [min, max], what it does unarmed (before its str bonus): its
                     species' base damage if not given; a weapon it has equipped
                     replaces it (see Items.js)
        penetration  how much of a target's damage reduction it goes through, unarmed (a
                     weapon's replaces it)
        armor        its damage reduction: taken off each hit's damage (what it has
                     equipped adds to it)
        hp           its max HP, if fixed (else the maxHp rule works it out)
        xp           (enemies) what killing it is worth (the xpValue rule's if not given)
        items        what it carries, whatever it can (see Items.js): item kind ids, or
                     {"kind":id, "count":n or [min, max]} for more than one (rolled for
                     each piece: it may have none)
    and a piece gets a copy (so it can change: a level, and later more), with its xp.
    
    The rules this uses are formulas (expr attrs: see Settings.js), their defaults in
    rules.json5's "rules", to tune them there (or a map, for itself).
    
    An attack: a d100 roll; it hits if that's no more than the hit chance (the hitChance
    rule, of the attacker's accuracy and the target's defence, kept from hitMin to hitMax).
    Then its damage, rolled (the damageRoll rule, of the range and two rolls from 0 up to
    1) from its range plus the damageBonus rule, less the target's
    armor after the attacker's penetration (its weapon's plus the penetrationBonus rule),
    which can't go below 0: armor can soak a hit completely. No criticals or fumbles yet.
    Rolls come from the game's seed, in turn, so a game plays the same again.
    
    Killing enemies gives the piece that did it their xp, and shares some up its links
    (see awardXp); at the xpToLevel rule's xp a piece goes up a level, and its max HP
    with it (and its HP by as much). XP is kept in hundredths (XP_UNIT a point), as whole
    numbers, so small shares aren't lost.
    
    Stat points: each level up gives a piece the statPointsPerLevel rule's points to
    spend on its stats (piece.statPoints: {available, spent}, spent being all it has
    spent in all). The character sheet spends them (see spendStatPoints); a stat can only
    go up by them, never down.
    
    What happens is kept in the combat log (Game.combatLog, the last LOG_MAX entries, not
    saved), as plain data for the view to put into words: {turn, kind, ...}, kind one of
    'hit' (a, d, roll, chance, dmg), 'soak' and 'miss' (a, d, roll, chance), 'harm' (d,
    dmg: from a harm tile), 'destroyed' (d, linked: how many linked below it went too),
    'xp' (a, xp: in hundredths), 'level' (a, level) and 'multikill' (count: the kills of
    one action, when more than one).
    a and d (attacker, defender) are who they were (see whoOf), so an entry still reads
    the same once the piece is gone.
    
    Action points: a piece acts (moves, attacks, swaps, detaches, attaches...) by spending
    them, the actionCost rule's an action (at least MIN_COST; a jump too, but it exhausts
    the piece; a step onto dear going more: see moveCost), so only with that many. They're kept in hundredths (AP_UNIT a point), as
    whole numbers, so they add up exactly. At the end of each turn, after the enemies',
    every piece but an exhausted one (see Effects.js) gets back the apRecovery rule's points, up to its pool, the apPool rule's
    (but at least a point, and an action, so everything can act). A new piece starts with
    none (but your core starts a game with an action's). When an enemy first comes into your sight it gets the apInitiative
    rule's points, how quick it is to notice you and act, and your pieces theirs too (once a
    turn), up to their pools. The rules are of a piece's level and stats, not rounded. */
(pkg => {
    'use strict';
    
    const {
            Subtypes, isObj, attrs:{evaluate}, Items:{parseItemList},
            AP_UNIT, XP_UNIT, STATS,
            VAR_XP, VAR_LEVEL, STAT_VARS, XP_VARS, MULTI_KILL_VARS, DAMAGE_VARS,
            EFFECT_EXHAUSTED, EFFECT_RALLYING, EFFECT_RALLIED,
            CHARACTER_NAME_MAX:NAME_MAX, CHARACTER_DESCRIPTION_MAX:DESCRIPTION_MAX,
            isNatNum, isIntOfAtLeast, isIntBetween, formatXp
        } = pkg,
        
        /*  What the damageRoll rule (of rules) comes to for a range of min to max and the
            rolls roll and roll2: a whole number, not below 0. */
        rolled = (rules, min, max, roll, roll2) => Math.max(0, Math.floor(evaluate(rules.damageRoll, DAMAGE_VARS, {min, max, roll, roll2})) || 0),
        
        isRange = v => Array.isArray(v) && v.length === 2 && v.every(isNatNum) && v[0] <= v[1],
        isIds = v => v === undefined || (Array.isArray(v) && v.every(s => typeof s === 'string')),
        isFlag = v => v === undefined || typeof v === 'boolean',
        
        /*  A species as the data has it, made usable ({ranges:{stat:[min, max]},
            typical:{stat:n}, damage:[min, max], playable, backgrounds:[ids] or null,
            corpse:id or undefined}), or null if it isn't. */
        parseSpecies = entry => {
            const ranges = {},
                typical = {},
                damage = entry.damage ?? DEFAULT_DAMAGE;
            let ok = isRange(damage) && isFlag(entry.playable) && isIds(entry.backgrounds) &&
                (entry.corpse === undefined || (typeof entry.corpse === 'string' && !!entry.corpse));
            for (const s of STATS) {
                const v = entry.stats?.[s] ?? DEFAULT_STAT,
                    [min, mid, max] = Array.isArray(v) && v.length === 2 ? [v[0], Math.round((v[0] + v[1]) / 2), v[1]] : Array.isArray(v) ? v : [];
                if (Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every(isNatNum) && min <= mid && mid <= max) {
                    ranges[s] = [min, max];
                    typical[s] = mid;
                } else {
                    ok = false;
                }
            }
            return ok ? {
                ranges, typical, damage:[...damage], playable:entry.playable === true,
                backgrounds:entry.backgrounds ? [...entry.backgrounds] : null, corpse:entry.corpse
            } : null;
        },
        
        /*  A background as the data has it, made usable ({playable, species:[ids] or
            null, statAdj:{stat:n}, items}), or null if it isn't. */
        parseBackground = entry => {
            const adj = entry.statAdj ?? {},
                items = parseItemList(entry.items),
                ok = isFlag(entry.playable) && isIds(entry.species) && isObj(adj) && items &&
                    Object.entries(adj).every(([s, v]) => STATS.includes(s) && Number.isInteger(v)); // (below 0 too)
            return ok ? {
                playable:entry.playable === true, species:entry.species ? [...entry.species] : null, statAdj:{...adj}, items
            } : null;
        },
        
        DEFAULT_STAT = [3, 10, 18],          // a species' stat it doesn't give: [min, typical, max]
        DEFAULT_DAMAGE = [1, 4],             // a species' base damage, if it doesn't give one
        // A species for a profile with none (only the fallback profile below)
        FALLBACK_SPECIES = {id:'', name:'', description:'', ...parseSpecies({})},
        
        /*  The species a profile's "species" names (an id, or a list of them), or null if
            it names none, or any that isn't there. */
        speciesOf = v => {
            const ids = typeof v === 'string' ? [v] : Array.isArray(v) && v.length && v.every(s => typeof s === 'string') ? v : [],
                list = ids.map(s => pkg.species.get(s));
            return list.length && list.every(Boolean) ? list : null;
        },
        
        /*  A profile as the data has it, made usable ({species:[ids], stats:{its own},
            damage (or null: its species'), items, ...}), or null if it isn't (its species
            must be in pkg.species). */
        parseProfile = (entry, id, species = speciesOf(entry.species)) => {
            const stats = entry.stats ?? {}, level = entry.level ?? 1, damage = entry.damage,
                items = parseItemList(entry.items);
            if (!species) {
                console.error('Profile', id, 'has no species', JSON.stringify(entry.species), 'that there is');
                return null;
            }
            if (!(stats && typeof stats === 'object' && !Array.isArray(stats)) ||
                !Object.entries(stats).every(([s, v]) => STATS.includes(s) && isNatNum(v) && species.every(sp => v >= sp.ranges[s][0] && v <= sp.ranges[s][1])) ||
                !isIntOfAtLeast(level, 1) ||
                !(damage === undefined || isRange(damage)) ||
                !isNatNum(entry.penetration ?? 0) || !isNatNum(entry.armor ?? 0) ||
                !(entry.hp === undefined || isIntOfAtLeast(entry.hp, 1)) ||
                !isNatNum(entry.xp ?? 0) || !isIds(entry.backgrounds) || !items) return null;
            return {species:species.map(sp => sp.id), backgrounds:[...(entry.backgrounds ?? [DEFAULT_ENEMY_BACKGROUND])],
                stats:{...stats}, level, damage:damage ? [...damage] : null,
                penetration:entry.penetration ?? 0, armor:entry.armor ?? 0, hp:entry.hp, xp:entry.xp, items};
        },
        
        // What a profile is if the data doesn't say (or has no such one), and yours
        // (nothing of its own: all from its species)
        DEFAULT_ENEMTY = 'creeper',
        DEFAULT_ENEMY_BACKGROUND = 'denizen',
        FALLBACK = parseProfile({}, '', [FALLBACK_SPECIES]),
        
        LOG_MAX = 200,                       // combat log entries kept
        ODDS_STEPS = 60,                     // rolls tried each way in damageOdds (exact for ranges of 1 to 6, 10, 12... values)
        
        MIN_COST = 10,                       // the least an action can cost (so there's an end to them)
        LEVEL_UP_MS = 1400;                  // how long the rings of a level up take to play
    
    pkg.species = new Subtypes('species', parseSpecies);
    pkg.backgrounds = new Subtypes('background', parseBackground);
    pkg.enemies = new Subtypes('enemy', parseProfile);
    
    pkg.Combat = new JS.Module('Combat', {
        /*  Whether the species and background with these ids fit: each is there, and
            allows the other (if it says which it allows). */
        /*  The stats a creature of the species and background with these ids starts
            from: the species' typical ones, with the background's statAdj added, each
            kept in the species' range. */
        baselineStats: function(speciesId, backgroundId) {
            const species = pkg.species.get(speciesId) ?? FALLBACK_SPECIES,
                adj = pkg.backgrounds.get(backgroundId)?.statAdj ?? {};
            return Object.fromEntries(STATS.map(s => {
                const [min, max] = species.ranges[s];
                return [s, Math.min(max, Math.max(min, species.typical[s] + (adj[s] ?? 0)))];
            }));
        },
        
        backgroundFits: function(speciesId, backgroundId) {
            const s = pkg.species.get(speciesId),
                b = pkg.backgrounds.get(backgroundId);
            return !!s && !!b && (!s.backgrounds || s.backgrounds.includes(b.id)) && (!b.species || b.species.includes(s.id));
        },
        
        // ---- Character creation ----
        // Your core is created at the start of a game (see Game.reset, and the character
        // sheet): a name (1 to NAME_MAX letters, not all space), a description (up to
        // DESCRIPTION_MAX), a playable species and a playable background that fit, and its
        // stats: from its baseline (its species' typical ones with its background's
        // adjustments: see baselineStats), each at most creationNegAdj below and
        // creationPosAdj above (and in its species' range), and creationPoints more in all
        // (lowering one gives a point to raise another).
        
        /*  What's wrong with character ch ({name, description, species, background,
            stats}): '' if nothing, else 'name', 'description', 'species', 'background' or
            'stats'. */
        characterProblem: function(ch) {
            const species = pkg.species.get(ch?.species);
            let retval = '';
            if (typeof ch?.name !== 'string' || !ch.name.trim() || ch.name.length > NAME_MAX) {
                retval = 'name';
            } else if (typeof ch.description !== 'string' || ch.description.length > DESCRIPTION_MAX) {
                retval = 'description';
            } else if (!species?.playable) {
                retval = 'species';
            } else if (!pkg.backgrounds.get(ch.background)?.playable || !this.backgroundFits(species.id, ch.background)) {
                retval = 'background';
            } else if (!(ch.stats && STATS.every(s => {
                const [min, max] = this.creationRange(species.id, ch.background, s);
                return isIntBetween(ch.stats[s], min, max);
            }) && STATS.reduce((n, s) => n + ch.stats[s] - this.baselineStats(species.id, ch.background)[s], 0) === this.creationPoints())) {
                retval = 'stats';
            }
            return retval;
        },
        
        /*  The stat points to spend creating a character. */
        creationPoints: function() {return Math.max(0, Math.round(this.rules.creationPoints)) || 0;},
        
        /*  The range a created character of the species and background with these ids
            can have stat in: [min, max], its baseline value less creationNegAdj to it plus
            creationPosAdj, within the species' range. */
        creationRange: function(speciesId, backgroundId, stat) {
            const species = pkg.species.get(speciesId) ?? FALLBACK_SPECIES,
                base = this.baselineStats(speciesId, backgroundId)[stat],
                [min, max] = species.ranges[stat];
            return [Math.max(min, base - this.rules.creationNegAdj), Math.min(max, base + this.rules.creationPosAdj)];
        },
        
        /*  Makes piece p (yours) character ch (see characterProblem): its species,
            background, stats, name and description, at full HP, carrying what its
            background gives it, with what it can equipped. */
        makeCharacter: function(p, ch) {
            this.giveProfile(p, undefined, ch.species, ch.background);
            this.giveBackgroundItems(p);
            p.stats = {...ch.stats};
            p.name = ch.name.trim();
            p.description = ch.description;
            p.maxHp = p.hp = this.maxHpOf(p);
            this.giveNeeds(p);
        },
        
        /*  Piece p gets what its background gives it (see items), and equips what it can
            (as your character does, and enemies, with their own: see giveProfile). */
        giveBackgroundItems: function(p) {
            this.rollItems(p, pkg.backgrounds.get(p.background)?.items ?? [], this.rngFor('items', p.id, 'background'));
            this.equipAll(p);
        },
        
        /*  A piece of yours as character ch would be, not on the board: for the character
            sheet to show. */
        characterPiece: function(ch) {
            const p = {type:'core', owner:'player', x:0, y:0, parentId:null, rank:this.rules.rankBase, trail:[]};
            this.makeCharacter(p, {name:'', description:'', ...ch});
            return p;
        },
        
        /*  Gives piece p its species, background and profile, at full HP, with no status
            effects; an enemy carrying what its profile and its background give it (and
            nothing else), with what it can equipped, and one of yours nothing (your
            character gets what its background gives it: see makeCharacter), with its
            needs (see Needs.js). An enemy's profile is its table's for id (its enemyId's; "creeper" if
            none), its species speciesId if that's one of the profile's (else its first),
            and its background backgroundId if that's one of the profile's that fits, else
            one that fits at random (none, with an error, if none do). Yours are the
            species speciesId if there is one (else the first playable one), and the
            background backgroundId if it's playable and fits (else the first playable one
            that does). */
        giveProfile: function(p, id, speciesId, backgroundId) {
            const enemy = p.owner === 'enemy',
                profile = enemy ? pkg.enemies.get(id ?? DEFAULT_ENEMTY) ?? FALLBACK : FALLBACK,
                species = (enemy ? pkg.species.get(profile.species.includes(speciesId) ? speciesId : profile.species[0]) :
                    pkg.species.get(speciesId) ?? pkg.species.list().find(s => s.playable)) ?? FALLBACK_SPECIES,
                fits = b => this.backgroundFits(species.id, b),
                choices = enemy ? profile.backgrounds.filter(fits) : pkg.backgrounds.list().filter(b => b.playable && fits(b.id)).map(b => b.id);
            delete p.needs; // (what they'd do to its stats isn't its profile's)
            delete p.hpCarry;
            p.species = species.id;
            if (choices.includes(backgroundId)) {
                p.background = backgroundId;
            } else if (enemy) {
                p.background = choices.length ? choices[Math.floor(this.rngFor('background', p.id)() * choices.length)] : '';
                // (Not for the fallback profile: there's no data, before the data has loaded.)
                if (!choices.length && profile !== FALLBACK) {
                    console.error('Enemy', id ?? DEFAULT_ENEMTY, 'has no background that fits its species', species.id);
                }
            } else {
                p.background = choices[0] ?? '';
            }
            p.stats = {...this.baselineStats(species.id, p.background), ...profile.stats};
            p.level = profile.level;
            p.xp = 0;
            p.statPoints = {available:0, spent:0};
            p.damage = [...(profile.damage ?? species.damage)];
            p.penetration = profile.penetration;
            p.armor = profile.armor;
            p.fixedHp = profile.hp;
            p.xpValue = profile.xp != null ? profile.xp * XP_UNIT : this.xpRule('xpValue', p);
            p.maxHp = this.maxHpOf(p);
            p.hp = p.maxHp;
            p.ap = 0;
            p.effects = [];
            p.inventory = {items:[]};
            if (enemy) {
                this.rollItems(p, profile.items, this.rngFor('items', p.id));
                this.giveBackgroundItems(p);
            } else {
                this.giveNeeds(p);
            }
        },
        
        // ---- Action points ----
        // A rule's formula (of a piece's level and stats) for piece p, in hundredths of a
        // point, rounded, and not below 0.
        apRule: function(rule, p) {
            return Math.max(0, Math.round(AP_UNIT * evaluate(this.rules[rule], STAT_VARS, this.statVars(p)))) || 0;
        },
        
        /*  The most action points piece p can have (its pool: at least a point, so it can
            act), and what it gets back a turn. */
        apMax: function(p) {return Math.max(AP_UNIT, this.actionCost(p), this.apRule('apPool', p));},
        // (What its needs add to its recovery too: see Needs.js.)
        apRecovery: function(p) {
            return Math.max(0, this.apRule('apRecovery', p) + Math.round(AP_UNIT * this.needsEffect(p, 'Recovery')));
        },
        
        /*  What an action costs piece p (a jump too): at least MIN_COST. */
        actionCost: function(p) {return Math.max(MIN_COST, this.apRule('actionCost', p));},
        
        /*  What piece p spends on move m (from legalMoves or resolveStep): an action for an
            attack; for a step, an action times the dearest moveCost of the cells the
            pieces it moves land on (Game.moveCostAt: a group goes at its slowest), but
            never more than its pool, so dear going is slow but never a wall. */
        moveCost: function(p, m) {
            const action = this.actionCost(p);
            if (m.attack || !m.moves?.length) return action;
            const mult = Math.max(...m.moves.map(([, x, y]) => this.moveCostAt(x, y)));
            return Math.max(MIN_COST, Math.min(this.apMax(p), Math.round(action * mult)));
        },
        
        /*  Whether piece p has the points for an action costing cost (an action's if not
            given), and the game's on. */
        canAfford: function(p, cost) {return !this.over && !!p && p.ap >= (cost ?? this.actionCost(p));},
        
        /*  Piece p spends cost action points (an action's if not given), and its needs go
            down for them (see Needs.needsSpend). */
        spend: function(p, cost) {
            cost ??= this.actionCost(p);
            p.ap = Math.max(0, p.ap - cost);
            if (p.needs) this.needsSpend(p, cost);
        },
        
        /*  Piece p gets ap more action points, up to its pool (but never loses any). */
        giveAp: function(p, ap) {p.ap = Math.max(p.ap, Math.min(this.apMax(p), p.ap + ap));},
        
        /*  The end of a turn: every piece but an exhausted one gets back its recovery, up
            to its pool. */
        recoverAp: function() {
            for (const p of this.pieces.values()) {
                if (!this.effectOn(p, EFFECT_EXHAUSTED)) this.giveAp(p, this.apRecovery(p));
            }
        },
        
        // ---- Rally ----
        // A piece of yours that's hurt can rally, for the rallyCost rule's action points
        // (at least MIN_COST): it's rallying (see Effects.js) for the rallyTurns rule's
        // turns (at least 1), and gets back the rallyAmount rule's HP at the end of each
        // (housekeeping, before the countdown), up to its max. It has rallied for the
        // rallyRefresh rule's turns (counting from then), and can't rally again until both
        // are over.
        rallyCost: function(p) {return Math.max(MIN_COST, this.apRule('rallyCost', p));},
        
        // ---- Items ----
        // What taking an item, dropping one and transferring one cost a piece (see
        // Items.js): the takeCost, dropCost and transferCost rules' action points (at
        // least MIN_COST).
        takeCost: function(p) {return Math.max(MIN_COST, this.apRule('takeCost', p));},
        dropCost: function(p) {return Math.max(MIN_COST, this.apRule('dropCost', p));},
        transferCost: function(p) {return Math.max(MIN_COST, this.apRule('transferCost', p));},
        equipCost: function(p) {return Math.max(MIN_COST, this.apRule('equipCost', p));},
        // What equipping (or unequipping) item it costs piece p: its kind's equip cost, if
        // it has one (at least MIN_COST), else the equipCost rule's.
        equipCostOf: function(p, it) {
            const cost = this.itemKind(it).equip?.cost;
            return cost == null ? this.equipCost(p) : Math.max(MIN_COST, Math.round(cost * AP_UNIT));
        },
        // What eating or drinking item it costs piece p: its kind's consumeCost, if it has
        // one (at least MIN_COST), else the consumeCost rule's; and what filling a flask
        // costs (the fillCost rule's).
        consumeCostOf: function(p, it) {
            const cost = this.itemKind(it).consumeCost;
            return cost == null ? Math.max(MIN_COST, this.apRule('consumeCost', p)) : Math.max(MIN_COST, Math.round(cost * AP_UNIT));
        },
        fillCost: function(p) {return Math.max(MIN_COST, this.apRule('fillCost', p));},
        rallyRefresh: function(p) {return Math.max(0, this.statRule('rallyRefresh', p));},
        canRally: function(p) {
            return !this.over && p?.owner === 'player' && p.hp < p.maxHp && !this.effectOn(p, EFFECT_RALLYING) &&
                !this.effectOn(p, EFFECT_RALLIED) && this.canAfford(p, this.rallyCost(p));
        },
        playerRally: function(p) {
            const done = this.canRally(p);
            if (done) {
                this.spend(p, this.rallyCost(p));
                this.addEffect(p, EFFECT_RALLYING, Math.max(1, this.statRule('rallyTurns', p)));
                this.addEffect(p, EFFECT_RALLIED, this.rallyRefresh(p));
                this.afterPlayerAction();
            }
            return done;
        },
        
        /*  Housekeeping: every rallying piece gets back its rallyAmount in HP, up to its max. */
        rallyHeal: function() {
            for (const p of this.pieces.values()) {
                if (this.effectOn(p, EFFECT_RALLYING)) {
                    const n = Math.min(p.maxHp - p.hp, Math.max(0, this.statRule('rallyAmount', p)));
                    if (n > 0) {
                        p.hp += n;
                        this.fx(p.x, p.y, `+${n} HP`, '--heal', {});
                    }
                }
            }
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
                for (const p of this.piecesOf('player')) {
                    this.giveAp(p, this.apRule('apInitiative', p));
                }
            }
        },
        
        // A rule's formula (of a piece's level and stats) for piece p, rounded down.
        statRule: function(rule, p) {
            return Math.floor(evaluate(this.rules[rule], STAT_VARS, this.statVars(p))) || 0;
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
        
        /*  The damage attacker a's hit does, before armor: [min, max], neither below 0:
            its weapon's (what it has equipped as its weapon: see Items.equipment), or if it
            has none (or one without damage), its own, with its damageBonus. */
        damageRange: function(a) {
            const bonus = this.statRule('damageBonus', a),
                weapon = this.weaponOf(a);
            return (weapon?.damage ?? a.damage).map(n => Math.max(0, n + bonus));
        },
        
        /*  What piece p has equipped as its weapon (its kind's equip: {damage,
            penetration, ...}), or undefined. */
        weaponOf: function(p) {
            const it = this.equippedIn(p, 'weapon');
            return it && this.itemKind(it).equip;
        },
        
        /*  Piece p's armor: its own (its profile's), and what it has equipped adds. */
        armorOf: function(p) {
            return (p.armor ?? 0) + this.equipment(p).reduce((n, it) => n + (this.itemKind(it).equip?.armor ?? 0), 0);
        },
        
        /*  A roll of attacker a's damage, before armor (the damageRoll rule, of its range
            and two rolls), a whole number, not below 0. */
        rollDamage: function(a) {
            const [min, max] = this.damageRange(a);
            return rolled(this.rules, min, max, this.combatRoll(), this.combatRoll());
        },
        
        /*  How likely each amount of damage is when attacker a hits piece d, after its
            armor: an array, [k] the chance (0 to 1) that a hit does k. Worked out from the
            damageRoll rule over an even grid of ODDS_STEPS by ODDS_STEPS rolls, so it's
            exact for one roll over a range whose size divides ODDS_STEPS, and close
            otherwise. */
        damageOdds: function(a, d) {
            const [min, max] = this.damageRange(a),
                armor = this.armorAgainst(a, this.armorOf(d)),
                each = 1 / (ODDS_STEPS * ODDS_STEPS),
                odds = [];
            for (let i = 0; i < ODDS_STEPS; i++) {
                for (let j = 0; j < ODDS_STEPS; j++) {
                    const k = Math.max(0, rolled(this.rules, min, max, (i + 0.5) / ODDS_STEPS, (j + 0.5) / ODDS_STEPS) - armor);
                    odds[k] = (odds[k] ?? 0) + each;
                }
            }
            return Array.from(odds, v => v ?? 0);
        },
        
        /*  Attacker a's penetration: its weapon's (what it has equipped as its weapon, or
            if it has none, its own), and its penetrationBonus if more than 0. */
        penetrationOf: function(a) {
            const weapon = this.weaponOf(a);
            return (weapon ? weapon.penetration : a.penetration) + Math.max(0, this.statRule('penetrationBonus', a));
        },
        
        /*  How much of armor (damage reduction) gets through attacker a's penetration. */
        armorAgainst: function(a, armor) {return Math.max(0, armor - this.penetrationOf(a));},
        
        /*  The damage attacker a's hit does to piece d, after its armor: [min, max]. */
        damageAgainst: function(a, d) {
            const armor = this.armorAgainst(a, this.armorOf(d));
            return this.damageRange(a).map(n => Math.max(0, n - armor));
        },
        
        // ---- The combat log ----
        /*  Who piece p is, for the log: {owner, core (whether it's your core), enemyId}. */
        whoOf: function(p) {
            const who = {owner:p.owner, core:p.id === this.playerCoreId};
            if (p.name) who.name = p.name;
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
                const dmg = Math.max(0, this.rollDamage(a) - this.armorAgainst(a, this.armorOf(d)));
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
        
        // ---- Experience ----
        // A rule's formula (of a piece's level and stats) for piece p, in hundredths of an
        // xp point, rounded, and not below 0.
        xpRule: function(rule, p) {
            return Math.max(0, Math.round(XP_UNIT * evaluate(this.rules[rule], STAT_VARS, this.statVars(p)))) || 0;
        },
        
        /*  The parentXPShare or childXPBonus rule's formula for xp (hundredths) that piece p
            gets, whose parent is parent: in hundredths, rounded, not below 0. Its
            variables: xp (in points), rank (p's), parentRank and level (p's). */
        xpShareRule: function(rule, xp, p, parent) {
            return Math.max(0, Math.round(XP_UNIT * evaluate(this.rules[rule], XP_VARS,
                {xp:xp / XP_UNIT, rank:p.rank, parentRank:parent.rank, level:p.level}))) || 0;
        },
        
        /*  Gives the xp of the kills since it was last called (the kills of one action: see
            Game.damage) as one multi-kill. killCount is all the enemy pieces they destroyed
            (what was linked below a killed piece too), by any of your pieces; each piece of
            yours that killed some, if it's still there, gets the multiKillBonusXP rule's
            of their xp (the xp itself for one kill), then shares it (see awardXp). The
            rule's variables: xp (in points), killCount and level (the killer's). */
        awardKills: function() {
            const kills = this.pendingKills;
            if (kills.length) {
                this.pendingKills = [];
                const killCount = kills.reduce((n, k) => n + k.count, 0),
                    xpBy = new Map();
                for (const k of kills) xpBy.set(k.killerId, (xpBy.get(k.killerId) ?? 0) + k.xp);
                const killers = [...xpBy.keys()].map(id => this.pieces.get(id)).filter(Boolean);
                if (killCount > 1 && killers.length && !this.over) {
                    const p = killers[0];
                    this.logCombat({kind:'multikill', count:killCount});
                    this.fx(p.x, p.y, `${killCount}× multi-kill!`, '--gain', {delay:300, follow:p.id});
                }
                for (const p of killers) {
                    if (!this.over) {
                        const xp = xpBy.get(p.id),
                            bonus = Math.round(XP_UNIT * evaluate(this.rules.multiKillBonusXP, MULTI_KILL_VARS, {xp:xp / XP_UNIT, killCount, level:p.level}));
                        this.awardXp(p, Math.max(0, bonus) || 0);
                    }
                }
            }
        },
        
        /*  Piece p earns xp (hundredths) for a kill, and its parents a share of it: a piece
            with a parent gets the childXPBonus rule's more (of its parent's rank), then
            passes the parentXPShare rule's of all it got (of its own rank) up to its parent,
            which does the same with that, and so on up. */
        awardXp: function(p, xp) {
            let piece = p,
                amount = xp;
            while (piece && amount > 0) {
                const parent = this.parent(piece);
                if (parent) amount += this.xpShareRule('childXPBonus', amount, piece, parent);
                this.gainXp(piece, amount);
                amount = parent ? this.xpShareRule('parentXPShare', amount, piece, parent) : 0;
                piece = parent;
            }
        },
        
        /*  Piece p gains xp (hundredths), going up a level (or more) at the xpToLevel
            rule's xp. */
        gainXp: function(p, xp) {
            this.logCombat({kind:VAR_XP, a:this.whoOf(p), xp});
            this.fx(p.x, p.y, `+${formatXp(xp)} XP`, '--gain', {delay:160, follow:p.id});
            p.xp += xp;
            for (let need = this.xpRule('xpToLevel', p); need > 0 && p.xp >= need; need = this.xpRule('xpToLevel', p)) {
                p.xp -= need;
                p.level++;
                p.statPoints.available += Math.max(0, this.statRule('statPointsPerLevel', p));
                this.updateMaxHp(p);
                this.logCombat({kind:VAR_LEVEL, a:this.whoOf(p), level:p.level});
                // (After its "+n XP" has risen out of the way.)
                this.fx(p.x, p.y, 'Level ' + p.level + '!', '--gain', {delay:500, follow:p.id});
                this.fx(p.x, p.y, '', '--level-up', {levelUp:true, core:p.id === this.playerCoreId, delay:500, dur:LEVEL_UP_MS, follow:p.id});
            }
        },
        
        /*  Piece p's max HP worked out again (after a level or stats changed), its HP going
            up by as much as it does. */
        updateMaxHp: function(p) {
            const max = this.maxHpOf(p);
            p.hp += Math.max(0, max - p.maxHp);
            p.maxHp = max;
        },
        
        /*  The range piece p's stat can be in: [min, max], from its species. */
        statRange: function(p, stat) {
            return (pkg.species.get(p.species) ?? FALLBACK_SPECIES).ranges[stat];
        },
        
        /*  Piece p as it would be with the points of adds ({stat:n}) put into its stats: a
            copy, its max HP (and HP) worked out again. For the character sheet to show
            what spending them would do. */
        withStats: function(p, adds) {
            const q = {...p, stats:{...p.stats}, needs:p.needs && {...p.needs}};
            this.changeStats(q, adds);
            return q;
        },
        
        /** @private Piece p's stats change by adds ({stat:n}): its max HP follows, and its
            needs keep where they were between their bounds (see Needs.rescaleNeeds). */
        changeStats: function(p, adds) {
            const was = this.needsBounds(p);
            for (const [s, v] of Object.entries(adds)) p.stats[s] += v;
            this.updateMaxHp(p);
            this.rescaleNeeds(p, was);
        },
        
        /*  Your piece p spends stat points: adds, {stat:n}, says how many on each stat (none
            below 0, none taking a stat over its species' max, and in all no more than it
            has available). Its max HP, its needs and the rest follow its stats. Returns
            whether it did. */
        spendStatPoints: function(p, adds) {
            const entries = Object.entries(adds),
                total = entries.reduce((n, [, v]) => n + v, 0);
            let retval = false;
            if (p?.owner === 'player' && this.pieces.has(p.id) && total <= p.statPoints.available &&
                entries.every(([s, v]) => STATS.includes(s) && isNatNum(v) && p.stats[s] + v <= this.statRange(p, s)[1])) {
                this.changeStats(p, adds);
                p.statPoints.available -= total;
                p.statPoints.spent += total;
                retval = true;
            }
            return retval;
        },
        
        // Your highest level, and the total of your pieces' levels
        maxLevel: function() {return Math.max(0, ...this.piecesOf('player').map(p => p.level));},
        totalLevels: function() {return this.piecesOf('player').reduce((n, p) => n + p.level, 0);}
    });
})(hc);
