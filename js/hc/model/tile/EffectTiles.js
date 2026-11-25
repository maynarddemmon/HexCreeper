/*  Heal, harm and loot tiles: their subtypes, from data/init.json5 (see Subtypes.js), and
    how a game makes, reveals and uses them (a module included in Game).
    
    Every subtype has a name, a description, and (each optional but pool):
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
    
    Heal tiles heal your pieces (what the piece doesn't need flows along its links, and
    what nobody needs becomes score); harm tiles damage any piece; loot tiles give you
    score. Only your pieces set them off, by entering their cell: a step, being carried,
    a jump, a swap or being placed there. */
(pkg => {
    'use strict';
    
    const {
        Subtypes,
        TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_LOOT,
        hexDist
    } = pkg,
        {isInt} = Subtypes,
        
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
        
        // A subtype's own properties: pool and magnitude are {min, max}, or null for an
        // infinite pool or a magnitude of the whole pool (which needs a pool that isn't
        // infinite).
        parseEffect = e => {
            const infinite = e.pool === 'infinite',
                wholePool = e.magnitude === undefined || e.magnitude === 'pool',
                own = {
                    reveal:parseShow(e.revealMode),
                    pool:infinite ? null : parseRange(e.pool),
                    magnitude:wholePool ? null : parseRange(e.magnitude),
                    showMagnitude:parseShow(e.showMagnitude),
                    showPool:e.showPool ?? false,
                    area:parseArea(e.area),
                    duration:parseDuration(e.duration)
                },
                ok = own.reveal && (infinite || own.pool) && (wholePool ? !infinite : own.magnitude) && own.showMagnitude &&
                    typeof own.showPool === 'boolean' && own.area && own.duration;
            return ok ? own : null;
        },
        
        // A tile of a subtype that isn't known: shown at once, 1 of whatever it does, then gone.
        FALLBACK = parseEffect({pool:1});
    
    pkg.heals = new Subtypes(TILE_TYPE_HEAL, parseEffect);
    pkg.harms = new Subtypes(TILE_TYPE_HARM, parseEffect);
    pkg.loots = new Subtypes(TILE_TYPE_LOOT, parseEffect);
    
    // The subtypes of each kind of tile here.
    const TYPES = {[TILE_TYPE_HEAL]:pkg.heals, [TILE_TYPE_HARM]:pkg.harms, [TILE_TYPE_LOOT]:pkg.loots};
    
    pkg.EffectTiles = new JS.Module('EffectTiles', {
        // Whether the tile is a heal, harm or loot tile.
        isEffectTile: function(t) {return !!TYPES[t?.kind];},
        
        // Its subtype (with FALLBACK's properties if that isn't known).
        tileType: function(t) {return TYPES[t.kind].get(t.subtype) ?? {name:t.kind, description:'', ...FALLBACK};},
        
        // Whether the player knows the tile is there: any tile but an effect tile not yet
        // revealed.
        isRevealed: function(t) {return !this.isEffectTile(t) || t.revealedAt != null;},
        
        /*  A new tile of the subtype, with its pool and magnitude rolled (by rng), not yet
            revealed: {x, y, kind, subtype, pool, magnitude, uses, revealedAt, shown}. pool:
            what's left, or null if infinite; magnitude: what it gives, or null for all
            that's left; revealedAt: the turn it was revealed, or null; shown: whether its
            magnitude shows. */
        makeEffectTile: function(x, y, kind, subtype, rng) {
            const type = TYPES[kind].get(subtype) ?? FALLBACK,
                roll = r => r ? r.min + Math.floor(rng() * (r.max - r.min + 1)) : null;
            return {x, y, kind, subtype, pool:roll(type.pool), magnitude:roll(type.magnitude), uses:0, revealedAt:null, shown:false};
        },
        
        /*  Reveals the tiles your pieces now find (revealMode), and shows the magnitudes
            they now see (showMagnitude). After your pieces move. */
        revealTiles: function() {
            const sight = this.cellsInSight(),
                players = this.piecesOf('player'),
                finds = (t, {mode, range}) => mode === 'instant'
                    ? !sight || sight.has(this.key(t.x, t.y))
                    : mode === 'proximity' && players.some(p => hexDist(p, t) <= range);
            for (const t of this.tiles.values()) {
                if (this.isEffectTile(t)) {
                    const type = this.tileType(t);
                    if (t.revealedAt == null && finds(t, type.reveal)) t.revealedAt = this.turn;
                    if (t.revealedAt != null && !t.shown && finds(t, type.showMagnitude)) t.shown = true;
                }
            }
        },
        
        /*  Your pieces that just moved set off the tiles they're on: harm first, then heal,
            then loot. */
        landOnTiles: function(pieces) {
            for (const kind of [TILE_TYPE_HARM, TILE_TYPE_HEAL, TILE_TYPE_LOOT]) {
                for (const g of pieces) {
                    const t = g.owner === 'player' && this.pieces.has(g.id) ? this.tiles.get(this.key(g.x, g.y)) : null;
                    if (t?.kind === kind && !this.over) this.useTile(t);
                }
            }
        },
        
        /*  One of your pieces has entered tile t: it's revealed (with its magnitude), and
            gives each piece in its area, nearest first, its magnitude (less with fade), as
            long as its pool lasts. Then it's gone if its pool is empty or it's used up. */
        useTile: function(t) {
            const type = this.tileType(t),
                {radius, shape} = type.area,
                inArea = p => shape === 'ring' ? hexDist(p, t) === radius : hexDist(p, t) <= radius,
                affects = p => (t.kind === TILE_TYPE_HARM || p.owner === 'player') && inArea(p),
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
                        this.tileEffect(t, p, amount);
                    }
                }
            }
            t.uses++;
            if (t.pool === 0 || mode === 'once' || (mode === 'count' && t.uses >= n)) {
                this.tiles.delete(this.key(t.x, t.y));
                if (t.kind === TILE_TYPE_HARM) this.fx(t.x, t.y, '', '--harm', {vanish:true});
                if (t.kind === TILE_TYPE_LOOT) this.lootOpened++;
            }
        },
        
        // What tile t does to piece p, amount times.
        tileEffect: function(t, p, amount) {
            if (t.kind === TILE_TYPE_HEAL) {
                this.applyHeal(p, amount, true);
            } else if (t.kind === TILE_TYPE_HARM) {
                this.logCombat({kind:'harm', d:this.whoOf(p), dmg:amount});
                this.damage(p, amount, null);
            } else {
                p.score += amount;
                this.earn(amount);
                this.lootTaken += amount;
                this.fx(p.x, p.y, `+${amount}`, '--loot', {});
            }
        },
        
        /*  At the end of a turn: tiles whose countdown (from when they were revealed) has
            run out are gone. */
        tickTiles: function() {
            for (const t of [...this.tiles.values()]) {
                if (this.isEffectTile(t) && t.revealedAt != null) {
                    const {mode, n} = this.tileType(t).duration;
                    if (mode === 'countdown' && this.turn - t.revealedAt >= n) {
                        this.tiles.delete(this.key(t.x, t.y));
                        this.fx(t.x, t.y, '', '--' + t.kind, {vanish:true});
                    }
                }
            }
        },
        
        /*  Turns left before a countdown tile is gone, or null. */
        turnsLeft: function(t) {
            const {mode, n} = this.tileType(t).duration;
            return mode === 'countdown' && t.revealedAt != null ? Math.max(0, n - (this.turn - t.revealedAt)) : null;
        }
    });
})(hc);
