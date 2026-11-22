/*  The "proximity" tile generator: the map is made around your pieces as they go. The world
    is divided into quadrants (the grid's chunks, of radius QUAD.radius). When a piece of yours
    is in a quadrant, it's visited, and the quadrants around it get their tiles, once each:
    solid and hole tiles (border walls and clumps) out to where you could see, and heal,
    harm and loot tiles in it and its 6 neighbours. Everything comes from the game's seed
    (Game.rngFor), so a quadrant comes out the same whatever order it's made in. */
(pkg => {
    'use strict';
    
    const {
        cfg:{VISION, TILES},
        TILE_TYPE_SOLID, TILE_TYPE_HOLE, TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_LOOT
    } = pkg;
    
    const ProximityTileGenerator = pkg.ProximityTileGenerator = new JS.Class('ProximityTileGenerator', pkg.TileGenerator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            // The quadrant [i, j] cell (x, y) is in.
            quadOf: (x, y) => pkg.GRID.chunkOf(x, y),
            
            // The key of the border between two quadrants ("i,j" keys), the same either way
            // round.
            borderKey: (a, b) => a < b ? a + '|' + b : b + '|' + a,
            
            // The keys of a quadrant's six borders.
            bordersOf: q => {
                const [i, j] = q.split(',').map(Number);
                return pkg.GRID.chunkNeighbours(i, j).map(([a, b]) => ProximityTileGenerator.borderKey(q, a + ',' + b));
            }
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game) {
            this.callSuper(game);
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
            const reach = Math.max(1, Math.ceil(VISION.radius / (3 * pkg.GRID.chunkRadius + 2)));
            for (const p of this.game.piecesOf('player')) {
                const [qx, qy] = ProximityTileGenerator.quadOf(p.x, p.y);
                this.visitedQuads.add(qx + ',' + qy);
                for (const q of pkg.GRID.disk(qx, qy, reach)) this.generateTerrain(q.x, q.y);
                for (const q of pkg.GRID.disk(qx, qy, 1)) this.generateTiles(q.x, q.y);
            }
        },
        
        // A quadrant's heal and harm tiles, once, on random free cells, of the subtypes in
        // the settings (healType, harmType, lootType).
        generateTiles: function(qx, qy) {
            const game = this.game,
                k = qx + ',' + qy;
            if (this.tiledQuads.has(k)) return;
            this.tiledQuads.add(k);
            // A loot tile replaces a heal tile at lootChance. (Loot and the tiles' pools and
            // magnitudes have their own generators, so the cells come out as they would
            // without them.)
            const cells = pkg.GRID.chunkCells(qx, qy),
                rng = game.rngFor('tiles', k),
                lootRng = game.rngFor('loot', k),
                rollRng = game.rngFor('rolls', k),
                place = kind => {
                    const loot = kind === TILE_TYPE_HEAL && lootRng() * 100 < TILES.lootChance,
                        made = loot ? TILE_TYPE_LOOT : kind;
                    for (let tries = 0; tries < 50; tries++) {
                        const { x, y } = cells[Math.floor(rng() * cells.length)];
                        const kk = game.key(x, y);
                        if (game.tiles.has(kk) || game.pieceAt(x, y)) continue;
                        game.tiles.set(kk, game.makeTile(x, y, made, TILES[made + 'Type'], rollRng));
                        return;
                    }
                };
            for (let i = 0; i < TILES.healPerQuad; i++) place(TILE_TYPE_HEAL);
            for (let i = 0; i < TILES.harmPerQuad; i++) place(TILE_TYPE_HARM);
        },
        
        // A quadrant's solid and hole tiles, once: the walls on its side of its borders,
        // then a clump of solidMin to solidMax solid tiles, then a clump of holeMin to
        // holeMax holes, which may land on (replace) solid tiles.
        generateTerrain: function(qx, qy) {
            const k = qx + ',' + qy;
            if (this.terrainQuads.has(k)) return;
            this.terrainQuads.add(k);
            const cells = pkg.GRID.chunkCells(qx, qy),
                rng = this.game.rngFor('terrain', k);
            
            // A wall sits on the side of the quadrant whose key comes first in the border's
            // key, so it's placed when that quadrant is made.
            for (const [i, j] of pkg.GRID.chunkNeighbours(qx, qy)) {
                const bk = ProximityTileGenerator.borderKey(k, i + ',' + j), wall = this.borderWall(bk);
                if (wall && bk.startsWith(k + '|')) this.placeWall(cells, i, j, wall);
            }
            this.placeClump(cells, TILE_TYPE_SOLID, TILES.solidMin, TILES.solidMax, [], rng);
            this.placeClump(cells, TILE_TYPE_HOLE, TILES.holeMin, TILES.holeMax, [TILE_TYPE_SOLID], rng);
        },
        
        // A border as the seed makes it, on its own: a wall {door, hole, start} or null. The
        // wall's door is doorMin to doorMax cells, hole says it's made of holes, and start
        // (0 to 1) says where along the border the door goes.
        seededBorder: function(bk) {
            const rng = this.game.rngFor('border', bk);
            if (rng() * 100 >= TILES.wallChance) return null;
            return {
                door:TILES.doorMin + Math.floor(rng() * (TILES.doorMax - TILES.doorMin + 1)),
                hole:rng() * 100 < TILES.wallHoleChance,
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
                        const all = ProximityTileGenerator.bordersOf(q).sort();
                        if (all[0] === bk && all.every(b => this.seededBorder(b)?.door === 0)) wall.door = 1;
                    }
                }
                this.borders.set(bk, wall);
            }
            return this.borders.get(bk);
        },
        
        // A wall along the border between a quadrant (its cells) and its neighbour (i, j),
        // on the quadrant's own side: every cell touching the neighbour, except a door in
        // the middle (not at a corner, where another wall may meet it). Some walls are holes
        // rather than solid tiles. Cells with a tile or a piece already are left as they are.
        placeWall: function(cells, i, j, wall) {
            const game = this.game,
                G = pkg.GRID,
                middle = cs => {
                    let sx = 0, sy = 0;
                    for (const c of cs) {
                        const [x, y] = G.center(c.x, c.y);
                        sx += x; sy += y;
                    }
                    return [sx / cs.length, sy / cs.length];
                },
                [ax, ay] = middle(cells), [bx, by] = middle(G.chunkCells(i, j)),
                along = c => {const [x, y] = G.center(c.x, c.y); return (x - ax) * (ay - by) + (y - ay) * (bx - ax);},
                border = cells.filter(c => G.dirs.some(([dx, dy]) => G.chunkKey(c.x + dx, c.y + dy) === i + ',' + j))
                    .sort((a, b) => along(a) - along(b)),
                inner = border.length > 2 ? border.slice(1, -1) : border,
                width = Math.min(inner.length, wall.door),
                start = Math.floor(wall.start * (inner.length - width + 1)),
                door = new Set(inner.slice(start, start + width)),
                kind = wall.hole ? TILE_TYPE_HOLE : TILE_TYPE_SOLID;
            for (const c of border) {
                if (!door.has(c) && !game.tiles.has(game.key(c.x, c.y)) && !game.pieceAt(c.x, c.y)) {
                    game.tiles.set(game.key(c.x, c.y), game.makeTile(c.x, c.y, kind, wall.hole ? TILES.wallHole : TILES.wallSolid));
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
                game.tiles.set(game.key(x, y), game.makeTile(x, y, kind, kind === TILE_TYPE_HOLE ? TILES.clumpHole : TILES.clumpSolid));
                edge.delete(game.key(x, y));
                for (const [dx, dy] of pkg.GRID.dirs) {
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
