/*  The "caverns" tile generator: a network of caverns joined by tunnels, in solid rock.
    
    Caverns sit at sites on a hidden lattice (spacing from cavernSizeMax), each moved a
    little at random, of cavernSizeMin to cavernSizeMax cells, and irregular: the radius
    wobbles with the angle. Site (0, 0)'s cavern is centred on the start cell. Some sites
    are junctions instead (junctionChance): no cavern, just a point where their tunnels
    meet, so one tunnel leads on into another, or forks.
    
    Every site but the start's has a tunnel to a neighbouring site nearer the start, so
    they're all joined, and more tunnels join neighbours at random (loops). A site may be
    a dead end, with no other tunnels (by its kind's dead end schema and factor), but
    only if no other site needs it on its way to the start (see isDeadEnd). A junction that's a dead end
    is a tunnel ending in rock, in one of several ways (deadEndTable). A cavern may
    also have a tunnel that leaves it and comes back (cavernLoopChance), and neighbouring
    caverns may be joined directly (cavernJoinChance) rather than by a tunnel.
    
    A tunnel runs from centre to centre, wandering to the side (tangle) and varying in
    width (tunnelWidthMin to tunnelWidthMax) as it goes. Everything else is rock
    (rockSolid).
    
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
        TILE_TYPE_SOLID, TILE_TYPE_HOLE, TILE_TYPE_FLOOR, FIXTURE_HEAL, FIXTURE_HARM, FIXTURE_LOOT, fixtureOptions
    } = pkg,
        
        {sqrt, sin, cos, atan2, hypot, ceil, floor, max, PI} = Math,
        TAU = 2 * PI,
        
        CELL_AREA = sqrt(3) / 2, // a cell's area in world units (1 across, flat to flat)
        BLOCK_RADIUS = 4,        // the blocks cells are made in (see makeChunks)
        JITTER = 0.12,           // how far a site moves, as a fraction of the spacing
        JUNCTION_JITTER = 0.3,   // a junction's (it has no cavern to keep apart)
        JOIN_SHIFT = 0.3,        // the most a cavern moves toward those it's joined to
        JOIN_GAP = 2,            // the most rock left between two caverns for them to be joined
        MIN_GAP = 4,             // the least rock between two caverns, before tunnels (without crowding)
        // A cavern's radius wobbles with the angle: harmonics [n, the most amplitude].
        WOBBLE = [[2, 0.12], [3, 0.1], [5, 0.06]],
        WOBBLE_MAX = WOBBLE.reduce((sum, [, amp]) => sum + amp, 0),
        SPINE_RADIUS = 0.75,     // how near a tunnel's path a cell is kept clear
        // The least a tunnel's cells reach either side of its path. Every point is within
        // 1 / sqrt(3) (0.577) of a cell's centre, so no thinner tunnel can have a gap.
        MIN_REACH = 0.6,
        MAX_STEP = 0.25,         // the farthest apart the points along a tunnel's path are
        DEAD_END_SCHEMAS = () => ['random', 'adaptive'].map(value => ({value, label:value})),
        // How a dead-end tunnel ends (see deadEndShape), and the farthest its shape reaches
        // from where it ends (world units).
        DEAD_END_KINDS = () => ['simple', 'lasso', 'fork', 'knot'].map(value => ({value, label:value})),
        DEAD_END_REACH = 16,
        
        // The points of a walk from (x, y), heading off at heading, for length (world
        // units), turning in two waves as tunnels do (more with tangle, 0 to 1): [[x, y]].
        wander = (rng, x, y, heading, length, tangle) => {
            const turn = 0.5 * sqrt(tangle),
                wave1 = 4 + rng() * 4,
                wave2 = 2 + rng() * 2,
                p1 = rng() * TAU,
                p2 = rng() * TAU,
                points = [[x, y]];
            for (let s = 0; s < length; s += MAX_STEP) {
                heading += turn * MAX_STEP * (sin(TAU * s / wave1 + p1) + 0.6 * sin(TAU * s / wave2 + p2));
                x += cos(heading) * MAX_STEP;
                y += sin(heading) * MAX_STEP;
                points.push([x, y]);
            }
            return points;
        },
        
        // The points of a loop through (x, y), going out the way heading points and coming
        // back: about radius across, its radius wobbling with the angle, more with tangle
        // (0 to 1). [[x, y]].
        loop = (rng, x, y, heading, radius, tangle) => {
            const wobble = WOBBLE.map(([n, amp]) => [n, amp * 2 * tangle * (0.5 + rng() / 2), rng() * TAU]),
                at = angle => radius * (1 + wobble.reduce((sum, [n, amp, phase]) => sum + amp * cos(n * angle + phase), 0)),
                // Its centre is ahead, so the point behind it is (x, y).
                back = heading + PI,
                cx = x - at(back) * cos(back),
                cy = y - at(back) * sin(back),
                steps = ceil(TAU * radius * 1.5 / MAX_STEP),
                points = [];
            for (let n = 0; n <= steps; n++) {
                const angle = back + TAU * n / steps;
                points.push([cx + at(angle) * cos(angle), cy + at(angle) * sin(angle)]);
            }
            return points;
        },
        
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
                // A network of limited size (see grow): open cells, or 0 for no limit.
                num('maxSize', 0, 0, 50000),           // The maximum number of non-solid cells in the map.
                num('growth', 100, 0, 100),            // % of maxSize grown when the game starts; the rest as you explore
                num('sprawl', 0, 0, 100),              // % chance it grows from its newest site (0: a round blob; 100: long and branching)
                
                num('cavernSizeMin', 60, 20, 2000),     // a cavern's minimum area, in cells
                num('cavernSizeMax', 200, 20, 2000),    // a cavern's maximum area, in cells
                num('tunnelWidthMin', 2, 1, 6),        // a tunnel's minimum width, in cells
                num('tunnelWidthMax', 3, 1, 9),        // a tunnel's maximum width, in cells
                num('tangle', 40, 0, 100),             // how much tunnels wind (0: straight)
                num('crowding', 0, 0, 100),            // how closely caverns are packed (0: never touching; 100: overlapping)
                
                num('loops', 30, 0, 100),              // % chance two neighbouring sites get another tunnel
                num('junctionChance', 20, 0, 100),     // % of sites (not the start's) that are junctions, with no cavern
                
                // Dead ends: sites with only one tunnel (see wantsDeadEnd). A junction that's
                // one is a tunnel that ends in rock, in a way from deadEndTable (see
                // deadEndShape).
                choice('cavernDeadEndSchema', 'random', DEAD_END_SCHEMAS),
                num('cavernDeadEndFactor', 33, 0, 100),
                choice('tunnelDeadEndSchema', 'random', DEAD_END_SCHEMAS),
                num('tunnelDeadEndFactor', 33, 0, 100),
                table('deadEndTable', {simple:2, lasso:1, fork:1, knot:1}, DEAD_END_KINDS),
                num('cavernLoopChance', 15, 0, 100),   // % chance a cavern has a tunnel that comes back into it
                num('cavernJoinChance', 15, 0, 100),   // % chance two caverns with a tunnel between them are joined directly instead
                num('collapseChance', 0, 0, 100),      // % chance a tunnel is blocked part way along by rubble (rubbleSolid)
                
                // Tiles per 1000 open cells: in caverns, off the tunnels' paths...
                num('stalagmiteFrequency', 30, 0, 100),
                num('stalactiteFrequency', 20, 0, 100),
                num('holeFrequency', 15, 0, 100),      // clumps of 1 to 3 holes
                // Patches of floor (floorTable) per 1000 cells, anywhere open (in caverns or
                // tunnels), each a round patch floorSizeMin to floorSizeMax cells across the
                // middle (radius 0 is one cell, 1 seven...), under stalagmites, stalactites
                // and holes.
                num('floorFrequency', 8, 0, 100),
                num('floorSizeMin', 0, 0, 3),
                num('floorSizeMax', 2, 0, 3),
                // ...and anywhere open.
                num('healFrequency', 4, 0, 100),
                num('harmFrequency', 4, 0, 100),
                num('lootFrequency', 2, 0, 100),
                
                // Which kinds, by weight (data/init.json5; heals, harms and loot are fixtures:
                // see Fixtures.js).
                table('holeTable', {pit:6, chasm:3, sinkhole:1}, optionsOf(pkg.holes)),
                table('floorTable', {loose_stone:2, mud:1}, optionsOf(pkg.floors)),
                choice('baseFloor', 'cave_floor', optionsOf(pkg.floors)), // what a cell with no tile is (see Game.baseFloor)
                table('healTable', {heal:1}, fixtureOptions(FIXTURE_HEAL)),
                table('harmTable', {harm:1}, fixtureOptions(FIXTURE_HARM)),
                table('lootTable', {loot:1}, fixtureOptions(FIXTURE_LOOT)),
                choice('rockSolid', 'cave_rock', optionsOf(pkg.solids)),
                choice('stalagmiteSolid', 'stalagmite', optionsOf(pkg.solids)),
                choice('stalactiteSolid', 'stalactite', optionsOf(pkg.solids)),
                choice('rubbleSolid', 'rubble', optionsOf(pkg.solids))
            ],
            
            // The key of the tunnel between two sites ("i,j" keys), the same either way
            // round.
            tunnelKey: (a, b) => a < b ? a + '|' + b : b + '|' + a,
            
            // The neighbours of site (i, j) nearer the start, and farther from it, as [i, j].
            nearerOf: (i, j) => {
                const d = hexDist({x:i, y:j}, {x:0, y:0});
                return hex.dirs.map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => hexDist({x:a, y:b}, {x:0, y:0}) < d);
            },
            fartherOf: (i, j) => {
                const d = hexDist({x:i, y:j}, {x:0, y:0});
                return hex.dirs.map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => hexDist({x:a, y:b}, {x:0, y:0}) > d);
            }
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.callSuper(game, attrs);
            // Keep the ranges the right way round.
            const a = this.attrs;
            a.cavernSizeMax = max(a.cavernSizeMin, a.cavernSizeMax);
            a.tunnelWidthMax = max(a.tunnelWidthMin, a.tunnelWidthMax);
            
            // Sites far enough apart that no two caverns touch, however they're moved, then
            // closer by crowding: at 100, 40% of that, so they overlap.
            const radius = sqrt(a.cavernSizeMax * CELL_AREA / PI) * (1 + WOBBLE_MAX);
            this.spacing = max(4, Math.round(ceil((2 * radius + MIN_GAP) / (1 - 2 * JITTER)) * (1 - 0.6 * a.crowding / 100)));
            // How far apart on the lattice a site can be from a block's and still reach it
            // (see near): 2, or more when caverns are big for the spacing.
            this.siteReach = max(2, ceil((max(radius, DEAD_END_REACH) + JUNCTION_JITTER * this.spacing + 2 * BLOCK_RADIUS) / (0.866 * this.spacing)));
            this.blocks = pkg.makeChunks(BLOCK_RADIUS);
            this.madeBlocks = new Set(); // keys of the blocks whose cells have been made
            this.floorPatches = new Map(); // "x,y" -> the patch of floor the seed starts there, or null (see floorPatchAt)
            
            // What's worked out from the seed, kept since it's asked for again and again.
            this.bases = new Map();       // site key -> {i, j, key, junction, wx, wy, radius, wobble} (see siteBase)
            this.sites = new Map();       // site key -> the same, moved (see site)
            this.deadEnds = new Map();    // site key -> whether it's a dead end
            this.caverns = new Map();     // site key -> the keys of its cavern's cells
            this.tunnels = new Map();     // tunnel key -> {cells, spine}: the keys of its cells and of those kept clear
            this.deadEndShapes = new Map(); // site key -> its dead end's shape, or null
            this.cavernLoops = new Map(); // site key -> its cavern loop, or null
            
            // With a maxSize, the network grown so far (see grow).
            this.network = a.maxSize > 0 ? {
                sites:new Map(),   // site key -> {parent:[i, j] or null, deadEnd}
                order:[],          // their keys, in the order they were added
                excluded:new Set(), // keys of the sites that will never be in it
                edges:new Set(),   // its tunnels' keys
                cells:new Set()    // the keys of its open cells
            } : null;
        },
        
        // Methods /////////////////////////////////////////////////////////////
        start: function() {
            const n = this.network;
            if (n) {
                this.addSite(0, 0, null);
                this.grow(this.attrs.maxSize * this.attrs.growth / 100, this.game.rngFor('cave-grow', 'start'));
            }
            this.piecesMoved();
        },
        
        exportState: function() {
            const n = this.network;
            return {
                madeBlocks:[...this.madeBlocks],
                network:n ? {
                    sites:n.order.map(key => {
                        const s = n.sites.get(key);
                        return [key, s.parent?.join() ?? null, s.deadEnd];
                    }),
                    excluded:[...n.excluded],
                    edges:[...n.edges]
                } : null
            };
        },
        importState: function(state) {
            const n = this.network,
                saved = state?.network;
            if (!Array.isArray(state?.madeBlocks) || (n && !(Array.isArray(saved?.sites) && Array.isArray(saved.excluded) && Array.isArray(saved.edges)))) {
                throw new Error('Malformed tile generator state');
            }
            this.madeBlocks = new Set(state.madeBlocks);
            if (n) {
                for (const [key, parent, deadEnd] of saved.sites) {
                    n.sites.set(key, {parent:parent === null ? null : parent.split(',').map(Number), deadEnd:!!deadEnd});
                    n.order.push(key);
                }
                saved.excluded.forEach(key => n.excluded.add(key));
                saved.edges.forEach(tk => n.edges.add(tk));
                for (const key of n.order) this.addCells(...key.split(',').map(Number));
            }
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
        
        // ---- A network of limited size ----
        // With a maxSize, the caverns are a network grown from the start's: each site
        // added is next to one already in it, joined to it by a tunnel (its parent), until
        // the network's open cells (its caverns, tunnels, dead ends and cavern loops) reach
        // maxSize (the last site may go over). Sites never added are rock. growth% of
        // maxSize is grown when the game starts, from the seed; the rest as your pieces
        // near the network's edge (see settleNear), so that part depends on where you go.
        // A site that would be a dead end (see wantsDeadEnd) is one if some other site can
        // still grow, and then nothing grows from it.
        
        // Whether site key is in the network, or never will be (always, without a maxSize).
        isSettled: function(key) {
            const n = this.network;
            return !n || n.sites.has(key) || n.excluded.has(key);
        },
        
        // Whether site (i, j) is in the network, or there's no maxSize.
        inNetwork: function(i, j) {
            return !this.network || this.network.sites.has(i + ',' + j);
        },
        
        // The neighbours [i, j] of site (i, j) in the network that could still be added
        // from it (not settled, and in within, a set of keys, if given), or none if it's a
        // dead end or not in it.
        growable: function(i, j, within) {
            const s = this.network.sites.get(i + ',' + j);
            return s && !s.deadEnd ? hex.dirs.map(([di, dj]) => [i + di, j + dj])
                .filter(q => !this.isSettled(q.join()) && (!within || within.has(q.join()))) : [];
        },
        
        // Adds site (i, j) to the network, with a tunnel to its parent ([i, j], or null
        // for the start's), and tunnels to its other neighbours in it at loops%.
        addSite: function(i, j, parent) {
            const n = this.network,
                key = i + ',' + j,
                CTG = pkg.CavernsTileGenerator;
            n.sites.set(key, {parent, deadEnd:false});
            n.order.push(key);
            if (parent) {
                n.edges.add(CTG.tunnelKey(key, parent.join()));
                n.sites.get(key).deadEnd = this.wantsDeadEnd(i, j) && n.order.some(k => k !== key && this.growable(...k.split(',').map(Number)).length > 0);
                if (!n.sites.get(key).deadEnd) {
                    for (const [di, dj] of hex.dirs) {
                        const nk = (i + di) + ',' + (j + dj),
                            tk = CTG.tunnelKey(key, nk);
                        if (nk !== parent.join() && n.sites.has(nk) && !n.sites.get(nk).deadEnd && this.game.rngFor('cave-loop', tk)() * 100 < this.attrs.loops) {
                            n.edges.add(tk);
                        }
                    }
                }
            }
            this.addCells(i, j);
        },
        
        // Counts site (i, j)'s open cells in the network's: its cavern, its tunnels, and its
        // dead end's shape and cavern loop if it has them.
        addCells: function(i, j) {
            const n = this.network,
                key = i + ',' + j,
                parts = [this.cavern(i, j), this.deadEndShape(i, j)?.cells, this.cavernLoop(i, j)?.cells];
            for (const tk of n.edges) {
                if (tk.split('|').includes(key)) parts.push(this.tunnel(tk).cells);
            }
            for (const keys of parts) keys?.forEach(k => n.cells.add(k));
        },
        
        // Grows the network until its open cells reach budget or nothing can be added,
        // from sites in within (a set of keys) if given. rng picks: at sprawl%, a site
        // next to the newest site that can grow; otherwise any site next to one that can.
        grow: function(budget, rng, within) {
            const n = this.network;
            let done = false;
            while (!done && n.cells.size < budget) {
                const options = n.order.map(key => {
                        const [i, j] = key.split(',').map(Number);
                        return {from:[i, j], to:this.growable(i, j, within)};
                    }).filter(o => o.to.length),
                    pairs = options.flatMap(o => o.to.map(to => [o.from, to]));
                if (pairs.length) {
                    let pair;
                    if (rng() * 100 < this.attrs.sprawl) {
                        const newest = options[options.length - 1];
                        pair = [newest.from, newest.to[floor(rng() * newest.to.length)]];
                    } else {
                        pair = pairs[floor(rng() * pairs.length)];
                    }
                    this.addSite(...pair[1], pair[0]);
                } else {
                    done = true;
                }
            }
        },
        
        // Before block (bi, bj)'s cells are made: grows the network into the sites that may
        // reach it (see near), as far as maxSize allows, and settles the rest as rock.
        settleNear: function(bi, bj) {
            const n = this.network,
                c = this.blocks.center(bi, bj),
                keys = new Set(hex.disk(...this.siteOf(c.x, c.y), this.siteReach).map(q => q.x + ',' + q.y));
            if ([...keys].some(key => !this.isSettled(key))) {
                this.grow(this.attrs.maxSize, this.game.rngFor('cave-grow', String(n.order.length)), keys);
                for (const key of keys) {
                    if (!this.isSettled(key)) n.excluded.add(key);
                }
            }
        },
        
        // ---- The layout ----
        
        // The site [i, j] cell (x, y) is nearest, before sites are moved.
        siteOf: function(x, y) {
            const [wx, wy] = hex.center(x, y),
                c = hex.cellAtWorld(wx / this.spacing, wy / this.spacing);
            return [c.x, c.y];
        },
        
        // Site (i, j) as the seed makes it, before it's moved toward the caverns it's joined
        // to (see site): whether it's a junction, where it is (in world units), and its
        // cavern's size and shape.
        siteBase: function(i, j) {
            const key = i + ',' + j;
            if (!this.bases.has(key)) {
                const a = this.attrs,
                    rng = this.game.rngFor('cave-site', key),
                    start = i === 0 && j === 0,
                    junction = !start && rng() * 100 < a.junctionChance,
                    [nx, ny] = hex.center(i * this.spacing, j * this.spacing),
                    angle = rng() * TAU,
                    // The start cavern isn't moved, so it's centred on the start cell.
                    shift = start ? 0 : rng() * (junction ? JUNCTION_JITTER : JITTER) * this.spacing,
                    area = a.cavernSizeMin + rng() * (a.cavernSizeMax - a.cavernSizeMin);
                this.bases.set(key, {
                    i, j, key, junction,
                    wx:nx + shift * cos(angle),
                    wy:ny + shift * sin(angle),
                    radius:junction ? 0 : sqrt(area * CELL_AREA / PI),
                    wobble:WOBBLE.map(([n, amp]) => [n, amp * rng(), rng() * TAU])
                });
            }
            return this.bases.get(key);
        },
        
        // Site (i, j): its base (see siteBase), with a cavern moved toward the caverns it's
        // joined to (by half the gap to each, all of it to the start's, which doesn't move).
        // In a network of limited size, a cavern is only joined to its parent, which is in
        // place before it's added, and moves all the way to it.
        site: function(i, j) {
            const key = i + ',' + j;
            let retval = this.sites.get(key);
            if (!retval) {
                const b = this.siteBase(i, j),
                    parent = this.network ? this.parentOf(i, j) : null;
                let mx = 0,
                    my = 0;
                if (!b.junction && (i !== 0 || j !== 0)) {
                    // (In a network, only its parent.)
                    for (const [di, dj] of parent ? [[parent[0] - i, parent[1] - j]] : this.network ? [] : hex.dirs) {
                        if (this.canJoin([i, j], [i + di, j + dj])) {
                            const toParent = parent?.[0] === i + di && parent[1] === j + dj,
                                p = toParent ? this.site(i + di, j + dj) : this.siteBase(i + di, j + dj),
                                dx = p.wx - b.wx,
                                dy = p.wy - b.wy,
                                d = hypot(dx, dy),
                                move = max(0, d - b.radius - p.radius) / (toParent || p.i === 0 && p.j === 0 ? 1 : 2);
                            mx += dx / d * move;
                            my += dy / d * move;
                        }
                    }
                    // Not so far that it's out of reach of the lookups (see near).
                    const m = hypot(mx, my), most = JOIN_SHIFT * this.spacing;
                    if (m > most) {
                        mx *= most / m;
                        my *= most / m;
                    }
                }
                retval = {...b, wx:b.wx + mx, wy:b.wy + my};
                if (this.isSettled(key)) this.sites.set(key, retval);
            }
            return retval;
        },
        
        // The keys of the cells in site (i, j)'s cavern (none for a junction, or a site not
        // in the network).
        cavern: function(i, j) {
            const s = this.site(i, j);
            let retval = this.caverns.get(s.key);
            if (!retval) {
                const keys = new Set();
                if (!s.junction && this.inNetwork(i, j)) {
                    const c = hex.cellAtWorld(s.wx, s.wy);
                    for (const q of hex.disk(c.x, c.y, ceil(s.radius * (1 + WOBBLE_MAX)) + 1)) {
                        const [wx, wy] = hex.center(q.x, q.y),
                            dx = wx - s.wx,
                            dy = wy - s.wy,
                            angle = atan2(dy, dx),
                            r = s.radius * (1 + s.wobble.reduce((sum, [n, amp, phase]) => sum + amp * cos(n * angle + phase), 0));
                        if (hypot(dx, dy) <= r) keys.add(q.x + ',' + q.y);
                    }
                }
                retval = keys;
                if (this.isSettled(s.key)) this.caverns.set(s.key, keys);
            }
            return retval;
        },
        
        // A dead end's roll for site (i, j), 0 to 100 (the start's is 100: it's never one).
        deadEndRoll: function(i, j) {
            return i === 0 && j === 0 ? 100 : this.game.rngFor('cave-dead-end', i + ',' + j)() * 100;
        },
        
        // Whether site (i, j) would be a dead end, by its kind's schema and factor:
        // "random", at the factor (%); or "adaptive", likelier the more open the ways
        // around it are (its neighbours whose own rolls are in the top half): at the factor
        // with 3 of them open, twice it with all 6, and never with none. (Whether it is one
        // depends on its neighbours too: see isDeadEnd.)
        wantsDeadEnd: function(i, j) {
            const a = this.attrs,
                kind = this.siteBase(i, j).junction ? 'tunnel' : 'cavern',
                factor = a[kind + 'DeadEndFactor'];
            let chance = factor;
            if (a[kind + 'DeadEndSchema'] === 'adaptive') {
                chance = factor * hex.dirs.filter(([di, dj]) => this.deadEndRoll(i + di, j + dj) >= 50).length / 3;
            }
            return this.deadEndRoll(i, j) < chance;
        },
        
        // Whether site (i, j) is a dead end: it only has the tunnel to its parent. It's one
        // if it would be (wantsDeadEnd) and no neighbour has it as its parent (see
        // parentOf). Every site still has a parent, so a dead end never cuts anything off.
        isDeadEnd: function(i, j) {
            const key = i + ',' + j;
            if (this.network) return this.network.sites.get(key)?.deadEnd ?? false;
            if (!this.deadEnds.has(key)) {
                this.deadEnds.set(key, this.wantsDeadEnd(i, j) && pkg.CavernsTileGenerator.fartherOf(i, j).every(n => {
                    const p = this.parentOf(...n);
                    return p[0] !== i || p[1] !== j;
                }));
            }
            return this.deadEnds.get(key);
        },
        
        // The neighbouring site [i, j] that site (i, j) has a tunnel to on the way to the
        // start, or null for the start's: one of its neighbours nearer the start, at random,
        // but one that wouldn't be a dead end if there is one.
        parentOf: function(i, j) {
            if (this.network) return this.network.sites.get(i + ',' + j)?.parent ?? null;
            if (i === 0 && j === 0) return null;
            const nearer = pkg.CavernsTileGenerator.nearerOf(i, j),
                open = nearer.filter(n => !this.wantsDeadEnd(...n)),
                from = open.length ? open : nearer;
            return from[floor(this.game.rngFor('cave-parent', i + ',' + j)() * from.length)];
        },
        
        // Whether neighbouring sites a and b ([i, j]) have a tunnel between them: one is the
        // other's parent, or, if neither is a dead end, at random (loops).
        hasTunnel: function(a, b) {
            const same = (p, q) => p !== null && p[0] === q[0] && p[1] === q[1],
                tk = pkg.CavernsTileGenerator.tunnelKey(a.join(), b.join());
            if (this.network) return this.network.edges.has(tk);
            return same(this.parentOf(...a), b) || same(this.parentOf(...b), a) ||
                !this.isDeadEnd(...a) && !this.isDeadEnd(...b) && this.game.rngFor('cave-loop', tk)() * 100 < this.attrs.loops;
        },
        
        // Whether neighbouring sites a and b are caverns joined directly (cavernJoinChance)
        // rather than by a winding tunnel: they're moved toward each other (see canJoin and
        // site) until there's no more than JOIN_GAP of rock between them, and the tunnel
        // between them is straight and as wide as most of the smaller one.
        isJoined: function(a, b) {
            return this.canJoin(a, b) && this.gapBetween(this.site(...a), this.site(...b)) <= JOIN_GAP;
        },
        
        // How much rock there is between the edges of two sites' caverns (ignoring their
        // wobble).
        gapBetween: (s, t) => hypot(t.wx - s.wx, t.wy - s.wy) - s.radius - t.radius,
        
        // Whether neighbouring sites a and b ([i, j]) would be joined (cavernJoinChance), and
        // they'd touch once moved toward each other (see site), as far as this join goes:
        // each by half the gap, or all of it toward one that doesn't move (the start's, or
        // in a network the parent), by at most JOIN_SHIFT of the spacing. They're moved
        // toward each other if so. Whether they're joined depends on their other joins
        // too, which may pull them apart again: see isJoined.
        canJoin: function(a, b) {
            const parentOf = (p, q) => this.parentOf(...p)?.join() === q.join(),
                // The one that doesn't move, if one doesn't.
                fixed = this.network ? (parentOf(a, b) ? b : parentOf(b, a) ? a : null) :
                    (a[0] === 0 && a[1] === 0 ? a : b[0] === 0 && b[1] === 0 ? b : null);
            let retval = !this.siteBase(...a).junction && !this.siteBase(...b).junction && this.hasTunnel(a, b) &&
                (!this.network || fixed !== null) &&
                this.game.rngFor('cave-join', pkg.CavernsTileGenerator.tunnelKey(a.join(), b.join()))() * 100 < this.attrs.cavernJoinChance;
            if (retval) {
                const most = JOIN_SHIFT * this.spacing,
                    pos = q => q === fixed && this.network ? this.site(...q) : this.siteBase(...q),
                    gap = this.gapBetween(pos(a), pos(b)),
                    closed = fixed ? Math.min(gap, most) : 2 * Math.min(gap / 2, most);
                retval = gap - closed <= JOIN_GAP;
            }
            return retval;
        },
        
        // The tunnel with key tk: the keys of its cells, of the cells along its path kept
        // clear (its spine), and of those blocked by rubble (its plug: see collapseChance),
        // {cells, spine, plug}. It runs from the centre of one site to the other's (or
        // straight and wide, if they're joined), heading off a little to one side and
        // turning as it goes: the more tangle, the more it turns and the less it's pulled
        // toward the far end, so above about 25 it can turn back on itself for a while, and
        // even cross itself. The longer it gets, the harder it's pulled, so it always
        // arrives. Its width varies as it goes.
        tunnel: function(tk) {
            if (!this.tunnels.has(tk)) {
                const [a, b] = tk.split('|').map(k => this.site(...k.split(',').map(Number))),
                    joined = this.isJoined([a.i, a.j], [b.i, b.j]),
                    rng = this.game.rngFor('cave-tunnel', tk),
                    {tunnelWidthMin:w0, tunnelWidthMax:w1} = this.attrs,
                    tangle = joined ? 0 : this.attrs.tangle / 100,
                    length = hypot(b.wx - a.wx, b.wy - a.wy),
                    ux = (b.wx - a.wx) / length,
                    uy = (b.wy - a.wy) / length,
                    // How fast it turns as it goes (radians per world unit), in two waves.
                    turn = 0.5 * sqrt(tangle),
                    wave1 = 6 + rng() * 6,
                    wave2 = 2.5 + rng() * 2,
                    p1 = rng() * TAU,
                    p2 = rng() * TAU,
                    fw = 0.5 + rng() * 1.5,                   // its width's waves along it
                    pw = rng() * TAU,
                    // The way it sets off: up to 60 degrees to one side at full tangle.
                    offAngle = (rng() - 0.5) * tangle * TAU / 3,
                    // A collapse: where along it (0 to 1), and how long (in world units).
                    collapse = !joined && rng() * 100 < this.attrs.collapseChance,
                    collapseAt = 0.3 + rng() * 0.4,
                    collapseLength = 1.5 + rng() * 1.5,
                    widthAt = s => joined ? max(w1, 1.4 * Math.min(a.radius, b.radius)) : w0 + (w1 - w0) * (0.5 + 0.5 * sin(TAU * fw * s / length + pw)),
                    point = (x, y, s) => ({x, y, s, reach:max(MIN_REACH, widthAt(s) / 2)}),
                    // Where it heads for on the way: evenly along it, more of them the more
                    // tangle, each moved to the side and onward or back at random. Above
                    // about 25 tangle one can be behind the one before, so it turns back.
                    stops = floor(1 + 4 * tangle),
                    back = max(0, (tangle - 0.1) / 0.9) * 2,
                    waypoints = [];
                for (let n = 1; n <= stops; n++) {
                    const along = Math.min(1.15, max(-0.15, (n + (rng() - 0.5) * (0.6 + back)) / (stops + 1))) * length,
                        aside = (rng() - 0.5) * 0.6 * tangle * length;
                    waypoints.push([a.wx + ux * along - uy * aside, a.wy + uy * along + ux * aside]);
                }
                waypoints.push([b.wx, b.wy]);
                let x = a.wx,
                    y = a.wy,
                    s = 0,
                    leg = 0,      // which waypoint it's heading for
                    legS = 0,     // how far it's gone since the last
                    legLength = hypot(waypoints[0][0] - x, waypoints[0][1] - y),
                    heading = atan2(waypoints[0][1] - y, waypoints[0][0] - x) + offAngle;
                const points = [point(x, y, 0)];
                while (hypot(b.wx - x, b.wy - y) > MAX_STEP) {
                    const [tx, ty] = waypoints[leg],
                        toward = atan2(ty - y, tx - x),
                        along = (x - a.wx) * ux + (y - a.wy) * uy,
                        aside = (x - a.wx) * -uy + (y - a.wy) * ux,
                        // Out of bounds (the lookups only reach so far: see near), gone on too
                        // long, or nearly there: straight for the waypoint.
                        straight = Math.abs(aside) > 0.45 * length || along < -0.2 * length || along > 1.2 * length ||
                            legS > 3 * legLength + 4 || hypot(tx - x, ty - y) < 2;
                    if (straight) {
                        heading = toward;
                    } else {
                        // Pulled toward the waypoint, harder the longer it's been going, and turned.
                        const pull = 0.15 * (1 + 4 * (legS / max(1, legLength)) ** 2),
                            diff = atan2(sin(toward - heading), cos(toward - heading));
                        heading += diff * Math.min(1, pull * MAX_STEP) +
                            turn * MAX_STEP * (sin(TAU * s / wave1 + p1) + 0.6 * sin(TAU * s / wave2 + p2));
                    }
                    x += cos(heading) * MAX_STEP;
                    y += sin(heading) * MAX_STEP;
                    s += MAX_STEP;
                    legS += MAX_STEP;
                    points.push(point(x, y, s));
                    if (leg < waypoints.length - 1 && hypot(tx - x, ty - y) < 1.5) {
                        leg++;
                        legS = 0;
                        legLength = hypot(waypoints[leg][0] - x, waypoints[leg][1] - y);
                    }
                }
                points.push(point(b.wx, b.wy, s + hypot(b.wx - x, b.wy - y)));
                const cells = new Set(),
                    spine = new Set(),
                    plug = new Set(),
                    plugAt = collapseAt * points[points.length - 1].s;
                for (const p of points) {
                    sweep(p.x, p.y, p.reach, cells);
                    sweep(p.x, p.y, SPINE_RADIUS, spine);
                    if (collapse && Math.abs(p.s - plugAt) <= collapseLength / 2) sweep(p.x, p.y, p.reach, plug);
                }
                this.tunnels.set(tk, {cells, spine, plug, path:points});
            }
            return this.tunnels.get(tk);
        },
        
        // The shape at the end of the dead-end tunnel to junction (i, j), as picked from
        // deadEndTable: {kind, cells, spine} (no spine: it's a dead end), or null if there's
        // none ("simple": the tunnel just ends). The tunnel's width and tangle carry on into
        // it.
        //   lasso: it carries on into a loop and back, 4 to 10 across (about: the loop
        //     wanders in and out with tangle), as narrow as tunnelWidthMin.
        //   fork: 1 to 3 short branches (4 to 9 long, as narrow as tunnelWidthMin), off to
        //     either side, from up to 6 back along the tunnel, so they're not all at the end.
        //   knot: 2 or 3 shorter, thinner branches (2 to 5 long) from near the end, most of
        //     them ending in a small loop (3 to 5 across).
        deadEndShape: function(i, j) {
            const key = i + ',' + j;
            let retval = this.deadEndShapes.get(key);
            if (retval === undefined) {
                const s = this.site(i, j),
                    rng = this.game.rngFor('cave-dead-end-shape', key);
                retval = null;
                if (s.junction && this.isDeadEnd(i, j)) {
                    const kind = pick(this.attrs.deadEndTable, rng);
                    if (kind && kind !== 'simple') {
                        const {tunnelWidthMin:w0, tunnelWidthMax:w1, tangle:t} = this.attrs,
                            tangle = t / 100,
                            r = max(MIN_REACH, (w0 + rng() * (w1 - w0)) / 2),
                            narrow = max(MIN_REACH, w0 / 2),
                            // The tunnel's path, from its parent to here.
                            parent = this.parentOf(i, j),
                            path = [...this.tunnel(pkg.CavernsTileGenerator.tunnelKey(key, parent.join())).path],
                            cells = new Set(),
                            draw = (points, reach = r) => points.forEach(([x, y]) => sweep(x, y, reach, cells)),
                            // Where the path is d back from its end, and which way it goes there.
                            back = d => {
                                const end = path[path.length - 1].s,
                                    n = max(1, path.findIndex(q => q.s >= end - d)),
                                    q = path[n];
                                return {x:q.x, y:q.y, heading:atan2(q.y - path[n - 1].y, q.x - path[n - 1].x)};
                            },
                            // A branch off from up to most back, length long, as wide as reach
                            // either side: its points.
                            branch = (most, length, reach) => {
                                const from = back(rng() * most),
                                    side = (rng() < 0.5 ? -1 : 1) * (0.8 + rng() * 0.8),
                                    points = wander(rng, from.x, from.y, from.heading + side, length, tangle);
                                draw(points, reach);
                                return points;
                            };
                        if (hypot(path[0].x - s.wx, path[0].y - s.wy) < hypot(path[path.length - 1].x - s.wx, path[path.length - 1].y - s.wy)) {
                            // It was drawn from here: turn it round, and count from the other end.
                            const total = path[path.length - 1].s;
                            path.reverse();
                            for (let n = 0; n < path.length; n++) path[n] = {...path[n], s:total - path[n].s};
                        }
                        const end = back(0);
                        if (kind === 'lasso') {
                            draw(loop(rng, end.x, end.y, end.heading, 2 + rng() * 3, tangle), narrow);
                        } else if (kind === 'fork') {
                            for (let n = 1 + floor(rng() * 3); n > 0; n--) branch(6, 4 + rng() * 5, narrow);
                        } else if (kind === 'knot') {
                            for (let n = 2 + floor(rng() * 2); n > 0; n--) {
                                const points = branch(3, 2 + rng() * 3, MIN_REACH);
                                if (rng() < 0.7) {
                                    const [[px, py], [x, y]] = points.slice(-2);
                                    draw(loop(rng, x, y, atan2(y - py, x - px), 1.5 + rng(), tangle), MIN_REACH);
                                }
                            }
                        }
                        retval = {kind, cells, spine:new Set()};
                    }
                }
                if (this.isSettled(key)) this.deadEndShapes.set(key, retval);
            }
            return retval;
        },
        
        // A tunnel out of cavern (i, j) that comes back into it elsewhere, at
        // cavernLoopChance: {cells, spine} (no spine: it's an extra), or null.
        cavernLoop: function(i, j) {
            const key = i + ',' + j;
            let retval = this.cavernLoops.get(key);
            if (retval === undefined) {
                let loop = null;
                const s = this.site(i, j),
                    rng = this.game.rngFor('cave-cavern-loop', key);
                if (!s.junction && this.inNetwork(i, j) && rng() * 100 < this.attrs.cavernLoopChance) {
                    // A curve from the centre, out past the edge one way and back in another
                    // 60 to 120 degrees round.
                    const {tunnelWidthMin:w0, tunnelWidthMax:w1} = this.attrs,
                        out = rng() * TAU,
                        back = out + (rng() < 0.5 ? -1 : 1) * (PI / 3 + rng() * PI / 3),
                        reach = (s.radius * (1 + WOBBLE_MAX) + 3 + rng() * 5) * 1.3,
                        r = max(MIN_REACH, (w0 + rng() * (w1 - w0)) / 2),
                        [x1, y1] = [s.wx + reach * cos(out), s.wy + reach * sin(out)],
                        [x2, y2] = [s.wx + reach * cos(back), s.wy + reach * sin(back)],
                        cells = new Set(),
                        steps = ceil(reach * 12);
                    for (let n = 0; n <= steps; n++) {
                        const t = n / steps,
                            u = 1 - t,
                            // A cubic Bezier from the centre back to it, pulled out by the two
                            // control points.
                            px = u * u * u * s.wx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * s.wx,
                            py = u * u * u * s.wy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * s.wy;
                        sweep(px, py, r, cells);
                    }
                    loop = {cells, spine:new Set()};
                }
                retval = loop;
                if (this.isSettled(key)) this.cavernLoops.set(key, loop);
            }
            return retval;
        },
        
        // The caverns and tunnels (dead ends' shapes and cavern loops too) that may reach block (bi,
        // bj): {caverns, tunnels}, the keys of their cells (and the tunnels' spines). Sites
        // more than siteReach apart on the lattice are too far for theirs to.
        near: function(bi, bj) {
            const c = this.blocks.center(bi, bj),
                sites = hex.disk(...this.siteOf(c.x, c.y), this.siteReach).map(q => [q.x, q.y]),
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
                tunnels:[
                    ...[...tunnelKeys].map(tk => this.tunnel(tk)),
                    ...sites.flatMap(q => [this.deadEndShape(...q), this.cavernLoop(...q)]).filter(Boolean)
                ]
            };
        },
        
        /*  The cavern or tunnel cell (x, y) is in, as the seed makes them: {kind:'cavern' or
            'tunnel', id (one for each cavern and tunnel, dead end shapes and loops counting
            as tunnels), cells (the keys of its cells), size (how many), start (whether you
            start in it)}, or null if it's in neither. A cavern counts first, where a tunnel
            runs into one. For spawn generators (see CavernsSpawnGenerator). */
        regionAt: function(x, y) {
            const k = x + ',' + y,
                sites = hex.disk(...this.siteOf(x, y), this.siteReach).map(q => [q.x, q.y]);
            for (const q of sites) {
                const keys = this.cavern(...q);
                if (keys.has(k)) return {kind:'cavern', id:'cavern ' + q.join(), cells:keys, size:keys.size, start:keys.has('0,0')};
            }
            const inRange = new Set(sites.map(q => q.join()));
            for (const q of sites) {
                for (const [di, dj] of hex.dirs) {
                    const n = [q[0] + di, q[1] + dj];
                    if (inRange.has(n.join()) && this.hasTunnel(q, n)) {
                        const tk = pkg.CavernsTileGenerator.tunnelKey(q.join(), n.join()),
                            t = this.tunnel(tk);
                        if (t.cells.has(k)) return {kind:'tunnel', id:'tunnel ' + tk, cells:t.cells, size:t.cells.size, start:t.cells.has('0,0')};
                    }
                }
                for (const [name, t] of [['dead end', this.deadEndShape(...q)], ['loop', this.cavernLoop(...q)]]) {
                    if (t?.cells.has(k)) return {kind:'tunnel', id:name + ' ' + q.join(), cells:t.cells, size:t.cells.size, start:t.cells.has('0,0')};
                }
            }
            return null;
        },
        
        /*  Makes the tiles of the cells of region (from regionAt), and those round them, if
            they're not made yet: so what's open there is known, as before spawning there. */
        makeRegion: function(region) {
            for (const k of region.cells) this.makeBlock(...this.blocks.of(...k.split(',').map(Number)));
        },
        
        // ---- Making cells ----
        
        // What cell (x, y) is, given what's near it (see near): {open, cavern, clear,
        // rubble}. Open cells are in a cavern or a tunnel; clear ones (the tunnels' spines,
        // and the start cell and its neighbours) are kept free of stalagmites, stalactites
        // and holes; rubble is where a tunnel has collapsed, outside the caverns.
        cellOf: function(x, y, near) {
            const k = x + ',' + y,
                cavern = near.caverns.some(keys => keys.has(k));
            return {
                open:cavern || near.tunnels.some(t => t.cells.has(k)),
                cavern,
                rubble:!cavern && near.tunnels.some(t => t.plug?.has(k)),
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
        
        // The patch of floor the seed starts at cell (x, y), {subtype, radius}, or null.
        // Worked out once each.
        floorPatchAt: function(x, y) {
            const k = x + ',' + y;
            let retval = this.floorPatches.get(k);
            if (retval === undefined) {
                const a = this.attrs,
                    rng = this.game.rngFor('cave-floor', k),
                    subtype = rng() * 1000 < a.floorFrequency ? pick(a.floorTable, rng) : undefined,
                    min = Math.min(a.floorSizeMin, a.floorSizeMax);
                retval = subtype === undefined ? null : {subtype, radius:min + floor(rng() * (Math.max(a.floorSizeMin, a.floorSizeMax) - min + 1))};
                this.floorPatches.set(k, retval);
            }
            return retval;
        },
        
        // The floor tile cell (x, y) is in a patch of (the nearest patch's), or undefined.
        floorOf: function(x, y) {
            let best, bestD = Infinity;
            for (const c of hex.disk(x, y, Math.max(this.attrs.floorSizeMin, this.attrs.floorSizeMax))) {
                const patch = this.floorPatchAt(c.x, c.y),
                    d = hexDist(c, {x, y});
                if (patch && d <= patch.radius && d < bestD) {
                    best = patch.subtype;
                    bestD = d;
                }
            }
            return best;
        },
        
        // A heal, harm or loot (fixture) the seed puts on open cell (x, y), as [type,
        // subtype], or null.
        fixtureOf: function(x, y) {
            const a = this.attrs,
                rng = this.game.rngFor('cave-item', x + ',' + y),
                roll = rng() * 1000,
                type = roll < a.healFrequency ? FIXTURE_HEAL :
                    roll < a.healFrequency + a.harmFrequency ? FIXTURE_HARM :
                    roll < a.healFrequency + a.harmFrequency + a.lootFrequency ? FIXTURE_LOOT : null,
                subtype = type ? pick(a[type + 'Table'], rng) : undefined;
            return subtype === undefined || (x === 0 && y === 0) ? null : [type, subtype];
        },
        
        // What tile cell (x, y) gets, as [kind, subtype]: a solid, a hole or a floor (from a
        // patch), or null for the base floor.
        tileOf: function(x, y, near) {
            const a = this.attrs,
                c = this.cellOf(x, y, near);
            let retval = null;
            if (!c.open) {
                retval = [TILE_TYPE_SOLID, a.rockSolid];
            } else if (c.rubble) {
                retval = [TILE_TYPE_SOLID, a.rubbleSolid];
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
                if (!retval) {
                    const floorType = this.floorOf(x, y);
                    if (floorType !== undefined) retval = [TILE_TYPE_FLOOR, floorType];
                }
            }
            return retval;
        },
        
        // Makes block (bi, bj)'s cells, once: their tiles (tileOf), and fixtures (fixtureOf)
        // on the open ones. Cells with a tile, a fixture or a piece already are left as they
        // are.
        makeBlock: function(bi, bj) {
            const bk = bi + ',' + bj;
            if (!this.madeBlocks.has(bk)) {
                this.madeBlocks.add(bk);
                if (this.network) this.settleNear(bi, bj);
                const game = this.game,
                    near = this.near(bi, bj);
                for (const {x, y} of this.blocks.cells(bi, bj)) {
                    const k = game.key(x, y);
                    if (!game.tiles.has(k) && !game.fixtures.has(k) && !game.pieceAt(x, y)) {
                        const [kind, subtype] = this.tileOf(x, y, near) ?? [];
                        if (kind) game.tiles.set(k, game.makeTile(x, y, kind, subtype));
                        if (game.isOpen(x, y)) {
                            const [type, fixture] = this.fixtureOf(x, y) ?? [];
                            if (type) game.fixtures.set(k, game.makeFixture(x, y, fixture, game.rngFor('rolls', k), type));
                        }
                    }
                }
            }
        }
    });
    pkg.TileGenerator.register('caverns', pkg.CavernsTileGenerator);
})(hc);
