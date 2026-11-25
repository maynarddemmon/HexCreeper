/*  Fixtures: what sits on the ground of a cell and does something when one of your pieces
    enters it (heals, harms and loot for now). Their kinds, from data/init.json5's
    "fixtures" (see Subtypes.js), and how a game makes, reveals and uses them (a module
    included in Game).
    
    A cell has a tile (its terrain: open floor, or a solid or a hole: see Game.tiles) and
    at most one fixture over it (Game.fixtures, "x,y" -> fixture), only on a cell you can
    stand on. A fixture is plain data, saved with the game: {x, y, type, subtype, pool,
    magnitude, uses, revealedAt, shown} (see makeFixture).
    
    Every kind has a name, a description, a type ("heal", "harm" or "loot": what it does,
    which the rest of the game goes by, e.g. pieces keep off harm) and (each optional but
    pool):
    - revealMode: when the tile shows: "instant" (the default: once its cell is in sight),
      "hidden" (once one of your pieces enters it) or {"proximity":n} (once one of your
      pieces comes within n cells). Once shown it stays shown.
    - pool: what it holds (HP to heal, damage to do, score): n, {"min","max"} (rolled when
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
    
    Heals heal your pieces (what the piece doesn't need flows along its links, and what
    nobody needs becomes score); harms damage any piece; loot gives you score. Only your
    pieces set them off, by entering their cell: a step, being carried, a jump, a swap or
    being placed there. */
(pkg => {
    'use strict';
    
    const {Subtypes, hexDist} = pkg,
        {isInt} = Subtypes,
        
        // The types of fixture
        FIXTURE_HEAL = pkg.FIXTURE_HEAL = 'heal',
        FIXTURE_HARM = pkg.FIXTURE_HARM = 'harm',
        FIXTURE_LOOT = pkg.FIXTURE_LOOT = 'loot',
        FIXTURE_TYPES = pkg.FIXTURE_TYPES = [FIXTURE_HEAL, FIXTURE_HARM, FIXTURE_LOOT],
        
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
        
        // A kind's own properties: its type; pool and magnitude are {min, max}, or null for
        // an infinite pool or a magnitude of the whole pool (which needs a pool that isn't
        // infinite).
        parseFixture = e => {
            const infinite = e.pool === 'infinite',
                wholePool = e.magnitude === undefined || e.magnitude === 'pool',
                own = {
                    type:e.type,
                    reveal:parseShow(e.revealMode),
                    pool:infinite ? null : parseRange(e.pool),
                    magnitude:wholePool ? null : parseRange(e.magnitude),
                    showMagnitude:parseShow(e.showMagnitude),
                    showPool:e.showPool ?? false,
                    area:parseArea(e.area),
                    duration:parseDuration(e.duration)
                },
                ok = FIXTURE_TYPES.includes(own.type) && own.reveal && (infinite || own.pool) && (wholePool ? !infinite : own.magnitude) && own.showMagnitude &&
                    typeof own.showPool === 'boolean' && own.area && own.duration;
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
            type, subtype, pool, magnitude, uses, revealedAt, shown}. pool: what's left, or
            null if infinite; magnitude: what it gives, or null for all that's left;
            revealedAt: the turn it was revealed, or null; shown: whether its magnitude
            shows. */
        makeFixture: function(x, y, subtype, rng=Math.random, type=FIXTURE_LOOT) {
            const kind = pkg.fixtures.get(subtype) ?? {...FALLBACK, type},
                roll = r => r ? r.min + Math.floor(rng() * (r.max - r.min + 1)) : null;
            return {x, y, type:kind.type, subtype, pool:roll(kind.pool), magnitude:roll(kind.magnitude), uses:0, revealedAt:null, shown:false};
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
                const kind = this.fixtureType(f);
                if (f.revealedAt == null && finds(f, kind.reveal)) f.revealedAt = this.turn;
                if (f.revealedAt != null && !f.shown && finds(f, kind.showMagnitude)) f.shown = true;
            }
        },
        
        /*  Your pieces that just moved set off the fixtures they're on: harms first, then
            heals, then loot. */
        landOnFixtures: function(pieces) {
            for (const type of [FIXTURE_HARM, FIXTURE_HEAL, FIXTURE_LOOT]) {
                for (const g of pieces) {
                    const f = g.owner === 'player' && this.pieces.has(g.id) ? this.fixtures.get(this.key(g.x, g.y)) : null;
                    if (f?.type === type && !this.over) this.useFixture(f);
                }
            }
        },
        
        /*  One of your pieces has entered fixture t: it's revealed (with its magnitude), and
            gives each piece in its area, nearest first, its magnitude (less with fade), as
            long as its pool lasts. Then it's gone if its pool is empty or it's used up. */
        useFixture: function(t) {
            const type = this.fixtureType(t),
                {radius, shape} = type.area,
                inArea = p => shape === 'ring' ? hexDist(p, t) === radius : hexDist(p, t) <= radius,
                affects = p => (t.type === FIXTURE_HARM || p.owner === 'player') && inArea(p),
                hit = [...this.pieces.values()].filter(affects).sort((a, b) => hexDist(a, t) - hexDist(b, t) || a.id - b.id),
                {mode, n} = type.duration;
            t.revealedAt ??= this.turn;
            t.shown = true;
            for (const p of hit) {
                if (this.pieces.has(p.id) && t.pool !== 0 && !this.over) {
                    const full = t.magnitude ?? t.pool,
                        share = shape === 'fade' ? (radius + 1 - hexDist(p, t)) / (radius + 1) : 1,
                        amount = Math.min(Math.round(full * share), t.pool ?? Infinity);
                    if (amount > 0) {
                        if (t.pool != null) t.pool -= amount;
                        this.fixtureEffect(t, p, amount);
                    }
                }
            }
            t.uses++;
            if (t.pool === 0 || mode === 'once' || (mode === 'count' && t.uses >= n)) {
                this.fixtures.delete(this.key(t.x, t.y));
                if (t.type === FIXTURE_HARM) this.fx(t.x, t.y, '', '--harm', {vanish:true});
                if (t.type === FIXTURE_LOOT) this.lootOpened++;
            }
        },
        
        // What fixture t does to piece p, amount times.
        fixtureEffect: function(t, p, amount) {
            if (t.type === FIXTURE_HEAL) {
                this.applyHeal(p, amount, true);
            } else if (t.type === FIXTURE_HARM) {
                this.logCombat({kind:'harm', d:this.whoOf(p), dmg:amount});
                this.damage(p, amount, null);
            } else {
                p.score += amount;
                this.earn(amount);
                this.lootTaken += amount;
                this.fx(p.x, p.y, `+${amount}`, '--loot', {});
            }
        },
        
        /*  At the end of a turn: fixtures whose countdown (from when they were revealed) has
            run out are gone. */
        tickFixtures: function() {
            for (const t of [...this.fixtures.values()]) {
                if (t.revealedAt != null) {
                    const {mode, n} = this.fixtureType(t).duration;
                    if (mode === 'countdown' && this.turn - t.revealedAt >= n) {
                        this.fixtures.delete(this.key(t.x, t.y));
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
