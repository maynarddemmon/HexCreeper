/*  Fixtures: what sits on the ground of a cell: heals, harms and loot, which do something
    when one of your pieces enters it, and features (barricades, brambles, later doors),
    which may be in the way. Their kinds, from data/environs.json5's "fixtures" (see
    Subtypes.js), and how a game makes, reveals, uses and breaks them (a module included in
    Game).
    
    A cell has a tile (its terrain: open floor, or a solid or a hole: see Game.tiles) and
    at most one fixture over it (Game.fixtures, "x,y" -> fixture), only on a cell you can
    stand on. A fixture is plain data, saved with the game: {x, y, type, subtype, pool,
    magnitude, uses, revealedAt, shown}, and hp and state if its kind has them (see
    makeFixture).
    
    Every kind has a name, a description, a type ("heal", "harm", "loot", or "feature",
    which does nothing when entered: what it does, which the rest of the game goes by, e.g.
    pieces keep off harm) and (each optional but pool, which a feature hasn't):
    - revealMode: when the tile shows: "instant" (the default: once its cell is in sight),
      "hidden" (once one of your pieces enters it) or {"proximity":n} (once one of your
      pieces comes within n cells). Once shown it stays shown.
    - pool: what it holds (HP to heal, damage to do, gold): n, {"min","max"} (rolled when
      the tile is made) or "infinite".
    - magnitude: what it gives each piece it affects, each time it's used: n, {"min","max"}
      (rolled when it's made) or "pool" (the default: all that's left). It never gives more
      than is left.
    - showMagnitude: when its magnitude shows, as revealMode; "hidden": once it's used.
    - showPool: whether what's left in it shows (default false).
    - area: which pieces it affects when one of yours enters it: a radius (default 0, just
      the piece on it) or {"radius", "shape"}: "flat" (every piece within the radius
      alike), "ring" (only those exactly the radius away) or "fade" (full at the centre,
      less by steps to nothing a cell past the radius). Nearest first, so the pool can run
      out part way.
    - duration: when it's gone: "exhausted" (the default: once its pool is empty, so
      never with an infinite pool), "once" (after it's used once), {"count":n} (after n
      uses) or {"countdown":n} (n turns after it's revealed).
    And, as solids have (see Solids.js), each optional:
    - state: {name:value}, true, false or a number: what each fixture of the kind keeps
      (a door's open, say), starting at these. Its formulas can use these names, and hp
      (what it has left, or 0).
    - composition: the material it's made of: its hardness is the fixture's DR, and its
      opacity (times coverage) how much it blocks sight. Without one, it doesn't block
      sight, and has no DR.
    - hp: what it can take (a whole number, at least 1). With hp, it can be attacked, as a
      solid is, when it's in the way; without, it can't be broken.
    - coverage: how much of the cell it fills, 0-100 (default 100), or a formula of its
      state.
    - moveCost: what stepping onto it costs, times the floor's (default 1), or a formula of
      its state: 0 or less, it's in the way, as a solid is (nothing can step onto it, be
      placed or land there, or jump over it).
    - floor: the floor subtype it leaves under it when it's gone.
    - destroyInto: the kind of fixture it leaves when it's gone (when it's broken, used up
      or its countdown runs out), revealed if it was.
    - fillColor, borderColor: a feature's colours (any CSS colour, or a --variable).
    - shape: how a feature is drawn: "hex" (the default: a hexagon inside its cell) or
      "door" (see Render.js).
    - orientable: whether each one faces a way (default false): it then has a facing, 0 to
      5 (an index into hex.dirs), which splits the six cells round it into its front
      (facing and the next direction round), its sides (the next, and the one opposite:
      the wall it's in, for a door) and its back (the two opposite its front).
    - actions: {name:action}: what a piece of yours next to it can do to it (see
      fixtureActions), each an action, for its action points:
      - from: the sides it can be done from: ["front", "back", "side"] (the default: all;
        for one that isn't orientable, it's any side);
      - when: a formula of its state: it can be done only when this isn't 0 (default 1);
      - set: {state name: value}, a number, true or false, or a formula of its state (as
        it was): what doing it changes;
      - onStep: true if a piece of yours stepping into it does this (and stays put),
        rather than anything else a step would do;
      - label: what it's called (default: its name, with a capital).
      It can't be done if it would put the fixture in the way of a piece on it.
    - describe: [{when, text}]: words for its state, shown when you point at it (a door's
      "shut", "barred"): each text whose when (a formula of its state) isn't 0.
    
    Heals heal your pieces (what the piece doesn't need flows along its links, and what
    nobody needs stays in the heal); harms damage any piece; loot gives you gold. Only your
    pieces set them off, by entering their cell: a step, being carried, a jump, a swap or
    being placed there. */
(pkg => {
    'use strict';
    
    const {Subtypes, hexDist} = pkg,
        {isInt, isText, isPercent} = Subtypes,
        
        // The types of fixture
        FIXTURE_HEAL = pkg.FIXTURE_HEAL = 'heal',
        FIXTURE_HARM = pkg.FIXTURE_HARM = 'harm',
        FIXTURE_LOOT = pkg.FIXTURE_LOOT = 'loot',
        FIXTURE_FEATURE = pkg.FIXTURE_FEATURE = 'feature',
        FIXTURE_TYPES = pkg.FIXTURE_TYPES = [FIXTURE_HEAL, FIXTURE_HARM, FIXTURE_LOOT, FIXTURE_FEATURE],
        
        SHAPES = ['flat', 'ring', 'fade'],
        
        // When a tile or its magnitude shows: {mode:"instant" | "hidden" | "proximity", range}.
        parseShow = v => {
            let show = null;
            if (v === undefined || v === 'instant') {
                show = {mode:'instant', range:0};
            } else if (v === 'hidden') {
                show = {mode:'hidden', range:0};
            } else if (isInt(v?.proximity)) {
                show = {mode:'proximity', range:v.proximity};
            }
            return show;
        },
        
        // n or {min, max}, as {min, max}.
        parseRange = v => {
            let range = null;
            if (isInt(v)) {
                range = {min:v, max:v};
            } else if (isInt(v?.min) && isInt(v?.max) && v.min <= v.max) {
                range = {min:v.min, max:v.max};
            }
            return range;
        },
        
        // {radius, shape}
        parseArea = v => {
            let area = null;
            if (v === undefined) {
                area = {radius:0, shape:'flat'};
            } else if (isInt(v)) {
                area = {radius:v, shape:'flat'};
            } else if (isInt(v?.radius) && (v.shape === undefined || SHAPES.includes(v.shape))) {
                area = {radius:v.radius, shape:v.shape ?? 'flat'};
            }
            return area;
        },
        
        // {mode:"exhausted" | "once" | "count" | "countdown", n}
        parseDuration = v => {
            let duration = null;
            if (v === undefined || v === 'exhausted') {
                duration = {mode:'exhausted', n:0};
            } else if (v === 'once') {
                duration = {mode:'once', n:1};
            } else if (isInt(v?.count) && v.count >= 1) {
                duration = {mode:'count', n:v.count};
            } else if (isInt(v?.countdown) && v.countdown >= 1) {
                duration = {mode:'countdown', n:v.countdown};
            }
            return duration;
        },
        
        // {name:value}: true, false or numbers (none named hp), or null.
        parseState = v => v === undefined ? {} :
            v !== null && typeof v === 'object' && !Array.isArray(v) && !Object.hasOwn(v, 'hp') &&
            Object.values(v).every(s => typeof s === 'boolean' || Number.isFinite(s)) ? {...v} : null,
        
        // A number, or a formula (text) of names; def if not given; undefined if neither.
        parseFormula = (v, def, names) => v === undefined ? def : Number.isFinite(v) ? v :
            typeof v === 'string' && !pkg.attrs.formulaProblem(v, names) ? v : undefined,
        
        SIDES = ['front', 'back', 'side'],
        
        // {name:{from, when, set, onStep, label}}, as above, or null if any doesn't make
        // sense (state: the kind's; names: its formulas' variables).
        parseActions = (v, state, names) => {
            let actions = v === undefined ? {} : null;
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                actions = {};
                for (const [name, a] of Object.entries(v)) {
                    const from = a?.from ?? SIDES,
                        when = parseFormula(a?.when, 1, names),
                        set = a?.set ?? {},
                        ok = Array.isArray(from) && from.every(s => SIDES.includes(s)) && when !== undefined &&
                            set !== null && typeof set === 'object' && !Array.isArray(set) &&
                            Object.entries(set).every(([k, s]) => Object.hasOwn(state, k) && (typeof s === 'boolean' || parseFormula(s, 0, names) !== undefined)) &&
                            (a.onStep === undefined || typeof a.onStep === 'boolean') && isText(a.label);
                    if (ok) {
                        actions[name] = {from, when, set, onStep:a.onStep ?? false, label:a.label || name[0].toUpperCase() + name.slice(1)};
                    } else {
                        actions = null;
                        break;
                    }
                }
            }
            return actions;
        },
        
        // [{when, text}], as above, or null if any doesn't make sense.
        parseDescribe = (v, names) => v === undefined ? [] : Array.isArray(v) &&
            v.every(d => d !== null && typeof d === 'object' && typeof d.text === 'string' && d.text && parseFormula(d.when, 1, names) !== undefined) ?
            v.map(d => ({when:parseFormula(d.when, 1, names), text:d.text})) : null,
        
        // A kind's own properties: its type; pool and magnitude are {min, max}, or null for
        // an infinite pool or a magnitude of the whole pool (which needs a pool that isn't
        // infinite; a feature has neither); state, the formulas' variables (names), and
        // the rest as above (material: its composition's, or null; moveCost and coverage
        // numbers or formulas).
        parseFixture = e => {
            const feature = e.type === FIXTURE_FEATURE,
                infinite = e.pool === 'infinite',
                wholePool = e.magnitude === undefined || e.magnitude === 'pool',
                state = parseState(e.state),
                names = ['hp', ...Object.keys(state ?? {})],
                material = e.composition === undefined ? null : pkg.solids.getMaterial(e.composition) ?? undefined,
                own = {
                    type:e.type,
                    reveal:parseShow(e.revealMode),
                    pool:infinite || feature ? null : parseRange(e.pool),
                    magnitude:wholePool || feature ? null : parseRange(e.magnitude),
                    showMagnitude:parseShow(e.showMagnitude),
                    showPool:e.showPool ?? false,
                    area:parseArea(e.area),
                    duration:parseDuration(e.duration),
                    state, names, material,
                    composition:e.composition ?? null,
                    hp:e.hp ?? null,
                    coverage:parseFormula(e.coverage, 100, names),
                    moveCost:parseFormula(e.moveCost, 1, names),
                    floor:e.floor || null,
                    destroyInto:e.destroyInto || null,
                    fillColor:e.fillColor || null,
                    borderColor:e.borderColor || null,
                    shape:e.shape ?? 'hex',
                    orientable:e.orientable ?? false,
                    actions:state ? parseActions(e.actions, state, names) : null,
                    describe:parseDescribe(e.describe, names)
                },
                ok = FIXTURE_TYPES.includes(own.type) && own.reveal && (feature || ((infinite || own.pool) && (wholePool ? !infinite : own.magnitude))) && own.showMagnitude &&
                    typeof own.showPool === 'boolean' && own.area && own.duration && state && material !== undefined &&
                    (own.hp === null || (Number.isInteger(own.hp) && own.hp >= 1)) && own.coverage !== undefined && own.moveCost !== undefined &&
                    (typeof own.coverage !== 'number' || isPercent(own.coverage)) &&
                    [e.floor, e.destroyInto, e.fillColor, e.borderColor].every(isText) &&
                    ['hex', 'door'].includes(own.shape) && typeof own.orientable === 'boolean' && own.actions && own.describe;
            return ok ? own : null;
        },
        
        // A fixture of a kind that isn't known: shown at once, 1 of whatever it does, then gone.
        FALLBACK = parseFixture({type:FIXTURE_LOOT, pool:1});
    
    pkg.fixtures = new Subtypes('fixture', parseFixture);
    
    /*  The kinds of fixture of a type, as {value, label} options (for a map component's
        attrs: see ProximityTileGenerator.js and CavernsTileGenerator.js). */
    pkg.fixtureOptions = type => () => pkg.fixtures.list().filter(f => f.type === type).map(f => ({value:f.id, label:f.name}));
    
    pkg.Fixtures = new JS.Module('Fixtures', {
        // A fixture's kind (with FALLBACK's properties, and its own type, if that isn't
        // known).
        fixtureType: function(f) {return pkg.fixtures.get(f.subtype) ?? {name:f.type, description:'', ...FALLBACK, type:f.type};},
        
        // The fixture at (x, y) you know of (revealed), optionally of a given type, or null.
        fixtureAt: function(x, y, type) {
            const f = this.fixtures.get(this.key(x, y));
            return f && f.revealedAt != null && (!type || f.type === type) ? f : null;
        },
        
        // A harm you know of. (Harms only hurt what you set them off on, so the enemies,
        // who keep off them, needn't know of hidden ones.)
        isHarm: function(x, y) {return !!this.fixtureAt(x, y, FIXTURE_HARM);},
        
        /*  A new fixture of kind subtype (its type that kind's, or type if the kind isn't
            known), with its pool and magnitude rolled (by rng), not yet revealed: {x, y,
            type, subtype, pool, magnitude, uses, revealedAt, shown}, and hp and state (a
            copy of its kind's) if its kind has them, and a facing (by rng) if it's
            orientable. pool: what's left, or null if
            infinite; magnitude: what it gives, or null for all that's left; revealedAt:
            the turn it was revealed, or null; shown: whether its magnitude shows. */
        makeFixture: function(x, y, subtype, rng=Math.random, type=FIXTURE_LOOT) {
            const kind = pkg.fixtures.get(subtype) ?? {...FALLBACK, type},
                roll = r => r ? r.min + Math.floor(rng() * (r.max - r.min + 1)) : null,
                f = {x, y, type:kind.type, subtype, pool:roll(kind.pool), magnitude:roll(kind.magnitude), uses:0, revealedAt:null, shown:false};
            if (kind.hp) f.hp = kind.hp;
            if (Object.keys(kind.state).length) f.state = {...kind.state};
            if (kind.orientable) f.facing = Math.floor(rng() * 6);
            return f;
        },
        
        // ---- Features: in the way, seen through, broken ----
        
        /*  What fixture f's kind's prop (moveCost or coverage: a number or a formula of its
            state and hp) comes to for it now. */
        fixtureValue: function(f, prop) {
            const kind = this.fixtureType(f),
                v = kind[prop];
            return typeof v === 'number' ? v : pkg.attrs.evaluate(v, kind.names, {...kind.state, ...f.state, hp:f.hp ?? 0});
        },
        
        /*  Whether there's a fixture at (x, y) that's in the way: its moveCost is 0 or
            less (whether you know of it or not). */
        fixtureBlocks: function(x, y) {
            const f = this.fixtures.get(this.key(x, y));
            return !!f && !(this.fixtureValue(f, 'moveCost') > 0);
        },
        
        /*  What stepping onto (x, y) costs, for its fixture, as a multiple of the floor's:
            its moveCost, or 1 (also for one in the way: what's in the way is the
            caller's to know, and a door opened costs what its floor does). */
        fixtureMoveCost: function(x, y) {
            const f = this.fixtures.get(this.key(x, y)),
                v = f ? this.fixtureValue(f, 'moveCost') : 1;
            return v > 0 ? v : 1;
        },
        
        /*  Whether there's a fixture at (x, y) in the way that a step into it would do
            something to (see stepAction): one with an onStep action whose when holds (a
            shut door that isn't barred), from whatever side. Routes (Go to, Explore, the
            enemies' paths) count such a cell as one they can go on, an action dearer, for
            the step that opens it. */
        stepOpens: function(x, y) {
            const f = this.fixtures.get(this.key(x, y));
            let retval = false;
            if (f && this.fixtureBlocks(x, y)) {
                const kind = this.fixtureType(f),
                    vars = {...kind.state, ...f.state, hp:f.hp ?? 0};
                retval = Object.values(kind.actions).some(a => a.onStep && pkg.attrs.evaluate(String(a.when), kind.names, vars));
            }
            return retval;
        },
        
        /*  How much fixture f blocks sight, 0-100: its material's opacity times its
            coverage, or 0 without a material. */
        fixtureOpacity: function(f) {
            const material = this.fixtureType(f).material;
            return material ? material.opacity * Math.min(100, Math.max(0, this.fixtureValue(f, 'coverage') || 0)) / 100 : 0;
        },
        
        /*  Whether piece can break fixture f: it's a piece of yours, f has HP, and its most
            damage is more than f's DR (its material's hardness) after its penetration (see
            Combat.js). A step attacks one only if it's in the way (see Movement.boardView);
            Attack, any (see Game.attackAt). */
        canBreakFixture: function(piece, f) {
            return piece.owner === 'player' && f?.hp != null &&
                this.damageRange(piece)[1] > this.armorAgainst(piece, this.fixtureType(f).material?.hardness ?? 0);
        },
        
        /*  An attack on fixture f, as on a solid (see Game.damageSolid): the attacker's
            damage roll less its DR. Returns whether that broke it (then it's gone: see
            removeFixture). */
        damageFixture: function(f, attacker) {
            const dmg = this.rollDamage(attacker) - this.armorAgainst(attacker, this.fixtureType(f).material?.hardness ?? 0);
            let broken = false;
            if (dmg > 0) {
                f.hp -= dmg;
                this.fx(f.x, f.y, `-${dmg}`, '--dmg', {bump:{from:attacker}});
                if (f.hp <= 0) {
                    this.removeFixture(f);
                    this.fx(f.x, f.y, '', '--solid', {burst:true});
                    broken = true;
                }
            }
            return broken;
        },
        
        /*  Fixture f is gone (broken, used up, or its countdown has run out): it leaves the
            floor its kind names (if there is one) under it, and the fixture its kind's
            destroyInto names (if there is one) in its place, revealed if f was. */
        removeFixture: function(f) {
            const kind = this.fixtureType(f),
                k = this.key(f.x, f.y);
            this.fixtures.delete(k);
            if (pkg.floors.get(kind.floor)) this.tiles.set(k, this.makeTile(f.x, f.y, pkg.TILE_TYPE_FLOOR, kind.floor));
            if (pkg.fixtures.get(kind.destroyInto)) {
                const into = this.makeFixture(f.x, f.y, kind.destroyInto, this.rngFor('rolls', k, 'into', this.turn));
                if (f.revealedAt != null) into.revealedAt = this.turn;
                this.fixtures.set(k, into);
            }
            this._sightKey = null; // what's there may block sight differently
        },
        
        /*  The words for fixture f's state now (its kind's describe: see describe), in
            order, e.g. ["shut", "barred"]. */
        fixtureDescription: function(f) {
            const kind = this.fixtureType(f),
                vars = {...kind.state, ...f.state, hp:f.hp ?? 0};
            return kind.describe.filter(d => pkg.attrs.evaluate(String(d.when), kind.names, vars)).map(d => d.text);
        },
        
        // ---- Facing and actions ----
        
        /*  Which side of fixture f cell (x, y) is on: "front", "back" or "side" (see
            orientable), "any" for one that isn't orientable, or null if it isn't next to
            it. */
        fixtureSide: function(f, x, y) {
            const dir = pkg.hex.dirs.findIndex(([dx, dy]) => f.x + dx === x && f.y + dy === y);
            let side = null;
            if (dir >= 0) side = this.fixtureType(f).orientable ? ['front', 'front', 'side', 'back', 'back', 'side'][(dir - f.facing + 6) % 6] : 'any';
            return side;
        },
        
        /*  The names of the actions (see actions) piece p ({owner, x, y}) can do to fixture
            f now, in its kind's order: p is next to it, on a side the action can be done
            from, its when holds, and it wouldn't put f in the way of a piece on it; a piece
            of yours, only to one you know of. An enemy can do only what a step does (see
            stepAction: it opens doors). (Whether p has the points is the caller's to
            check.) */
        fixtureActions: function(p, f) {
            const kind = f ? this.fixtureType(f) : null,
                side = kind && p && (p.owner !== 'player' || f.revealedAt != null) ? this.fixtureSide(f, p.x, p.y) : null,
                vars = side ? {...kind.state, ...f.state, hp:f.hp ?? 0} : null;
            return side ? Object.entries(kind.actions).filter(([, a]) =>
                (side === 'any' || a.from.includes(side)) &&
                pkg.attrs.evaluate(String(a.when), kind.names, vars) &&
                !(this.pieceAt(f.x, f.y) && !(this.fixtureValue({...f, state:this.actedState(f, a)}, 'moveCost') > 0))
            ).map(([name]) => name) : [];
        },
        
        /*  Fixture f's state after action a (see actions): its set, worked out from its
            state as it is (a true or false one stays true or false). */
        actedState: function(f, a) {
            const kind = this.fixtureType(f),
                vars = {...kind.state, ...f.state, hp:f.hp ?? 0},
                state = {...kind.state, ...f.state};
            for (const [k, v] of Object.entries(a.set)) {
                const n = typeof v === 'boolean' ? v : pkg.attrs.evaluate(String(v), kind.names, vars);
                state[k] = typeof kind.state[k] === 'boolean' ? !!n : Number(n);
            }
            return state;
        },
        
        /*  The cells next to piece p with a fixture it can do something to (see
            fixtureActions), if it has the points. */
        useTargets: function(p) {
            return p?.owner === 'player' && this.canAfford(p) ?
                pkg.hex.dirs.map(([dx, dy]) => this.fixtureAt(p.x + dx, p.y + dy)).filter(f => f && this.fixtureActions(p, f).length).map(f => ({x:f.x, y:f.y})) : [];
        },
        canUse: function(p) {return this.useTargets(p).length > 0;},
        
        /*  Piece p does action name to the fixture at (x, y), if it can (see fixtureActions),
            for an action. Returns whether it did. */
        playerUse: function(p, x, y, name) {
            const f = this.fixtureAt(x, y),
                done = !this.over && p?.owner === 'player' && this.canAfford(p) && this.fixtureActions(p, f).includes(name);
            if (done) {
                this.actOnFixture(f, name);
                this.spend(p);
                this.afterPlayerAction();
            }
            return done;
        },
        
        /*  Enemy piece p steps into (x, y), if a step there does something to the fixture
            there (see stepAction: opens a door), for an action. Returns whether it did. */
        enemyStepAction: function(p, x, y) {
            const step = this.canAfford(p) ? this.stepAction(p, x, y) : null,
                done = !!step;
            if (done) {
                this.actOnFixture(this.fixtures.get(this.key(x, y)), step.action);
                this.spend(p);
            }
            return done;
        },
        
        /*  Fixture f has action name done to it (see actions): its state is what the action
            sets. */
        actOnFixture: function(f, name) {
            f.state = this.actedState(f, this.fixtureType(f).actions[name]);
            this._sightKey = null; // it may block sight differently now
        },
        
        /*  What piece p stepping into (x, y) does to the fixture there, if it's one that's
            in the way (one you know of, for a piece of yours), with an onStep action:
            {action}, the name of the first of those it can do now (see fixtureActions), or
            null if it can't do any (it doesn't step, or attack, either: a barred door, say);
            undefined if there's no such fixture there. */
        stepAction: function(p, x, y) {
            const f = p.owner === 'player' ? this.fixtureAt(x, y) : this.fixtures.get(this.key(x, y)),
                onStep = f && this.fixtureBlocks(x, y) ? Object.entries(this.fixtureType(f).actions).filter(([, a]) => a.onStep).map(([name]) => name) : [];
            let retval;
            if (onStep.length) {
                const name = this.fixtureActions(p, f).find(n => onStep.includes(n));
                retval = name ? {action:name} : null;
            }
            return retval;
        },
        
        /*  Reveals the fixtures your pieces now find (revealMode), and shows the magnitudes
            they now see (showMagnitude). After your pieces move. */
        revealFixtures: function() {
            const sight = this.cellsInSight(),
                players = this.piecesOf('player'),
                finds = (f, {mode, range}) => mode === 'instant'
                    ? !sight || sight.has(this.key(f.x, f.y))
                    : mode === 'proximity' && players.some(p => hexDist(p, f) <= range);
            for (const f of this.fixtures.values()) {
                const kind = this.fixtureType(f),
                    // One in the way shows once it's in sight, whatever its kind says.
                    reveal = this.fixtureBlocks(f.x, f.y) ? {mode:'instant', range:0} : kind.reveal;
                if (f.revealedAt == null && finds(f, reveal)) f.revealedAt = this.turn;
                if (f.revealedAt != null && !f.shown && finds(f, kind.showMagnitude)) f.shown = true;
            }
        },
        
        /*  Your pieces that just moved set off the fixtures they're on: harms first, then
            heals, then loot. */
        landOnFixtures: function(pieces) {
            for (const type of [FIXTURE_HARM, FIXTURE_HEAL, FIXTURE_LOOT]) {
                for (const g of pieces) {
                    const f = g.owner === 'player' && this.pieces.has(g.id) ? this.fixtures.get(this.key(g.x, g.y)) : null;
                    if (f?.type === type && !this.over) this.useFixture(f, g);
                }
            }
        },
        
        /*  One of your pieces, by, has entered fixture t: it's revealed (with its
            magnitude), and gives each piece in its area, nearest first, its magnitude (less
            with fade), as long as its pool lasts (a heal gives only what's needed and keeps
            the rest). Then it's gone if its pool is empty or it's used up; a heal nobody
            needed isn't used at all. An enemy a harm hurts was hurt by by (see
            Game.damage), so it's by's kill if it dies of it. */
        useFixture: function(t, by) {
            const type = this.fixtureType(t),
                {radius, shape} = type.area,
                inArea = p => shape === 'ring' ? hexDist(p, t) === radius : hexDist(p, t) <= radius,
                affects = p => (t.type === FIXTURE_HARM || p.owner === 'player') && inArea(p),
                hit = [...this.pieces.values()].filter(affects).sort((a, b) => hexDist(a, t) - hexDist(b, t) || a.id - b.id),
                {mode, n} = type.duration;
            t.revealedAt ??= this.turn;
            t.shown = true;
            let used = 0;
            for (const p of hit) {
                if (this.pieces.has(p.id) && t.pool !== 0 && !this.over) {
                    const full = t.magnitude ?? t.pool,
                        share = shape === 'fade' ? (radius + 1 - hexDist(p, t)) / (radius + 1) : 1,
                        amount = Math.min(Math.round(full * share), t.pool ?? Infinity);
                    if (amount > 0) {
                        const n = this.fixtureEffect(t, p, amount, by);
                        if (t.pool != null) t.pool -= n;
                        used += n;
                    }
                }
            }
            if (used > 0 || t.type !== FIXTURE_HEAL) t.uses++;
            if (t.pool === 0 || (mode === 'once' && t.uses > 0) || (mode === 'count' && t.uses >= n)) {
                this.removeFixture(t);
                if (t.type === FIXTURE_HARM) this.fx(t.x, t.y, '', '--harm', {vanish:true});
                if (t.type === FIXTURE_LOOT) this.lootOpened++;
            }
        },
        
        // What fixture t, set off by piece by, does to piece p, amount times. Returns how
        // much of it was used (all of it but for a heal: what it healed).
        fixtureEffect: function(t, p, amount, by) {
            let used = amount;
            if (t.type === FIXTURE_HEAL) {
                used = this.applyHeal(p, amount);
            } else if (t.type === FIXTURE_HARM) {
                this.logCombat({kind:'harm', d:this.whoOf(p), dmg:amount});
                this.damage(p, amount, null, by);
            } else {
                this.gold += amount;
                this.lootTaken += amount;
                this.fx(p.x, p.y, `+${amount} gold`, '--loot', {});
            }
            return used;
        },
        
        /*  At the end of a turn: fixtures whose countdown (from when they were revealed) has
            run out are gone. */
        tickFixtures: function() {
            for (const t of [...this.fixtures.values()]) {
                if (t.revealedAt != null) {
                    const {mode, n} = this.fixtureType(t).duration;
                    if (mode === 'countdown' && this.turn - t.revealedAt >= n) {
                        this.removeFixture(t);
                        this.fx(t.x, t.y, '', '--' + t.type, {vanish:true});
                    }
                }
            }
        },
        
        /*  Turns left before a countdown fixture is gone, or null. */
        turnsLeft: function(t) {
            const {mode, n} = this.fixtureType(t).duration;
            return mode === 'countdown' && t.revealedAt != null ? Math.max(0, n - (this.turn - t.revealedAt)) : null;
        }
    });
})(hc);
