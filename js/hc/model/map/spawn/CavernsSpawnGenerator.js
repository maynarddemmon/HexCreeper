/*  The "caverns" spawn generator, for the caverns tile generator (or any with regionAt and
    makeRegion): enemies wait in the caverns and tunnels. The first time one of your pieces
    goes into a cavern or tunnel (not the one you start in), there's a chance a band of
    enemies is there: cavernSpawnChance or tunnelSpawnChance to start with, then going up
    or down by its modifier each time (...OnSuccess after a band spawns, ...OnFailure after
    none does), from 0 to 100. What spawns is picked from challengeTable by how much of a
    challenge it should be, enemyChallenge, a formula of
        level    your highest piece level
        levels   your pieces' levels, all together
        distance how far from the start (in steps) the piece that went in is
        size     how many cells the cavern or tunnel has
    rounded to a whole number. It spawns where you can't see, as far from the piece that
    went in as it can (else as far from your pieces as it can), clear of your pieces. */
(pkg => {
    'use strict';
    
    const {
        attrs:{num, expr, tiers, evaluate, pickTier},
        hexDist
    } = pkg,
        CHALLENGE_VARS = ['level', 'levels', 'distance', 'size'],
        KINDS = ['cavern', 'tunnel'],
        // The enemies and groups a table can name
        enemyOptions = () => [...pkg.enemies.list(), ...pkg.enemyGroups.list()].map(e => ({value:e.id, label:e.name}));
    
    pkg.CavernsSpawnGenerator = new JS.Class('CavernsSpawnGenerator', pkg.SpawnGenerator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[
                num('cavernSpawnChance', 40, 0, 100),                  // the chance a band is in a cavern, to start with
                num('tunnelSpawnChance', 15, 0, 100),                  // and in a tunnel
                num('cavernSpawnChanceModifierOnSuccess', -10, -100, 100), // how the chance changes after a band spawns in a cavern
                num('cavernSpawnChanceModifierOnFailure', 10, -100, 100),  // or after none does
                num('tunnelSpawnChanceModifierOnSuccess', -5, -100, 100),  // and in a tunnel
                num('tunnelSpawnChanceModifierOnFailure', 5, -100, 100),
                expr('enemyChallenge', 'level + floor(levels / 5) + floor(distance / 300) + floor(size / 100)', CHALLENGE_VARS),
                tiers('challengeTable', [
                    {min:0,  max:2,  table:{goblin:100}},
                    {min:3,  max:4,  table:{goblin:50, goblin_pair:50}},
                    {min:5,  max:6,  table:{goblin:10, goblin_pair:90}},
                    {min:7,  max:8,  table:{goblin:10, goblin_pair:40, goblin_trio:50}},
                    {min:9,  max:12, table:{goblin_pair:10, goblin_trio:40, goblin_pack:50}},
                    {min:13, max:16, table:{goblin_trio:10, goblin_pack:40, goblin_horde:50}},
                    {min:17,         table:{goblin_pack:10, goblin_horde:90}}
                ], enemyOptions)
            ]
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.callSuper(game, attrs);
            this.chance = {cavern:this.attrs.cavernSpawnChance, tunnel:this.attrs.tunnelSpawnChance};
            this.entered = new Set(); // the ids of the caverns and tunnels your pieces have been in
        },
        
        // Methods /////////////////////////////////////////////////////////////
        exportState: function() {
            return {chance:{...this.chance}, entered:[...this.entered]};
        },
        
        importState: function(state) {
            for (const kind of KINDS) {
                const c = state?.chance?.[kind];
                if (Number.isFinite(c)) this.chance[kind] = Math.min(100, Math.max(0, c));
            }
            if (Array.isArray(state?.entered)) this.entered = new Set(state.entered.filter(id => typeof id === 'string'));
        },
        
        piecesMoved: function() {
            const tg = this.game.tileGenerator;
            if (tg.regionAt) {
                for (const p of this.game.piecesOf('player')) {
                    const region = tg.regionAt(p.x, p.y);
                    if (region && !region.start && !this.entered.has(region.id)) {
                        this.entered.add(region.id);
                        this.roll(region, p);
                    }
                }
            }
        },
        
        /*  Piece p has gone into region (see regionAt) for the first time: whether a band is
            there, and what it is. Returns the pieces spawned, or null. */
        roll: function(region, p) {
            const game = this.game,
                a = this.attrs,
                kind = region.kind,
                rng = game.rngFor('cave-spawn', region.id);
            let pieces = null;
            if (rng() * 100 < this.chance[kind]) {
                const challenge = Math.round(evaluate(a.enemyChallenge, CHALLENGE_VARS, {
                        level:Math.max(1, game.maxLevel()),
                        levels:game.totalLevels(),
                        distance:hexDist(p, {x:0, y:0}),
                        size:region.size
                    })),
                    id = Number.isFinite(challenge) ? pickTier(a.challengeTable, challenge, rng) : undefined;
                if (id) {
                    this.game.tileGenerator.makeRegion(region);
                    pieces = this.spawnGroup(id, this.spots(region, p));
                }
            }
            const change = a[kind + 'SpawnChanceModifierOn' + (pieces ? 'Success' : 'Failure')];
            this.chance[kind] = Math.min(100, Math.max(0, this.chance[kind] + change));
            return pieces;
        },
        
        /*  Where in region a band may go, best first: cells you can't see, farthest from
            piece p first; then the rest, farthest from your pieces first. */
        spots: function(region, p) {
            const game = this.game,
                sight = game.cellsInSight(),
                players = game.piecesOf('player'),
                cells = [...region.cells].map(k => k.split(',').map(Number)),
                fromP = ([x, y]) => hexDist(p, {x, y}),
                fromAll = ([x, y]) => Math.min(...players.map(q => hexDist(q, {x, y}))),
                hidden = sight ? cells.filter(([x, y]) => !sight.has(game.key(x, y))) : [],
                seen = sight ? cells.filter(([x, y]) => sight.has(game.key(x, y))) : cells;
            return [
                ...hidden.sort((c1, c2) => fromP(c2) - fromP(c1)),
                ...seen.sort((c1, c2) => fromAll(c2) - fromAll(c1))
            ];
        }
    });
    pkg.SpawnGenerator.register('caverns', pkg.CavernsSpawnGenerator);
})(hc);
