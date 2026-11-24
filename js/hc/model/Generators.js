/*  A map's generators (map components: see MapComponent.js): its tile generator, which
    chooses and places its tiles, and its spawn generator, which chooses and places its
    enemies (so far there's one of each, "proximity": see ProximityTileGenerator.js and
    ProximitySpawnGenerator.js). The game calls them at the points below. */
(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        NOOP = myt.NOOP,
        
        MapComponent = pkg.MapComponent;
    
    pkg.TileGenerator = new JSClass('TileGenerator', MapComponent, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'tile generator', // what they are, for error messages
            types:{}, // name -> TileGenerator subclass (see register)
            
            /*  A set of subtypes (solids, holes, heals...), as the options of a choice or
                table attr. They're known once init.json5 has loaded. */
            optionsOf: subtypes => () => subtypes.list().map(s => ({value:s.id, label:s.name}))
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  A new game: the tiles there from the start. Your core is in place. */
        start: NOOP, // function() {},
        
        /*  Your pieces have moved (or one was placed): the tiles they now need. */
        piecesMoved: NOOP // function() {}
    });
    
    const {hexDist} = pkg,
        GROUP_SPREAD = 3, // how far from the first a group's other trees may spawn (see spawnGroup)
        SPAWN_CLEAR = 2;  // how near your pieces an enemy may spawn (see spawnGroup)
    
    pkg.SpawnGenerator = new JSClass('SpawnGenerator', MapComponent, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'spawn generator',
            types:{} // name -> SpawnGenerator subclass (see register)
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  A new game: the enemies there from the start. Your core and the starting tiles
            are in place. */
        start: NOOP, // function() {},
        
        /*  A new turn has begun (the enemies have moved and the turn count gone up). */
        turnEnded: NOOP, // function() {}
        
        /*  Spawns enemy or group id (see Enemies.js) at the first of spots ([[x, y], ...],
            tried in turn) it fits at: its first tree's top piece there, each piece below on
            a free cell next to the one it's linked to, and each other tree's top piece on
            the nearest free cell within GROUP_SPREAD of the first. A free cell is open,
            empty, without a harm tile, and at least SPAWN_CLEAR from your pieces. Its pieces
            carry the enemy's id (piece.enemyId) and a band they share (piece.band, see
            Game.newBand). Returns them, or null if it fits at none of the spots. */
        spawnGroup: function(id, spots) {
            const game = this.game,
                trees = pkg.enemyTrees(id);
            if (!trees) return null;
            const players = game.piecesOf('player'),
                // Where each piece would go, [[node, x, y, parent's index or -1], ...], with
                // the first top piece at (x, y); or null if it doesn't fit.
                layOut = (x, y) => {
                    const used = new Set(),
                        out = [],
                        free = (cx, cy) => game.isOpen(cx, cy) && !game.pieceAt(cx, cy) && !game.isHarm(cx, cy) &&
                            !used.has(game.key(cx, cy)) && !players.some(p => hexDist(p, {x:cx, y:cy}) < SPAWN_CLEAR),
                        put = (node, cx, cy, parent) => {
                            used.add(game.key(cx, cy));
                            out.push([node, cx, cy, parent]);
                            const me = out.length - 1;
                            return node.below.every(kid => {
                                const c = pkg.hex.dirs.map(([dx, dy]) => [cx + dx, cy + dy]).find(([nx, ny]) => free(nx, ny));
                                return c && put(kid, ...c, me);
                            });
                        };
                    for (const [t, tree] of trees.entries()) {
                        const at = t === 0 ? (free(x, y) ? [x, y] : null) :
                            pkg.hex.disk(x, y, GROUP_SPREAD)
                                .sort((a, b) => hexDist(a, {x, y}) - hexDist(b, {x, y}))
                                .map(c => [c.x, c.y])
                                .find(([cx, cy]) => free(cx, cy));
                        if (!at || !put(tree, ...at, -1)) return null;
                    }
                    return out;
                };
            for (const [x, y] of spots) {
                const layout = layOut(x, y);
                if (layout) {
                    const band = game.newBand(),
                        pieces = [];
                    for (const [node, px, py, parent] of layout) {
                        const p = game.addPiece('core', 'enemy', px, py, parent < 0 ? null : pieces[parent].id);
                        p.enemyId = node.enemyId;
                        p.band = band;
                        pieces.push(p);
                        game.fx(px, py, '', '--enemy', {spawn:true});
                    }
                    game.recomputeRanks();
                    for (const p of pieces) p.hp = p.maxHp;
                    return pieces;
                }
            }
            return null;
        }
    });
})(hc);
