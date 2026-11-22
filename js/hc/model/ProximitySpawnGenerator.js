/*  The "proximity" spawn generator: enemies arrive around your core. A game starts with
    `initial` lone enemies, and every `spawnEvery` turns a wave comes, sized by your
    strongest piece's rank (and, optionally, the turn): squads shaped as binary trees, each
    set down minDist to maxDist steps from your core, clear of your pieces (SPAWN.clearance).
    
    Enemy pressure follows the player's strength, not the clock. R = your highest piece
    rank (the same number that sets your moves per turn):
        enemies per wave = pBase + pPerRank x (R - 1)  [+ 1 per pTime turns, if set]
        largest squad    = R + pSquadExtra (capped at maxSquad)
    Losing rank lowers the pressure again. */
(pkg => {
    'use strict';
    
    const {
        cfg:{SPAWN, RANK},
        attrs:{num},
        hexDist
    } = pkg;
    
    pkg.ProximitySpawnGenerator = new JS.Class('ProximitySpawnGenerator', pkg.SpawnGenerator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[
                num('spawnEvery', 3, 1, 50),  // a wave every this many turns
                num('pBase', 1, 0, 50),       // enemies per wave at rank 1
                num('pPerRank', 2, 0, 20),    // extra enemies per wave for each rank above 1
                num('pSquadExtra', 1, 0, 10), // largest squad = rank + this
                num('maxSquad', 16, 1, 31),   // but never larger than this
                num('pTime', 0, 0, 500),      // optional slow clock ramp: +1 enemy per wave every this many turns (0: off)
                num('initial', 3, 0, 50),     // enemies at the start
                num('minDist', 6, 2, 40),     // the ring they spawn in: steps from your core
                num('maxDist', 9, 2, 40)
            ]
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.callSuper(game, attrs);
            this.attrs.maxDist = Math.max(this.attrs.minDist, this.attrs.maxDist);
        },
        
        // Methods /////////////////////////////////////////////////////////////
        // The starting enemies come from the map's generator, so they're the same for a seed.
        start: function() {
            const rng = this.game.rngFor('enemies');
            for (let i = 0; i < this.attrs.initial; i++) this.spawnEnemy(rng);
        },
        
        turnEnded: function() {
            if (this.game.turn % this.attrs.spawnEvery === 0) this.spawnWave();
        },
        
        // How many enemies a wave brings now.
        waveSize: function() {
            const game = this.game,
                {pBase, pPerRank, pTime} = this.attrs,
                R = Math.max(1, game.maxRank()),
                clock = pTime ? Math.floor(game.turn / pTime) : 0;
            return Math.max(0, pBase + pPerRank * (R - 1) + clock);
        },
        // The largest squad a wave brings now.
        squadCap: function() {
            const R = Math.max(1, this.game.maxRank());
            return Math.max(1, Math.min(this.attrs.maxSquad, R + this.attrs.pSquadExtra));
        },
        
        // Split the wave's enemies into squads of (cap or cap-1) pieces.
        spawnWave: function() {
            let left = this.waveSize();
            const cap = this.squadCap();
            while (left > 0) {
                const size = Math.min(left, Math.max(1, cap - Math.floor(Math.random() * 2)));
                this.spawnSquad(size);
                left -= size;
            }
        },
        
        // Spawn a squad of `size` enemies shaped as a binary tree (piece i links to
        // piece floor((i-1)/2)), so a squad of 3 is rank 2, 7 is rank 3, etc.
        spawnSquad: function(size) {
            const game = this.game,
                root = this.spawnEnemy();
            if (!root) return null;
            const players = game.piecesOf('player');
            const nodes = [root];
            for (let i = 1; i < size; i++) {
                const parent = nodes[Math.floor((i - 1) / 2)];
                const spots = pkg.GRID.dirs.map(([dx, dy]) => ({ x: parent.x + dx, y: parent.y + dy }))
                    .filter(q => game.isOpen(q.x, q.y) && !game.pieceAt(q.x, q.y) && !game.isHarm(q.x, q.y)
                        && !players.some(p => hexDist(p, q) < 2));
                if (!spots.length) break;
                const q = spots[Math.floor(Math.random() * spots.length)];
                nodes.push(game.addPiece('core', 'enemy', q.x, q.y, parent.id));
                game.fx(q.x, q.y, '', '--enemy', { spawn: true });
            }
            game.recomputeRanks();
            for (const n of nodes) n.hp = n.maxHp;
            return root;
        },
        
        // A lone enemy. rng picks where: Math.random for waves, the map's generator at the start.
        spawnEnemy: function(rng = Math.random) {
            const game = this.game,
                core = game.getPlayerCore();
            if (core) {
                const players = game.piecesOf('player');
                for (let tries = 0; tries < 60; tries++) {
                    const {minDist, maxDist} = this.attrs,
                        d = minDist + Math.floor(rng() * (maxDist - minDist + 1)),
                        {x, y} = pkg.GRID.ring(core.x, core.y, d, rng);
                    if (!game.isOpen(x, y) || game.pieceAt(x, y) || game.isHarm(x, y)) continue;
                    if (players.some(p => hexDist(p, { x, y }) < SPAWN.clearance)) continue;
                    const p = game.addPiece('core', 'enemy', x, y);
                    p.hp = p.maxHp = RANK.enemyHpPer * RANK.base;
                    game.fx(x, y, '', '--enemy', { spawn: true });
                    return p;
                }
            }
        }
    });
    pkg.SpawnGenerator.register('proximity', pkg.ProximitySpawnGenerator);
})(hc);
