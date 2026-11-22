/*  The "proximity" spawn generator: enemies arrive around your core. A game starts with
    SPAWN.initial lone enemies, and every SPAWN.every turns a wave comes, sized by your
    strongest piece's rank (and, optionally, the turn): squads shaped as binary trees, each
    set down SPAWN.minDist to SPAWN.maxDist steps from your core, clear of your pieces. */
(pkg => {
    'use strict';
    
    const {
        cfg:{SPAWN, PRESSURE, ENEMY, RANK},
        hexDist
    } = pkg;
    
    pkg.ProximitySpawnGenerator = new JS.Class('ProximitySpawnGenerator', pkg.SpawnGenerator, {
        // Methods /////////////////////////////////////////////////////////////
        // The starting enemies come from the map's generator, so they're the same for a seed.
        start: function() {
            const rng = this.game.rngFor('enemies');
            for (let i = 0; i < SPAWN.initial; i++) this.spawnEnemy(rng);
        },
        
        turnEnded: function() {
            if (this.game.turn % SPAWN.every === 0) this.spawnWave();
        },
        
        // How many enemies a wave brings now.
        waveSize: function() {
            const game = this.game,
                R = Math.max(1, game.maxRank()),
                clock = PRESSURE.timeEvery ? Math.floor(game.turn / PRESSURE.timeEvery) : 0;
            return Math.max(0, PRESSURE.base + PRESSURE.perRank * (R - 1) + clock);
        },
        // The largest squad a wave brings now.
        squadCap: function() {
            const R = Math.max(1, this.game.maxRank());
            return Math.max(1, Math.min(ENEMY.maxSquad, R + PRESSURE.squadExtra));
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
                    const d = SPAWN.minDist + Math.floor(rng() * (SPAWN.maxDist - SPAWN.minDist + 1)),
                        {x, y} = pkg.GRID.ring(core.x, core.y, d, rng);
                    if (!game.isOpen(x, y) || game.pieceAt(x, y) || game.isHarm(x, y)) continue;
                    if (players.some(p => hexDist(p, { x, y }) < SPAWN.clearance)) continue;
                    const p = game.addPiece('core', 'enemy', x, y);
                    p.hp = p.maxHp = ENEMY.hpPer * RANK.base;
                    game.fx(x, y, '', '--enemy', { spawn: true });
                    return p;
                }
            }
        }
    });
    pkg.SpawnGenerator.register('proximity', pkg.ProximitySpawnGenerator);
})(hc);
