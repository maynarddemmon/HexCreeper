/*  A combat simulator, for balancing: fights between a hero and enemy groups, played out
    by the real game (its rules, profiles, action points and squad AI), with nothing drawn.
    Only loaded for development: index.html?dev, or tools/sim.mjs from the command line.
    
    hc.simulate(opts, callback) calls back with one row per enemy tier or group:
        {name, fights, wins, losses, timeouts, winRate (%), turns (on average), hpLeft
        (your HP at the end of the fights you won, on average, and in % of max), dealt and
        taken (damage, on average), hits and misses (yours and theirs, in %), groups
        ({id:count}: what each tier picked)}.
    opts (all optional):
        map        the map whose rules, enemy AI and challengeTable to use ("caverns")
        level      your hero's level (1)
        tiers      challenges to pick a group for each fight from, in the map's
                   challengeTable (e.g. [0, 3, 5]); or
        groups     enemy or group ids to fight (e.g. ["goblin", "goblin_pair"]); if
                   neither is given, every tier's lowest challenge
        fights     fights for each (200)
        distance   how far off the enemies start (4: in sight, so both sides get initiative)
        maxTurns   a fight not over by then is a timeout (100)
        seed       for the fights' rolls and picks (1); the AI also uses Math.random, so
                   runs differ a little
        rules      rules to change, {id:value}, over the map's (e.g. {hitChance:'...'})
    
    The hero is played by a simple bot: it attacks the enemy next to it with the least HP,
    else steps toward the nearest enemy, while it has the points, then ends its turn. A
    better player would do better, so these numbers are on the hard side. The arena is open
    floor: no tiles, no spawning, and no levelling in the fight beyond what kills give. */
(pkg => {
    'use strict';
    
    const {hexDist, attrs:{pickTier}} = pkg,
        
        DEFAULTS = {map:'caverns', level:1, fights:200, distance:4, maxTurns:100, seed:1, rules:{}},
        
        // The groups to fight, [{name, pick(rng)}], from opts and the map's challengeTable.
        opponents = (opts, table) => {
            if (opts.groups) return opts.groups.map(id => ({name:id, pick:() => id}));
            const tiers = opts.tiers ?? table.map(t => t.min);
            return tiers.map(n => ({name:'tier ' + n, pick:rng => pickTier(table, n, rng)}));
        },
        
        /*  One fight: a new game with only your hero, at level, and group id spawned
            distance off. Returns {outcome:'won'|'lost'|'timeout', turns, hp, maxHp, tally}. */
        fight = (gameMap, id, opts, seed) => {
            const game = new pkg.Game();
            game.gameMap = gameMap;
            game.seed = seed;
            game.reset();
            game.rules = {...game.rules, ...pkg.settings.cleanRules(opts.rules, 'Simulation')};
            // An empty arena: no tiles, nothing spawning, nothing new revealed.
            game.tiles.clear();
            for (const e of game.piecesOf('enemy')) game.removePiece(e);
            const tiles = game.tileGenerator, spawns = game.spawnGenerator;
            tiles.piecesMoved = spawns.piecesMoved = spawns.turnEnded = () => {};
            game.revealTiles = () => {};
            // The combat log, tallied rather than kept
            const tally = {dealt:0, taken:0, hits:0, misses:0, theirHits:0, theirMisses:0};
            game.logCombat = e => {
                const yours = e.a?.owner === 'player';
                if (e.kind === 'hit' || e.kind === 'soak') {
                    tally[yours ? 'hits' : 'theirHits']++;
                    tally[yours ? 'dealt' : 'taken'] += e.dmg ?? 0;
                } else if (e.kind === 'miss') {
                    tally[yours ? 'misses' : 'theirMisses']++;
                }
            };
            
            const hero = game.getPlayerCore();
            hero.level = opts.level;
            hero.maxHp = hero.hp = game.maxHpOf(hero);
            hero.ap = game.actionCost(hero);
            if (!spawns.spawnGroup(id, [[opts.distance, 0]])) throw new Error('Simulation: cannot spawn ' + id);
            game.recomputeRanks();
            game.initiativeTurn = null;   // (the start's enemies, removed, may have had it)
            game.noticeEnemies();
            
            while (!game.over && game.piecesOf('enemy').length && game.turn <= opts.maxTurns) {
                const turn = game.turn;
                while (!game.over && game.turn === turn && game.canMove(hero) && game.piecesOf('enemy').length) {
                    if (!heroAct(game, hero)) break;
                }
                if (!game.over && game.turn === turn) game.playerWait();
            }
            return {
                outcome:game.over ? 'lost' : game.piecesOf('enemy').length ? 'timeout' : 'won',
                turns:game.turn, hp:Math.max(0, hero.hp), maxHp:hero.maxHp, tally
            };
        },
        
        /*  The hero bot's next action: attack the weakest enemy next to it, else step
            toward the nearest. Returns whether it did something. */
        heroAct = (game, hero) => {
            const moves = game.legalMoves(hero, 'fixed'),
                // (a move's hits: [{attacker, target}])
                attacks = moves.filter(m => m.attack && m.hits.some(h => h.target.owner === 'enemy')),
                hpOf = m => Math.min(...m.hits.map(h => h.target.hp ?? Infinity));
            if (attacks.length) {
                const m = attacks.reduce((a, b) => hpOf(b) < hpOf(a) ? b : a);
                return game.playerAct(hero, m.x, m.y, 'fixed');
            }
            const enemies = game.piecesOf('enemy'),
                near = c => Math.min(...enemies.map(e => hexDist(c, e))),
                now = near(hero),
                step = moves.filter(m => !m.attack).reduce((a, b) => !a || near(b) < near(a) ? b : a, null);
            return !!step && near(step) < now && game.playerAct(hero, step.x, step.y, 'fixed');
        },
        
        average = (rows, f) => rows.length ? rows.reduce((n, r) => n + f(r), 0) / rows.length : 0,
        round = (n, places=1) => Math.round(n * 10 ** places) / 10 ** places,
        percent = (a, b) => a + b ? round(100 * a / (a + b)) : 0;
    
    pkg.simulate = (options, callback) => {
        const opts = {...DEFAULTS, ...options};
        pkg.maps.loadMap(opts.map, map => {
            if (!map) throw new Error('Simulation: unknown map ' + opts.map);
            const spawnAttrs = pkg.SpawnGenerator.make(map.spawnGenerator.type, new pkg.Game(), map.spawnGenerator.attrs).attrs,
                table = spawnAttrs.challengeTable,
                // The map's rules and enemy AI, in an open arena (see fight)
                gameMap = {id:'simulation', name:'Simulation', rules:map.rules, objectives:[],
                    tileGenerator:pkg.Game.NO_MAP.tileGenerator, spawnGenerator:pkg.Game.NO_MAP.spawnGenerator, enemyAI:map.enemyAI},
                rng = pkg.makeRng(opts.seed);
            if (!opts.groups && !table) throw new Error('Simulation: map ' + opts.map + ' has no challengeTable; give groups');
            const rows = opponents(opts, table).map(({name, pick}) => {
                const results = [], groups = {};
                for (let i = 0; i < opts.fights; i++) {
                    const id = pick(rng);
                    groups[id] = (groups[id] ?? 0) + 1;
                    results.push(fight(gameMap, id, opts, Math.floor(rng() * 1e9)));
                }
                const won = results.filter(r => r.outcome === 'won'),
                    sum = k => results.reduce((n, r) => n + r.tally[k], 0);
                return {
                    name, fights:results.length,
                    wins:won.length,
                    losses:results.filter(r => r.outcome === 'lost').length,
                    timeouts:results.filter(r => r.outcome === 'timeout').length,
                    winRate:round(100 * won.length / results.length),
                    turns:round(average(results, r => r.turns)),
                    hpLeft:round(average(won, r => r.hp)),
                    hpLeftPct:round(average(won, r => 100 * r.hp / r.maxHp)),
                    dealt:round(sum('dealt') / results.length),
                    taken:round(sum('taken') / results.length),
                    hits:percent(sum('hits'), sum('misses')),
                    theirHits:percent(sum('theirHits'), sum('theirMisses')),
                    groups
                };
            });
            callback(rows);
        });
    };
})(hc);
