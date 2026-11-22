/*  The "caverns" tile generator: a network of caverns joined by tunnels, in solid rock.
    
    Caverns sit at sites on a hidden lattice (spacing from cavernSizeMax), each moved a
    little at random, of cavernSizeMin to cavernSizeMax cells, and irregular: the radius
    wobbles with the angle. Site (0, 0)'s cavern is centred on the start cell. Every
    cavern has a tunnel to a neighbouring one nearer the start, so they're all joined,
    and more tunnels join neighbours at random (loops). A tunnel runs from centre to
    centre, wandering to the side (tangle) and varying in width (tunnelWidthMin to
    tunnelWidthMax) as it goes. Everything else is rock (rockSolid).
    
    In the caverns, off the paths the tunnels take through them (so nothing cuts a cavern
    off), there are stalagmites and stalactites, and small clumps of holes (holeTable).
    Heal, harm and loot tiles (their tables) are on any open cell but the start. The
    frequencies are tiles per 1000 open cells.
    
    Cells are made as your pieces go, out to where they could see, a block at a time (the
    blocks are just bookkeeping: there are no quadrants). Everything comes from the game's
    seed (Game.rngFor), so a cell comes out the same whatever order it's made in. */
(pkg => {
    'use strict';
    
    const {
        attrs:{num, choice, table, pick},
        TileGenerator:{optionsOf},
        hex, hexDist,
        TILE_TYPE_SOLID, TILE_TYPE_HOLE, TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_LOOT
    } = pkg,
        
        {sqrt, sin, cos, atan2, hypot, ceil, floor, max, PI} = Math,
        TAU = 2 * PI,
        
        CELL_AREA = sqrt(3) / 2, // a cell's area in world units (1 across, flat to flat)
        BLOCK_RADIUS = 4,        // the blocks cells are made in (see makeChunks)
        JITTER = 0.12,           // how far a site moves, as a fraction of the spacing
        MIN_GAP = 4,             // the least rock between two caverns, before tunnels
        // A cavern's radius wobbles with the angle: harmonics [n, the most amplitude].
        WOBBLE = [[2, 0.12], [3, 0.1], [5, 0.06]],
        WOBBLE_MAX = WOBBLE.reduce((sum, [, amp]) => sum + amp, 0),
        SPINE_RADIUS = 0.75,     // how near a tunnel's path a cell is kept clear
        
        // Adds the keys of the cells whose centres are within r of world point (px, py).
        sweep = (px, py, r, keys) => {
            const c = hex.cellAtWorld(px, py);
            for (const q of hex.disk(c.x, c.y, ceil(r) + 1)) {
                const [cx, cy] = hex.center(q.x, q.y);
                if (hypot(cx - px, cy - py) <= r) keys.add(q.x + ',' + q.y);
            }
        };
    
    pkg.CavernsTileGenerator = new JS.Class('CavernsTileGenerator', pkg.TileGenerator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[
                num('cavernSizeMin', 60, 20, 600),     // a cavern's area, in cells
                num('cavernSizeMax', 200, 20, 600),
                num('tunnelWidthMin', 2, 1, 6),        // a tunnel's width, in cells
                num('tunnelWidthMax', 3, 1, 8),
                num('tangle', 40, 0, 100),             // how much tunnels wind (0: straight)
                num('loops', 30, 0, 100),              // % chance two neighbouring caverns get another tunnel
                
                // Tiles per 1000 open cells: in caverns, off the tunnels' paths...
                num('stalagmiteFrequency', 30, 0, 100),
                num('stalactiteFrequency', 20, 0, 100),
                num('holeFrequency', 15, 0, 100),      // clumps of 1 to 3 holes
                // ...and anywhere open.
                num('healFrequency', 4, 0, 100),
                num('harmFrequency', 4, 0, 100),
                num('lootFrequency', 2, 0, 100),
                
                // Which subtypes, by weight (data/init.json5; see EffectTiles.js).
                table('holeTable', {pit:6, chasm:3, sinkhole:1}, optionsOf(pkg.holes)),
                table('healTable', {heal:1}, optionsOf(pkg.heals)),
                table('harmTable', {harm:1}, optionsOf(pkg.harms)),
                table('lootTable', {loot:1}, optionsOf(pkg.loots)),
                choice('rockSolid', 'cave_rock', optionsOf(pkg.solids)),
                choice('stalagmiteSolid', 'stalagmite', optionsOf(pkg.solids)),
                choice('stalactiteSolid', 'stalactite', optionsOf(pkg.solids))
            ],
            
            // The key of the tunnel between two sites ("i,j" keys), the same either way
            // round.
            tunnelKey: (a, b) => a < b ? a + '|' + b : b + '|' + a
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.callSuper(game, attrs);
            // Keep the ranges the right way round.
            const a = this.attrs;
            a.cavernSizeMax = max(a.cavernSizeMin, a.cavernSizeMax);
            a.tunnelWidthMax = max(a.tunnelWidthMin, a.tunnelWidthMax);
            
            // Sites far enough apart that no two caverns touch, however they're moved.
            const radius = sqrt(a.cavernSizeMax * CELL_AREA / PI) * (1 + WOBBLE_MAX);
            this.spacing = ceil((2 * radius + MIN_GAP) / (1 - 2 * JITTER));
            this.blocks = pkg.makeChunks(BLOCK_RADIUS);
            this.madeBlocks = new Set(); // keys of the blocks whose cells have been made
            
            // What's worked out from the seed, kept since it's asked for again and again.
            this.sites = new Map();      // site key -> {i, j, key, wx, wy, radius, wobble}
            this.caverns = new Map();    // site key -> the keys of its cavern's cells
            this.tunnels = new Map();    // tunnel key -> {cells, spine}: the keys of its cells and of those kept clear
        },
        
        // Methods /////////////////////////////////////////////////////////////
        start: function() {this.piecesMoved();},
        
        exportState: function() {
            return {madeBlocks:[...this.madeBlocks]};
        },
        importState: function(state) {
            if (!Array.isArray(state?.madeBlocks)) throw new Error('Malformed tile generator state');
            this.madeBlocks = new Set(state.madeBlocks);
        },
        
        // Makes the blocks within reach of your pieces: every cell they could see.
        piecesMoved: function() {
            const k = BLOCK_RADIUS,
                // Neighbouring blocks' centres are at least (3k + 2) / 2 steps apart.
                reach = ceil(2 * (this.game.rules.visionRadius + 2 * k) / (3 * k + 2));
            for (const p of this.game.piecesOf('player')) {
                const [bi, bj] = this.blocks.of(p.x, p.y);
                for (const b of hex.disk(bi, bj, reach)) this.makeBlock(b.x, b.y);
            }
        },
        
        // ---- The layout ----
        
        // The site [i, j] cell (x, y) is nearest, before sites are moved.
        siteOf: function(x, y) {
            const [wx, wy] = hex.center(x, y),
                c = hex.cellAtWorld(wx / this.spacing, wy / this.spacing);
            return [c.x, c.y];
        },
        
        // Site (i, j), as the seed makes it: where its cavern's centre is (in world units)
        // and how big and what shape it is.
        site: function(i, j) {
            const key = i + ',' + j;
            if (!this.sites.has(key)) {
                const a = this.attrs,
                    rng = this.game.rngFor('cave-site', key),
                    [nx, ny] = hex.center(i * this.spacing, j * this.spacing),
                    angle = rng() * TAU,
                    // The start cavern isn't moved, so it's centred on the start cell.
                    shift = i === 0 && j === 0 ? 0 : rng() * JITTER * this.spacing,
                    area = a.cavernSizeMin + rng() * (a.cavernSizeMax - a.cavernSizeMin);
                this.sites.set(key, {
                    i, j, key,
                    wx:nx + shift * cos(angle),
                    wy:ny + shift * sin(angle),
                    radius:sqrt(area * CELL_AREA / PI),
                    wobble:WOBBLE.map(([n, amp]) => [n, amp * rng(), rng() * TAU])
                });
            }
            return this.sites.get(key);
        },
        
        // The keys of the cells in site (i, j)'s cavern.
        cavern: function(i, j) {
            const s = this.site(i, j);
            if (!this.caverns.has(s.key)) {
                const keys = new Set(),
                    c = hex.cellAtWorld(s.wx, s.wy);
                for (const q of hex.disk(c.x, c.y, ceil(s.radius * (1 + WOBBLE_MAX)) + 1)) {
                    const [wx, wy] = hex.center(q.x, q.y),
                        dx = wx - s.wx,
                        dy = wy - s.wy,
                        angle = atan2(dy, dx),
                        r = s.radius * (1 + s.wobble.reduce((sum, [n, amp, phase]) => sum + amp * cos(n * angle + phase), 0));
                    if (hypot(dx, dy) <= r) keys.add(q.x + ',' + q.y);
                }
                this.caverns.set(s.key, keys);
            }
            return this.caverns.get(s.key);
        },
        
        // The neighbouring site [i, j] that site (i, j)'s cavern has a tunnel to on the
        // way to the start, or null for the start's.
        parentOf: function(i, j) {
            if (i === 0 && j === 0) return null;
            const d = hexDist({x:i, y:j}, {x:0, y:0}),
                nearer = hex.dirs.map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => hexDist({x:a, y:b}, {x:0, y:0}) < d);
            return nearer[floor(this.game.rngFor('cave-parent', i + ',' + j)() * nearer.length)];
        },
        
        // Whether neighbouring sites a and b ([i, j]) have a tunnel between them.
        hasTunnel: function(a, b) {
            const same = (p, q) => p !== null && p[0] === q[0] && p[1] === q[1],
                tk = pkg.CavernsTileGenerator.tunnelKey(a.join(), b.join());
            return same(this.parentOf(...a), b) || same(this.parentOf(...b), a) ||
                this.game.rngFor('cave-loop', tk)() * 100 < this.attrs.loops;
        },
        
        // The tunnel with key tk: the keys of its cells, and of the cells along its path
        // kept clear (its spine). It runs from the centre of one cavern to the other's,
        // swinging to the side and varying in width.
        tunnel: function(tk) {
            if (!this.tunnels.has(tk)) {
                const [a, b] = tk.split('|').map(k => this.site(...k.split(',').map(Number))),
                    rng = this.game.rngFor('cave-tunnel', tk),
                    {tunnelWidthMin:w0, tunnelWidthMax:w1, tangle} = this.attrs,
                    dx = b.wx - a.wx,
                    dy = b.wy - a.wy,
                    length = hypot(dx, dy),
                    nx = -dy / length,
                    ny = dx / length,
                    swing = tangle / 100 * 0.3 * length,      // the most it swings to the side
                    f1 = 0.5 + tangle / 100 * 1.5 + rng() * 0.5, // waves along its length
                    f2 = f1 * (2 + rng()),
                    p1 = rng() * TAU,
                    p2 = rng() * TAU,
                    fw = 0.5 + rng() * 1.5,                   // and its width's
                    pw = rng() * TAU,
                    cells = new Set(),
                    spine = new Set(),
                    steps = ceil(length * 4);
                for (let n = 0; n <= steps; n++) {
                    const t = n / steps,
                        // No swing at the ends, which are the caverns' centres.
                        side = swing * sin(PI * t) * (sin(TAU * f1 * t + p1) + 0.5 * sin(TAU * f2 * t + p2)) / 1.5,
                        px = a.wx + dx * t + nx * side,
                        py = a.wy + dy * t + ny * side,
                        width = w0 + (w1 - w0) * (0.5 + 0.5 * sin(TAU * fw * t + pw));
                    sweep(px, py, max(0.55, width / 2), cells);
                    sweep(px, py, SPINE_RADIUS, spine);
                }
                this.tunnels.set(tk, {cells, spine});
            }
            return this.tunnels.get(tk);
        },
        
        // The caverns and tunnels that may reach block (bi, bj): {caverns, tunnels}, the
        // keys of their cells (and the tunnels' spines). Sites more than 2 apart on the
        // lattice are too far for theirs to.
        near: function(bi, bj) {
            const c = this.blocks.center(bi, bj),
                sites = hex.disk(...this.siteOf(c.x, c.y), 2).map(q => [q.x, q.y]),
                inRange = new Set(sites.map(q => q.join())),
                tunnelKeys = new Set();
            for (const q of sites) {
                for (const [di, dj] of hex.dirs) {
                    const n = [q[0] + di, q[1] + dj];
                    if (inRange.has(n.join()) && this.hasTunnel(q, n)) tunnelKeys.add(pkg.CavernsTileGenerator.tunnelKey(q.join(), n.join()));
                }
            }
            return {
                caverns:sites.map(q => this.cavern(...q)),
                tunnels:[...tunnelKeys].map(tk => this.tunnel(tk))
            };
        },
        
        // ---- Making cells ----
        
        // What cell (x, y) is, given what's near it (see near): {open, cavern, clear}. Open
        // cells are in a cavern or a tunnel; clear ones (the tunnels' spines, and the start
        // cell and its neighbours) are kept free of stalagmites, stalactites and holes.
        cellOf: function(x, y, near) {
            const k = x + ',' + y,
                cavern = near.caverns.some(keys => keys.has(k));
            return {
                open:cavern || near.tunnels.some(t => t.cells.has(k)),
                cavern,
                clear:hexDist({x, y}, {x:0, y:0}) <= 1 || near.tunnels.some(t => t.spine.has(k))
            };
        },
        
        // Whether cell (x, y) can have a stalagmite, stalactite or hole: it's in a cavern
        // and not kept clear.
        isCavernFloor: function(x, y, near) {
            const c = this.cellOf(x, y, near);
            return c.cavern && !c.clear;
        },
        
        // What the seed puts on cavern floor cell (x, y) by itself: {solid:subtype},
        // {holes:[cell keys], subtype} (a clump of holes starting there: it and 0 to 2 of its
        // neighbours), or null.
        featureOf: function(x, y) {
            const a = this.attrs,
                rng = this.game.rngFor('cave-feature', x + ',' + y),
                roll = rng() * 1000;
            let retval = null;
            if (roll < a.stalagmiteFrequency) {
                retval = {solid:a.stalagmiteSolid};
            } else if (roll < a.stalagmiteFrequency + a.stalactiteFrequency) {
                retval = {solid:a.stalactiteSolid};
            } else if (roll < a.stalagmiteFrequency + a.stalactiteFrequency + a.holeFrequency) {
                const subtype = pick(a.holeTable, rng),
                    holes = [x + ',' + y];
                for (let n = floor(rng() * 3); n > 0; n--) {
                    const [dx, dy] = hex.dirs[floor(rng() * 6)];
                    holes.push((x + dx) + ',' + (y + dy));
                }
                if (subtype !== undefined) retval = {holes, subtype};
            }
            return retval;
        },
        
        // The tile cell (x, y) gets, as [kind, subtype], or null for none.
        tileOf: function(x, y, near) {
            const a = this.attrs,
                c = this.cellOf(x, y, near);
            let retval = null;
            if (!c.open) {
                retval = [TILE_TYPE_SOLID, a.rockSolid];
            } else {
                if (c.cavern && !c.clear) {
                    // Its own stalagmite or stalactite, or a hole from a clump starting there
                    // or next to it.
                    const k = x + ',' + y,
                        own = this.featureOf(x, y);
                    if (own?.solid) {
                        retval = [TILE_TYPE_SOLID, own.solid];
                    } else {
                        for (const [dx, dy] of [[0, 0], ...hex.dirs]) {
                            if (!retval && (dx === 0 && dy === 0 || this.isCavernFloor(x + dx, y + dy, near))) {
                                const f = dx === 0 && dy === 0 ? own : this.featureOf(x + dx, y + dy);
                                if (f?.holes?.includes(k)) retval = [TILE_TYPE_HOLE, f.subtype];
                            }
                        }
                    }
                }
                if (!retval && (x !== 0 || y !== 0)) {
                    const rng = this.game.rngFor('cave-item', x + ',' + y),
                        roll = rng() * 1000,
                        kind = roll < a.healFrequency ? TILE_TYPE_HEAL :
                            roll < a.healFrequency + a.harmFrequency ? TILE_TYPE_HARM :
                            roll < a.healFrequency + a.harmFrequency + a.lootFrequency ? TILE_TYPE_LOOT : null,
                        subtype = kind ? pick(a[kind + 'Table'], rng) : undefined;
                    if (subtype !== undefined) retval = [kind, subtype];
                }
            }
            return retval;
        },
        
        // Makes block (bi, bj)'s cells, once. Cells with a tile or a piece already are left
        // as they are.
        makeBlock: function(bi, bj) {
            const bk = bi + ',' + bj;
            if (!this.madeBlocks.has(bk)) {
                this.madeBlocks.add(bk);
                const game = this.game,
                    near = this.near(bi, bj);
                for (const {x, y} of this.blocks.cells(bi, bj)) {
                    const k = game.key(x, y);
                    if (!game.tiles.has(k) && !game.pieceAt(x, y)) {
                        const tile = this.tileOf(x, y, near);
                        if (tile) game.tiles.set(k, game.makeTile(x, y, ...tile, game.rngFor('rolls', k)));
                    }
                }
            }
        }
    });
    pkg.TileGenerator.register('caverns', pkg.CavernsTileGenerator);
})(hc);
