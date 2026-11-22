/*  The "proximity" tile generator: the map is made around your pieces as they go. The world
    is divided into quadrants (chunks of cells, of radius quadRadius: see makeChunks, in
    Grid.js). When a piece of yours is in a quadrant, it's visited, and the quadrants around it get their tiles, once each:
    solid and hole tiles (border walls and clumps) out to where you could see, and heal,
    harm and loot tiles in it and its 6 neighbours. Everything comes from the game's seed
    (Game.rngFor), so a quadrant comes out the same whatever order it's made in. */
(pkg => {
    'use strict';
    
    const {
        attrs:{num, choice},
        TILE_TYPE_SOLID, TILE_TYPE_HOLE, TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_LOOT
    } = pkg,
        
        // A set of subtypes (solids, holes, heals...), as choices. They're known once
        // init.json5 has loaded.
        optionsOf = subtypes => () => subtypes.list().map(s => ({value:s.id, label:s.name}));
    
    const ProximityTileGenerator = pkg.ProximityTileGenerator = new JS.Class('ProximityTileGenerator', pkg.TileGenerator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[
                num('quadRadius', 5, 1, 6),        // quadrants' radius; the start cell (0,0) is the centre of quadrant (0,0)
                
                // Heal, harm and loot tiles per quadrant, of these subtypes (data/init.json5;
                // see EffectTiles.js).
                num('healPerQuad', 1, 0, 20),
                num('harmPerQuad', 1, 0, 40),
                num('lootChance', 10, 0, 100),     // % chance a heal tile is a loot tile instead
                choice('healType', 'heal', optionsOf(pkg.heals)),
                choice('harmType', 'harm', optionsOf(pkg.harms)),
                choice('lootType', 'loot', optionsOf(pkg.loots)),
                
                // Border walls, and the clumps of solid and hole tiles in each quadrant.
                num('wallChance', 50, 0, 100),     // % chance a border between quadrants is a wall
                num('wallHoleChance', 25, 0, 100), // % of walls made of holes rather than solid tiles
                num('doorMin', 1, 0, 10),          // cells left open in the middle of a wall
                num('doorMax', 2, 0, 10),
                num('solidMin', 0, 0, 20),         // solid tiles per quadrant, in one connected clump
                num('solidMax', 5, 0, 20),
                num('holeMin', 0, 0, 20),          // hole tiles per quadrant, in one connected clump (may replace solid tiles)
                num('holeMax', 3, 0, 20),
                choice('wallSolid', 'stone_wall', optionsOf(pkg.solids)), // the solid and hole subtypes walls and clumps are made of
                choice('clumpSolid', 'boulder', optionsOf(pkg.solids)),
                choice('wallHole', 'chasm', optionsOf(pkg.holes)),
                choice('clumpHole', 'pit', optionsOf(pkg.holes))
            ],
            
            // The key of the border between two quadrants ("i,j" keys), the same either way
            // round.
            borderKey: (a, b) => a < b ? a + '|' + b : b + '|' + a
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.callSuper(game, attrs);
            // Keep the ranges the right way round.
            const a = this.attrs;
            a.doorMax = Math.max(a.doorMin, a.doorMax);
            a.solidMax = Math.max(a.solidMin, a.solidMax);
            a.holeMax = Math.max(a.holeMin, a.holeMax);
            
            this.quads = pkg.makeChunks(a.quadRadius); // the quadrants' geometry
            this.terrainQuads = new Set();   // quadrants whose solid and hole tiles have been placed
            this.borders = new Map();        // border key (see ProximityTileGenerator.borderKey) -> its wall {door, hole, start}, or null: no wall
            this.tiledQuads = new Set();     // quadrants whose heal, harm and loot tiles have been placed
            this.visitedQuads = new Set();   // quadrants a piece of yours has been in
        },
        
        // Methods /////////////////////////////////////////////////////////////
        start: function() {this.piecesMoved();},
        
        exportState: function() {
            return {
                terrainQuads:[...this.terrainQuads],
                borders:[...this.borders],
                tiledQuads:[...this.tiledQuads],
                visitedQuads:[...this.visitedQuads]
            };
        },
        importState: function(state) {
            if (![state?.terrainQuads, state?.borders, state?.tiledQuads, state?.visitedQuads].every(Array.isArray)) {
                throw new Error('Malformed tile generator state');
            }
            this.terrainQuads = new Set(state.terrainQuads);
            this.borders = new Map(state.borders);
            this.tiledQuads = new Set(state.tiledQuads);
            this.visitedQuads = new Set(state.visitedQuads);
        },
        
        // Visits the quadrants holding your pieces. Solid and hole tiles are placed in every
        // quadrant within reach of them: enough quadrants out to cover the vision radius (at
        // least 1), so they exist wherever you could see. This doesn't depend on whether fog
        // of war is on, so turning it off and on doesn't change the world. Heal, harm and
        // loot tiles are placed only 1 quadrant out.
        piecesMoved: function() {
            const reach = Math.max(1, Math.ceil(this.game.rules.visionRadius / (3 * this.quads.radius + 2)));
            for (const p of this.game.piecesOf('player')) {
                const [qx, qy] = this.quads.of(p.x, p.y);
                this.visitedQuads.add(qx + ',' + qy);
                for (const q of pkg.hex.disk(qx, qy, reach)) this.generateTerrain(q.x, q.y);
                for (const q of pkg.hex.disk(qx, qy, 1)) this.generateTiles(q.x, q.y);
            }
        },
        
        // A quadrant's heal and harm tiles, once, on random free cells, of the subtypes in
        // its attrs (healType, harmType, lootType).
        generateTiles: function(qx, qy) {
            const game = this.game,
                k = qx + ',' + qy;
            if (this.tiledQuads.has(k)) return;
            this.tiledQuads.add(k);
            // A loot tile replaces a heal tile at lootChance. (Loot and the tiles' pools and
            // magnitudes have their own generators, so the cells come out as they would
            // without them.)
            const cells = this.quads.cells(qx, qy),
                rng = game.rngFor('tiles', k),
                lootRng = game.rngFor('loot', k),
                rollRng = game.rngFor('rolls', k),
                place = kind => {
                    const loot = kind === TILE_TYPE_HEAL && lootRng() * 100 < this.attrs.lootChance,
                        made = loot ? TILE_TYPE_LOOT : kind;
                    for (let tries = 0; tries < 50; tries++) {
                        const { x, y } = cells[Math.floor(rng() * cells.length)];
                        const kk = game.key(x, y);
                        if (game.tiles.has(kk) || game.pieceAt(x, y)) continue;
                        game.tiles.set(kk, game.makeTile(x, y, made, this.attrs[made + 'Type'], rollRng));
                        return;
                    }
                };
            for (let i = 0; i < this.attrs.healPerQuad; i++) place(TILE_TYPE_HEAL);
            for (let i = 0; i < this.attrs.harmPerQuad; i++) place(TILE_TYPE_HARM);
        },
        
        // A quadrant's solid and hole tiles, once: the walls on its side of its borders,
        // then a clump of solidMin to solidMax solid tiles, then a clump of holeMin to
        // holeMax holes, which may land on (replace) solid tiles.
        generateTerrain: function(qx, qy) {
            const k = qx + ',' + qy;
            if (this.terrainQuads.has(k)) return;
            this.terrainQuads.add(k);
            const cells = this.quads.cells(qx, qy),
                rng = this.game.rngFor('terrain', k);
            
            // A wall sits on the side of the quadrant whose key comes first in the border's
            // key, so it's placed when that quadrant is made.
            for (const [i, j] of this.quads.neighbours(qx, qy)) {
                const bk = ProximityTileGenerator.borderKey(k, i + ',' + j), wall = this.borderWall(bk);
                if (wall && bk.startsWith(k + '|')) this.placeWall(cells, i, j, wall);
            }
            this.placeClump(cells, TILE_TYPE_SOLID, this.attrs.solidMin, this.attrs.solidMax, [], rng);
            this.placeClump(cells, TILE_TYPE_HOLE, this.attrs.holeMin, this.attrs.holeMax, [TILE_TYPE_SOLID], rng);
        },
        
        // A border as the seed makes it, on its own: a wall {door, hole, start} or null. The
        // wall's door is doorMin to doorMax cells, hole says it's made of holes, and start
        // (0 to 1) says where along the border the door goes.
        seededBorder: function(bk) {
            const rng = this.game.rngFor('border', bk);
            if (rng() * 100 >= this.attrs.wallChance) return null;
            return {
                door:this.attrs.doorMin + Math.floor(rng() * (this.attrs.doorMax - this.attrs.doorMin + 1)),
                hole:rng() * 100 < this.attrs.wallHoleChance,
                start:rng()
            };
        },
        
        // A border's wall {door, hole, start}, or null: decided once and kept. No quadrant
        // is walled in on every side: if all six of a quadrant's borders would be walls with
        // no door, the first of them (by key) gets a door of 1. This depends only on the
        // seed, not on the order quadrants are made in.
        borderWall: function(bk) {
            if (!this.borders.has(bk)) {
                const wall = this.seededBorder(bk);
                if (wall?.door === 0) {
                    for (const q of bk.split('|')) {
                        const all = this.bordersOf(q).sort();
                        if (all[0] === bk && all.every(b => this.seededBorder(b)?.door === 0)) wall.door = 1;
                    }
                }
                this.borders.set(bk, wall);
            }
            return this.borders.get(bk);
        },
        
        // The keys of a quadrant's six borders.
        bordersOf: function(q) {
            const [i, j] = q.split(',').map(Number);
            return this.quads.neighbours(i, j).map(([a, b]) => ProximityTileGenerator.borderKey(q, a + ',' + b));
        },
        
        // A wall along the border between a quadrant (its cells) and its neighbour (i, j),
        // on the quadrant's own side: every cell touching the neighbour, except a door in
        // the middle (not at a corner, where another wall may meet it). Some walls are holes
        // rather than solid tiles. Cells with a tile or a piece already are left as they are.
        placeWall: function(cells, i, j, wall) {
            const game = this.game,
                G = pkg.hex,
                Q = this.quads,
                middle = cs => {
                    let sx = 0, sy = 0;
                    for (const c of cs) {
                        const [x, y] = G.center(c.x, c.y);
                        sx += x; sy += y;
                    }
                    return [sx / cs.length, sy / cs.length];
                },
                [ax, ay] = middle(cells), [bx, by] = middle(Q.cells(i, j)),
                along = c => {const [x, y] = G.center(c.x, c.y); return (x - ax) * (ay - by) + (y - ay) * (bx - ax);},
                border = cells.filter(c => G.dirs.some(([dx, dy]) => Q.key(c.x + dx, c.y + dy) === i + ',' + j))
                    .sort((a, b) => along(a) - along(b)),
                inner = border.length > 2 ? border.slice(1, -1) : border,
                width = Math.min(inner.length, wall.door),
                start = Math.floor(wall.start * (inner.length - width + 1)),
                door = new Set(inner.slice(start, start + width)),
                kind = wall.hole ? TILE_TYPE_HOLE : TILE_TYPE_SOLID;
            for (const c of border) {
                if (!door.has(c) && !game.tiles.has(game.key(c.x, c.y)) && !game.pieceAt(c.x, c.y)) {
                    game.tiles.set(game.key(c.x, c.y), game.makeTile(c.x, c.y, kind, wall.hole ? this.attrs.wallHole : this.attrs.wallSolid));
                }
            }
        },
        
        // One connected clump of min to max tiles of a kind within a quadrant's cells: the
        // first on a random free cell, each next one on a free cell touching the clump. A
        // cell is free if no piece is on it and it has no tile, or a tile of a kind in
        // `replaces`. rng picks the cells.
        placeClump: function(cells, kind, min, max, replaces, rng) {
            const game = this.game,
                inQuad = new Set(cells.map(c => game.key(c.x, c.y))),
                free = (x, y) => {
                    const k = game.key(x, y), t = game.tiles.get(k);
                    return inQuad.has(k) && (!t || replaces.includes(t.kind)) && !game.pieceAt(x, y);
                },
                count = min + Math.floor(rng() * (max - min + 1));
            const edge = new Map(); // free cells touching the clump, by key
            let options = cells.filter(c => free(c.x, c.y));
            for (let i = 0; i < count && options.length; i++) {
                const {x, y} = options[Math.floor(rng() * options.length)];
                game.tiles.set(game.key(x, y), game.makeTile(x, y, kind, kind === TILE_TYPE_HOLE ? this.attrs.clumpHole : this.attrs.clumpSolid));
                edge.delete(game.key(x, y));
                for (const [dx, dy] of pkg.hex.dirs) {
                    const nx = x + dx,
                        ny = y + dy;
                    if (free(nx, ny)) edge.set(game.key(nx, ny), {x:nx, y:ny});
                }
                options = [...edge.values()];
            }
        }
    });
    pkg.TileGenerator.register('proximity', ProximityTileGenerator);
})(hc);
