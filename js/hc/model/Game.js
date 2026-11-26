/*  The game state and rules: pieces and link trees, ranks, moves and attacks, tiles and
    heals. Goals are in Goals.js, a module it includes; the map's tiles, enemies and enemy
    turns come from its components (its generators, Generators.js, and its enemy AI,
    EnemyAI.js). */
(pkg => {
    'use strict';
    
    const {
        cfg:{
            WORLD_LIMIT, VISION, ANIM
        },
        TILE_TYPE_FLOOR, TILE_TYPE_HOLE, TILE_TYPE_SOLID, FIXTURE_TYPES,
        hex:{keysNear, lineCellInto},
        hexDist, PIECE_TYPES
    } = pkg,
        
        // Cells along the two sides of a line of sight (see canSee), filled in each time.
        LEFT = [0, 0],
        RIGHT = [0, 0];
    
    // ---------------------------------------------------------------------------
    // Game state
    // ---------------------------------------------------------------------------
    pkg.Game = new JS.Class('Game', {
        include:[pkg.Movement, pkg.Navigation, pkg.Formation, pkg.Combat, pkg.Goals, pkg.Fixtures, pkg.Effects],
        
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            // The components a game is made with when it isn't in a map (one made in a
            // test, say), with every attr at its default.
            NO_MAP:{
                tileGenerator:{type:'proximity', attrs:{}},
                spawnGenerator:{type:'proximity', attrs:{}},
                enemyAI:{type:'squad', attrs:{}}
            }
        },
        
        initialize: function() {
            this.gameMap = null; // {id, name, rules, tileGenerator, spawnGenerator, enemyAI, objectives}: the map being played, set by the App
            this.seed = null;  // the seed the map is made from, set before reset (or random)
            this.reset();
        },
        
        reset: function() {
            if (!Number.isInteger(this.seed)) this.seed = pkg.randomSeed();
            this.turn = 1;
            this.nextId = 1;
            this.nextBand = 1;               // for enemies spawned together (see newBand)
            this.pieces = new Map();         // id -> piece
            this.board = new Map();          // "x,y" -> id
            this.gold = 0;                   // gold you have to spend (only loot gives it)
            this.over = false;
            this.outcome = null;             // once over: 'won' or 'lost'
            this.lostBy = null;              // when lost: the index of the objective that lost it, or null for the core
            this.kills = 0;                  // enemy pieces destroyed
            this.combatRolls = 0;            // rolls made in combat, for the next (see Combat.js)
            this.combatLog = [];             // what happened in combat (see Combat.js; not saved)
            this.piecesLost = 0;             // player pieces destroyed
            this.piecesPlaced = 0;
            this.lootOpened = 0;             // loot fixtures emptied
            this.lootTaken = 0;              // gold taken from loot, spent or not
            this.objectives = this.getMapObjectives().map(() => ({value:false, locked:false, progress:''})); // state of each of the map's goals and penalties
            this.effects = [];               // transient visuals (floating text, flashes)
            this.pendingKills = [];          // kills of this action, their xp not given yet (see Combat.awardKills)
            this.clearAnimation();
            this.rules = pkg.settings.resolveRules(this.gameMap?.rules, 'Game'); // the map's rules, the rest at their defaults (see Settings.js)
            // The map's components (see MapComponent.js), with its attrs for them.
            const {tileGenerator:tiles, spawnGenerator:spawns, enemyAI:ai} = this.gameMap ?? pkg.Game.NO_MAP;
            this.tileGenerator = pkg.TileGenerator.make(tiles.type, this, tiles.attrs);   // places the map's tiles
            this.spawnGenerator = pkg.SpawnGenerator.make(spawns.type, this, spawns.attrs); // and its enemies
            this.enemyAI = pkg.EnemyAI.make(ai.type, this, ai.attrs);                       // which it plays
            this.tiles = new Map();          // "x,y" -> {x, y, kind:"solid" | "hole" | "floor", subtype, ...}: the terrain, plain floor where there's none (see makeTile)
            this.fixtures = new Map();       // "x,y" -> {x, y, type:"heal" | "harm" | "loot", subtype, ...}: what's on open floor (see Fixtures.js)
            this.seenCells = new Set();      // keys of cells that have been in sight (fog of war)
            this.initiativeTurn = null;      // the turn your pieces last got initiative (see noticeEnemies)
            this.moveMode = this.rules.moveMode; // how the player's pieces move (see Movement.js)
            const core = this.addPiece('core', 'player', 0, 0);
            this.playerCoreId = core.id;
            this.recomputeRanks();
            core.hp = core.maxHp;
            core.ap = this.actionCost(core); // so it can act on the first turn
            this.selectedId = core.id;
            this.corePath = [[0, 0]];       // the cells the core has been on, in order (the golden path: see extendCorePath)
            this.tileGenerator.start();
            this.revealFixtures();
            this.spawnGenerator.start();
            this.noticeEnemies();
            this.evaluateObjectives();
        },
        
        /*  A generator for one part of the map, seeded from the game's seed and that part's
            name, so each part comes out the same for a seed whatever order the parts are
            made in (e.g. which way the player explores). Only the map is made this way:
            enemy waves, the AI and everything else during play use Math.random. */
        rngFor: function(...parts) {
            return pkg.makeRng(pkg.hashString(this.seed + '|' + parts.join('|')));
        },
        
        // ---- Saving ----
        // Everything needed to carry on with this game later, as plain data for JSON.
        // Effects aren't kept, and the board and sight are worked out again on import.
        exportToObj: function() {
            return {
                turn:this.turn,
                nextId:this.nextId,
                seed:this.seed,
                gold:this.gold,
                over:this.over,
                outcome:this.outcome,
                lostBy:this.lostBy,
                kills:this.kills,
                combatRolls:this.combatRolls,
                piecesLost:this.piecesLost,
                piecesPlaced:this.piecesPlaced,
                lootOpened:this.lootOpened,
                lootTaken:this.lootTaken,
                objectives:this.objectives.map(s => ({...s})),
                pieces:[...this.pieces.values()].map(p => ({...p})),
                tiles:[...this.tiles.values()].map(t => ({...t})),
                fixtures:[...this.fixtures.values()].map(f => ({...f, ...f.state ? {state:{...f.state}} : {}})),
                tileGenerator:{type:this.tileGenerator.type, attrs:{...this.tileGenerator.attrs}, state:this.tileGenerator.exportState()},
                spawnGenerator:{type:this.spawnGenerator.type, attrs:{...this.spawnGenerator.attrs}, state:this.spawnGenerator.exportState()},
                enemyAI:{type:this.enemyAI.type, attrs:{...this.enemyAI.attrs}, state:this.enemyAI.exportState()},
                seenCells:[...this.seenCells],
                initiativeTurn:this.initiativeTurn,
                moveMode:this.moveMode,
                playerCoreId:this.playerCoreId,
                selectedId:this.selectedId,
                corePath:this.corePath.map(c => [...c]),
                rules:{...this.rules},
                gameMap:this.gameMap
            };
        },
        
        // Replaces this game with one from exportToObj(). Throws, leaving this game as it
        // was, if the data is malformed.
        importFromObj: function(o) {
            const isNum = v => Number.isFinite(v),
                isArr = Array.isArray;
            if (!isNum(o?.turn) || !isNum(o.nextId) || !isNum(o.gold) ||
                !isNum(o.kills) || !isNum(o.piecesLost) || !isNum(o.piecesPlaced) || !isNum(o.lootOpened) || !isNum(o.lootTaken) ||
                !pkg.isObj(o.rules) ||
                ![o.pieces, o.tiles, o.seenCells, o.corePath].every(isArr) ||
                !o.pieces.every(p => isNum(p?.id) && isNum(p.x) && isNum(p.y) && PIECE_TYPES[p.type] && isNum(p.ap) && isArr(p.effects) && isNum(p.statPoints?.available) && isNum(p.statPoints.spent) && typeof p.species === 'string' && typeof p.background === 'string') ||
                !o.tiles.every(t => isNum(t?.x) && isNum(t.y) && typeof t.kind === 'string') ||
                !isArr(o.fixtures) || !o.fixtures.every(f => isNum(f?.x) && isNum(f.y) && FIXTURE_TYPES.includes(f.type))
            ) throw new Error('Malformed game data');
            const rules = pkg.settings.resolveRules(o.rules, 'Saved game'),
                objectives = o.gameMap?.objectives ?? [];
            try {
                for (const obj of objectives) {
                    pkg.goals.compile(obj.expression);
                    pkg.goals.compileTemplate(obj.progress ?? '');
                }
            } catch (err) {
                throw new Error('Malformed goal: ' + err.message, {cause:err});
            }
            // The map's components, with what they keep (made before anything here changes).
            let tileGenerator, spawnGenerator, enemyAI;
            try {
                const make = (Base, c) => {
                    const component = Base.make(c?.type, this, c.attrs);
                    component.importState(c.state);
                    return component;
                };
                tileGenerator = make(pkg.TileGenerator, o.tileGenerator);
                spawnGenerator = make(pkg.SpawnGenerator, o.spawnGenerator);
                enemyAI = make(pkg.EnemyAI, o.enemyAI);
            } catch (err) {
                throw new Error('Malformed game data: ' + err.message, {cause:err});
            }
            
            this.turn = o.turn;
            this.nextId = o.nextId;
            this.seed = Number.isInteger(o.seed) ? o.seed : null;
            this.gold = o.gold;
            this.over = !!o.over;
            this.outcome = this.over ? (o.outcome === 'won' ? 'won' : 'lost') : null;
            this.lostBy = Number.isInteger(o.lostBy) ? o.lostBy : null;
            this.kills = o.kills;
            this.combatRolls = Number.isInteger(o.combatRolls) ? o.combatRolls : 0;
            this.combatLog = [];
            this.piecesLost = o.piecesLost;
            this.piecesPlaced = o.piecesPlaced;
            this.lootOpened = o.lootOpened;
            this.lootTaken = o.lootTaken;
            this.objectives = objectives.map((obj, i) => {
                const s = o.objectives?.[i];
                return {value:!!s?.value, locked:!!s?.locked, progress:typeof s?.progress === 'string' ? s.progress : ''};
            });
            this.effects = [];
            this.pendingKills = [];
            this.clearAnimation();
            this.pieces = new Map();
            this.board = new Map();
            for (const p of o.pieces) {
                const trail = isArr(p.trail) && p.trail.every(c => isArr(c) && c.length === 2 && c.every(Number.isInteger)) ? p.trail : [],
                    piece = {...p, trail, effects:p.effects.map(e => ({...e})), statPoints:{...p.statPoints}};
                // A named enemy's id and band (see newBand), if it has them and they're usable
                if (typeof piece.enemyId !== 'string') delete piece.enemyId;
                if (!Number.isInteger(piece.band)) delete piece.band;
                this.pieces.set(p.id, piece);
                this.board.set(this.key(p.x, p.y), p.id);
            }
            this.nextBand = 1 + Math.max(0, ...[...this.pieces.values()].map(p => p.band ?? 0));
            this.tiles = new Map(o.tiles.map(t => [this.key(t.x, t.y), {...t}]));
            this.fixtures = new Map(o.fixtures.map(f => [this.key(f.x, f.y), {...f, ...f.state ? {state:{...f.state}} : {}}]));
            this.tileGenerator = tileGenerator;
            this.spawnGenerator = spawnGenerator;
            this.enemyAI = enemyAI;
            this.seenCells = new Set(o.seenCells);
            this.initiativeTurn = Number.isInteger(o.initiativeTurn) ? o.initiativeTurn : null;
            this.moveMode = pkg.PLAYER_MOVE_MODES.includes(o.moveMode) ? o.moveMode : 'fixed';
            this.playerCoreId = o.playerCoreId;
            this.selectedId = o.selectedId;
            this.rules = rules;
            this.corePath = [];
            for (const [x, y] of o.corePath) this.extendCorePath(x, y);
            this.gameMap = o.gameMap ?? null;
            this._sightKey = null;
        },
        
        key: function(x, y) { return x + ',' + y; },
        // Can a piece be on (x, y) now? Not past the edge of the world, on a solid or hole
        // tile, or where a fixture is in the way (see Fixtures.fixtureBlocks).
        isOpen: function(x, y) {
            if (Math.abs(x) > WORLD_LIMIT || Math.abs(y) > WORLD_LIMIT) return false;
            const kind = this.tiles.get(this.key(x, y))?.kind;
            return kind !== TILE_TYPE_SOLID && kind !== TILE_TYPE_HOLE && !this.fixtureBlocks(x, y);
        },
        // Solid tiles block movement (and jumps over them); how much they block sight is
        // seeThrough's. Holes don't block sight.
        isSolid: function(x, y) { return this.tiles.get(this.key(x, y))?.kind === TILE_TYPE_SOLID; },
        // Whether nothing can jump over (x, y): a solid, or a fixture in the way.
        blocksJumps: function(x, y) {return this.isSolid(x, y) || this.fixtureBlocks(x, y);},
        
        // ---- Fog of war ----
        // Keys of the cells in sight of a player piece, or null when fog of war is off.
        // Once the game is over, every cell that has been seen counts as in sight, so the
        // board you'd found can be seen at the end (and Render shows every enemy). Cells in sight are added to seenCells, so what's on them stays shown after.
        // Worked out again only when
        // something it depends on changes: piece positions, the tiles (solid tiles only
        // come with new quadrants, which add tiles) or the settings.
        cellsInSight: function() {
            if (!VISION.fog) return null;
            if (this.over) return this.seenCells;
            const players = this.piecesOf('player'),
                sightKey = [this.rules.visionRadius, this.tiles.size, ...players.map(p => this.key(p.x, p.y))].join(';');
            if (sightKey !== this._sightKey) {
                const sight = new Set(),
                    // How much sight gets through each cell, worked out once.
                    throughs = new Map(),
                    {key:numKey} = keysNear(players[0]?.x ?? 0, players[0]?.y ?? 0),
                    through = (x, y) => {
                        const nk = numKey(x, y);
                        let v = throughs.get(nk);
                        if (v === undefined) {
                            v = this.seeThrough(x, y);
                            throughs.set(nk, v);
                        }
                        return v;
                    };
                for (const p of players) {
                    for (const c of pkg.hex.disk(p.x, p.y, this.rules.visionRadius)) {
                        const k = this.key(c.x, c.y);
                        if (!sight.has(k) && this.canSee(p, c, through)) sight.add(k);
                    }
                }
                for (const k of sight) this.seenCells.add(k);
                this._sight = sight;
                this._sightKey = sightKey;
            }
            return this._sight;
        },
        
        // Can a piece at cell a see cell b, within the vision radius? Solids along the line
        // between them shorten the sight past them: what's left of it (the radius less the
        // distance to the solid) is cut to the share the solid lets through (seeThrough).
        // So an opaque solid blocks it; one 50% opaque halves what's left. Along an edge
        // the clearer of the cells on either side counts. The end cells don't count, so
        // solid cells themselves can be seen. through(x, y) is seeThrough, or the same
        // remembered (see cellsInSight).
        canSee: function(a, b, through = (x, y) => this.seeThrough(x, y)) {
            const dist = hexDist(a, b);
            let range = this.rules.visionRadius;
            for (let i = 1; i < dist && range >= dist; i++) {
                lineCellInto(a, b, dist, i, 1, LEFT);
                lineCellInto(a, b, dist, i, -1, RIGHT);
                range = i + (range - i) * Math.max(through(LEFT[0], LEFT[1]), through(RIGHT[0], RIGHT[1]));
            }
            return range >= dist;
        },
        
        // The share of sight that gets through (x, y): 1, or for a solid, 1 less its
        // opacity (Solids.js); none for a solid of an unknown subtype. A fixture there lets
        // through 1 less its opacity of that (Fixtures.fixtureOpacity).
        seeThrough: function(x, y) {
            const tile = this.tiles.get(this.key(x, y)),
                f = this.fixtures.get(this.key(x, y));
            return (tile?.kind === TILE_TYPE_SOLID ? 1 - (pkg.solids.get(tile.subtype)?.opacity ?? 100) / 100 : 1) *
                (f ? 1 - this.fixtureOpacity(f) / 100 : 1);
        },
        
        /*  A number for enemies spawned together, so they can be known as a band: each
            piece of theirs has it (piece.band). */
        newBand: function() {return this.nextBand++;},
        
        /*  A new piece, with the profile profileId (see Combat.giveProfile: an enemy's; if
            not given, a creeper), at full HP. */
        addPiece: function(type, owner, x, y, parentId = null, profileId) {
            const piece = {
                    id:this.nextId++, 
                    type, owner, x, y, parentId,
                    rank:this.rules.rankBase, 
                    trail:[]    // the cells it was on, latest first (see Movement._leaveCell)
                };
            this.giveProfile(piece, profileId);
            this.pieces.set(piece.id, piece);
            this.board.set(this.key(x, y), piece.id);
            return piece;
        },
        
        // Remove a single piece from the board.
        removePiece: function(piece) {
            this.pieces.delete(piece.id);
            this.board.delete(this.key(piece.x, piece.y));
            if (this.selectedId === piece.id) this.selectedId = this.pieces.has(this.playerCoreId) ? this.playerCoreId : null;
        },
        
        pieceAt: function(x, y) {
            const id = this.board.get(this.key(x, y));
            return id ? this.pieces.get(id) : null;
        },
        
        getSelected: function() {return this.selectedId ? this.pieces.get(this.selectedId) : null;},
        getPlayerCore: function() {return this.pieces.get(this.playerCoreId) || null;},
        piecesOf: function(owner) {return [...this.pieces.values()].filter(p => p.owner === owner);},
        parent: function(p) {return p.parentId ? this.pieces.get(p.parentId) : null;},
        children: function(p) {return [...this.pieces.values()].filter(c => c.parentId === p.id);},
        
        // ---- Rank ----
        // rank = max(base, 1 + min(two highest child ranks)), missing children count as 0.
        // Worked out from the links, for rank-based features to come: nothing else uses it
        // now (HP, moves and costs come from level: see Combat.js).
        recomputeRanks: function() {
            const all = [...this.pieces.values()],
                kids = new Map(all.map(p => [p.id, []]));
            for (const p of all) if (p.parentId && kids.has(p.parentId)) kids.get(p.parentId).push(p);
            const memo = new Map(),
                rankOf = p => {
                    if (memo.has(p.id)) return memo.get(p.id);
                    const rs = kids.get(p.id).map(rankOf).sort((a, b) => b - a);
                    const r = Math.max(this.rules.rankBase, 1 + Math.min(rs[0] || 0, rs[1] || 0));
                    memo.set(p.id, r);
                    return r;
                };
            for (const p of all) p.rank = rankOf(p);
        },
        
        coreLevel: function() {
            const c = this.getPlayerCore();
            return c ? c.level : 0;
        },
        // Placing costs more the more levels your pieces have between them.
        placeCost: function() {return Math.max(0, this.costRule('placeCost'));},
        
        // Has this piece the action points to act (see Combat.js)?
        canMove: function(p) {return this.canAfford(p);},
        
        // The piece plus everything linked below it.
        group: function(p) {
            const out = [p];
            for (let i = 0; i < out.length; i++) out.push(...this.children(out[i]));
            return out;
        },
        
        // The core has moved to (x, y): adds it to the golden path, which keeps only the
        // last corePathLength steps (the rule), and always where the core is, or was last
        // (see Goals.js).
        extendCorePath: function(x, y) {
            const path = this.corePath,
                most = this.rules.corePathLength + 1;
            path.push([x, y]);
            if (path.length > most) path.splice(0, path.length - most);
        },
        
        // Legal actions for a piece: [{x, y, dx, dy, attack, hits}]
        // The piece and its whole group step together. If any group member would
        // step onto an opposing piece, the action is an attack instead: every such
        // member hits its target and nobody moves. For your pieces, only those it has the
        // action points for (see moveCost), unless afford is false.
        legalMoves: function(piece, mode = this.modeFor(piece), afford = true) {
            if (!piece || this.over) return [];
            const mine = piece.owner === 'player' && afford;
            if (mine && !this.canMove(piece)) return [];
            const view = this.boardView(),
                out = [];
            for (const [dx, dy] of PIECE_TYPES[piece.type].steps(piece)) {
                const r = this.resolveStep(view, piece.id, dx, dy, mode);
                if (r && !(mine && !this.canAfford(piece, this.moveCost(piece, r)))) out.push({x:piece.x + dx, y:piece.y + dy, dx, dy, mode, ...r});
            }
            return out;
        },
        
        /*  The kind of floor a cell with no tile is: the map's tile generator's baseFloor
            (see Solids.js), or undefined if it has none (or it isn't known). */
        baseFloor: function() {return pkg.floors.get(this.tileGenerator?.attrs.baseFloor);},
        
        /*  What stepping onto (x, y) costs, as a multiple of an action: its floor's moveCost
            (see Solids.js; the base floor's where there's no tile), or 1, times its
            fixture's (see Fixtures.fixtureMoveCost: 1 for one in the way, so a door costs
            what its floor does once it's open). */
        moveCostAt: function(x, y) {
            const t = this.tiles.get(this.key(x, y));
            return ((t ? t.kind === TILE_TYPE_FLOOR ? pkg.floors.get(t.subtype)?.moveCost : 1 : this.baseFloor()?.moveCost) ?? 1) * this.fixtureMoveCost(x, y);
        },
        
        // Could `piece` step by (dx, dy) right now, in mode? Same rules as a normal move;
        // optionally refuse to step any piece that moves onto an active harm tile.
        canStep: function(piece, dx, dy, avoidHarm = false, mode = this.modeFor(piece)) {
            const r = this.resolveStep(this.boardView(avoidHarm), piece.id, dx, dy, mode);
            return !!r && !r.attack;
        },
        
        findMove: function(piece, x, y, mode = this.modeFor(piece), afford = true) {
            return this.legalMoves(piece, mode, afford).find(m => m.x === x && m.y === y) || null;
        },
        
        act: function(piece, x, y, mode = this.modeFor(piece)) {
            const m = this.findMove(piece, x, y, mode);
            if (!m) return false;
            if (m.attack) {
                const {kills, broken} = this.applyHits(piece, m.hits);
                // Your piece advances into the space cleared, if a piece was destroyed or a
                // solid or fixture broken, and the whole group can step there (not onto harm
                // you know of). (To attack without moving, there's Attack: playerAttack.)
                if ((kills || broken) && piece.owner === 'player' && this.pieces.has(piece.id) && this.canStep(piece, m.dx, m.dy, true, mode)) {
                    this.moveGroup(piece, m.dx, m.dy, mode);
                }
            } else {
                this.applyMoves(piece, m.moves);
            }
            return true;
        },
        
        /*  Carries out piece's attack's hits ({attacker, target}, and solid or fixture
            for a tile or a fixture): strikes at pieces (and what's linked below them),
            damages solids and fixtures. Returns {kills, broken}: pieces destroyed, solids and fixtures broken. */
        applyHits: function(piece, hits) {
            let kills = 0, broken = 0;
            for (const h of hits) {
                if (this.pieces.has(h.attacker.id)) {
                    if (h.solid) {
                        if (this.tiles.get(this.key(h.target.x, h.target.y)) === h.target && this.damageSolid(h.target, h.attacker)) broken++;
                    } else if (h.fixture) {
                        if (this.fixtures.get(this.key(h.target.x, h.target.y)) === h.target && this.damageFixture(h.target, h.attacker)) broken++;
                    } else if (this.pieces.has(h.target.id)) {
                        const lost = this.strike(h.attacker, h.target);   // includes pieces linked below the target
                        kills += lost.length;
                    }
                }
            }
            return {kills, broken};
        },
        
        // Moves a piece by (dx, dy) in mode (as resolveStep says), if it can. Returns
        // whether it did.
        moveGroup: function(piece, dx, dy, mode = this.modeFor(piece)) {
            const r = this.resolveStep(this.boardView(), piece.id, dx, dy, mode);
            if (r && !r.attack) this.applyMoves(piece, r.moves);
            return !!r && !r.attack;
        },
        
        // Damage a piece; returns the list of pieces destroyed (empty if it survived).
        // Destroying a piece also destroys everything linked below it. by is the piece the
        // damage is from (the attacker, or who set off a harm). An enemy remembers the last
        // of your pieces to hurt it (lastHitBy), whose kill it is (with what was linked
        // below it), however it dies: that piece earns their xp, once the action is over,
        // with the other kills of the action (see Combat.awardKills).
        damage: function(target, dmg, attacker, by = attacker) {
            if (by?.owner === 'player' && target.owner === 'enemy') target.lastHitBy = by.id;
            target.hp -= dmg;
            this.fx(target.x, target.y, `-${dmg}`, '--dmg', { flash: true, bump: attacker ? { from: attacker } : null });
            if (target.hp > 0) return [];
            const lost = this.group(target),
                col = target.owner === 'player' ? '--core' : '--enemy';
            this.logCombat({kind:'destroyed', d:this.whoOf(target), linked:lost.length - 1});
            for (const g of lost) {
                this.removePiece(g);
                if (g.owner === 'player') {
                    this.piecesLost++;
                } else {
                    this.kills++;
                }
            }
            // A burst where each was. `piece` keeps it drawn until then, since in the enemies'
            // turn that can be after it's gone (see actionStart).
            for (const g of lost.slice(1)) this.fx(g.x, g.y, '', col, {burst:true, delay:80, piece:{...g}});
            this.fx(target.x, target.y, '', col, {burst:true, piece:{...target}});
            if (lost.some(g => g.id === this.playerCoreId)) this.endGame('lost');
            this.recomputeRanks();
            const enemies = lost.filter(g => g.owner === 'enemy');
            if (target.lastHitBy != null && enemies.length) {
                this.pendingKills.push({killerId:target.lastHitBy, count:enemies.length, xp:enemies.reduce((n, g) => n + g.xpValue, 0)});
            }
            return lost;
        },
        
        /*  Whether a piece can break the tile: only player pieces can attack solids, and only
            if they could do damage, i.e. their most damage is more than the solid's DR (its
            material's hardness) after their penetration (see Combat.js). A solid of an
            unknown subtype can't be broken. */
        canBreak: function(piece, tile) {
            return piece.owner === 'player' && tile?.kind === TILE_TYPE_SOLID &&
                this.damageRange(piece)[1] > this.armorAgainst(piece, pkg.solids.get(tile.subtype)?.dr ?? Infinity);
        },
        
        /*  An attack on a solid tile: it can't dodge, so it takes the attacker's damage
            roll less its DR (after penetration). Returns whether that broke it, leaving
            the floor its kind names (Solids.js), or the base floor. */
        damageSolid: function(tile, attacker) {
            const dmg = this.rollDamage(attacker) - this.armorAgainst(attacker, pkg.solids.get(tile.subtype)?.dr ?? Infinity);
            let broken = false;
            if (dmg > 0) {
                tile.hp -= dmg;
                this.fx(tile.x, tile.y, `-${dmg}`, '--dmg', {bump:{from:attacker}});
                if (tile.hp <= 0) {
                    // What's left: the floor its kind names (if there is one), else the base floor.
                    const floor = pkg.solids.get(tile.subtype)?.floor;
                    if (pkg.floors.get(floor)) {
                        this.tiles.set(this.key(tile.x, tile.y), this.makeTile(tile.x, tile.y, TILE_TYPE_FLOOR, floor));
                    } else {
                        this.tiles.delete(this.key(tile.x, tile.y));
                    }
                    this._sightKey = null; // it no longer blocks sight
                    this.fx(tile.x, tile.y, '', '--solid', {burst:true});
                    broken = true;
                }
            }
            return broken;
        },
        
        // ---- Tiles ----
        // Your pieces have moved (or one was placed): the tiles they now need, the fixtures
        // they now find, and any enemies that come of where they've gone.
        piecesMoved: function() {
            this.tileGenerator.piecesMoved();
            this.revealFixtures();
            this.spawnGenerator.piecesMoved();
        },
        
        /*  A tile of the given kind and subtype: a solid (see Solids.js) with its hit
            points, or a hole. (Heals, harms and loot are fixtures: see makeFixture.) */
        makeTile: function(x, y, kind, subtype) {
            const tile = {x, y, kind, subtype};
            if (kind === TILE_TYPE_SOLID) tile.hp = pkg.solids.get(subtype)?.hp ?? 1;
            return tile;
        },
        
        // The tile at (x, y), optionally of a given kind, or null.
        tileAt: function(x, y, kind) {
            const t = this.tiles.get(this.key(x, y));
            return t && (!kind || t.kind === kind) ? t : null;
        },
        
        // ---- Placing linked pieces ----
        canAffordPlace: function() { return this.gold >= this.placeCost(); },
        
        /*  A cost rule's formula (placeCost: see Settings.js), of your
            core's level, your highest and your pieces' levels together, rounded down. */
        costRule: function(rule) {
            return Math.floor(pkg.attrs.evaluate(this.rules[rule], pkg.COST_VARS,
                {coreLevel:this.coreLevel(), maxLevel:this.maxLevel(), levels:this.totalLevels()})) || 0;
        },
        // Empty cells adjacent to at least one player piece.
        // Empty cells a piece could be placed on: next to any of your pieces, or with from
        // given, next to that piece.
        placeCells: function(from = null) {
            const seen = new Set(),
                out = [];
            for (const p of from ? [from] : this.piecesOf('player')) {
                for (const [dx, dy] of pkg.hex.dirs) {
                    const x = p.x + dx,
                        y = p.y + dy,
                        k = this.key(x, y);
                    if (seen.has(k) || !this.isOpen(x, y) || this.pieceAt(x, y) || this.isHarm(x, y)) continue;
                    seen.add(k);
                    out.push({x, y});
                }
            }
            return out;
        },
        
        // Player pieces a new piece at (x, y) could link to.
        
        playerPlace: function(x, y, parent) {
            if (this.over || !this.canAffordPlace()) return false;
            if (!this.isOpen(x, y) || this.pieceAt(x, y) || !parent || parent.owner !== 'player' || hexDist(parent, { x, y }) !== 1) return false;
            const cost = this.placeCost();
            this.gold -= cost;
            const p = this.addPiece('core', 'player', x, y, parent.id);
            this.piecesPlaced++;
            this.recomputeRanks();
            p.hp = p.maxHp;
            this.fx(x, y, `-${cost} gold`, '--place-ink', { spawn: true });
            this.landOnFixtures([p]);
            this.piecesMoved();
            this.afterPlayerAction();
            return true;
        },
        
        // ---- Heal flow ----
        // Heal units (from a heal tile) heal the piece first; any
        // surplus flows along links: up to the nearest damaged ancestor, or down toward the
        // most damaged child. Units alternate up / down, starting up (so with two spare
        // units one goes up and one goes down). Returns how many were used: the rest find
        // nobody to heal.
        applyHeal: function(piece, units) {
            const given = units;
            const self = Math.min(units, piece.maxHp - piece.hp);
            if (self > 0) {
                piece.hp += self;
                units -= self;
                this.fx(piece.x, piece.y, `+${self} HP`, '--heal', {delay: 60});
            }
            let up = true;
            while (units > 0) {
                const t = up ? (this.healTargetUp(piece) || this.healTargetDown(piece))
                    : (this.healTargetDown(piece) || this.healTargetUp(piece));
                if (!t) break;
                t.hp += 1; units -= 1; up = !up;
                this.fx(t.x, t.y, '+1 HP', '--heal', {delay: 160});
            }
            return given - units;
        },
        
        // Nearest damaged ancestor.
        healTargetUp: function(p) {
            for (let a = this.parent(p); a; a = this.parent(a)) {
                if (a.hp < a.maxHp) return a;
            }
            return null;
        },
        
        // Walk down: heal the most damaged child; if no child is damaged, follow the
        // child whose branch has the most missing HP.
        healTargetDown: function(p) {
            let cur = p;
            for (;;) {
                const kids = this.children(cur);
                if (!kids.length) return null;
                const deficit = k => k.maxHp - k.hp;
                const damaged = kids.filter(k => deficit(k) > 0);
                if (damaged.length) return damaged.reduce((a, b) => deficit(b) > deficit(a) ? b : a);
                const branch = k => this.group(k).reduce((sum, g) => sum + deficit(g), 0);
                const best = kids.reduce((a, b) => branch(b) > branch(a) ? b : a);
                if (branch(best) === 0) return null;
                cur = best;
            }
        },
        
        // ---- Turn flow ----
        // Your pieces act in any order, each as often as its action points allow (see
        // Combat.js). Only the piece you choose spends them; pieces it carries keep theirs.
        // Your piece acts (moves or attacks): in its movement mode, or the one given.
        playerAct: function(piece, x, y, mode = this.modeFor(piece)) {
            // Into a fixture in the way that a step does something to (a door: see
            // Fixtures.stepAction): that, if it can, and nothing else.
            const step = piece?.owner === 'player' ? this.stepAction(piece, x, y) : undefined;
            if (step !== undefined) return !!step && this.playerUse(piece, x, y, step.action);
            const m = piece?.owner === 'player' ? this.findMove(piece, x, y, mode) : null;
            if (!m) return false;
            const cost = this.moveCost(piece, m);
            if (!this.act(piece, x, y, mode)) return false;
            this.spend(piece, cost);
            this.afterPlayerAction();
            return true;
        },
        
        // ---- Attack ----
        // A piece of yours can attack a cell next to it, for an action, without stepping:
        // an enemy piece there, a solid it can break, or a fixture you know of with HP that
        // it can damage, in the way or not (see Fixtures.canBreakFixture). Only it attacks
        // (not what's linked below it), and it doesn't advance after.
        
        /*  Piece p's attack on (x, y), {attacker, target} (and solid or fixture), or null if
            there's nothing there it can attack. */
        attackAt: function(p, x, y) {
            const t = this.pieceAt(x, y),
                tile = this.tiles.get(this.key(x, y)),
                f = this.fixtureAt(x, y);
            let hit = null;
            if (t && t.owner !== p.owner) {
                hit = {attacker:p, target:t};
            } else if (this.canBreak(p, tile)) {
                hit = {attacker:p, target:tile, solid:true};
            } else if (this.canBreakFixture(p, f)) {
                hit = {attacker:p, target:f, fixture:true};
            }
            return hit;
        },
        
        /*  The cells next to piece p it can attack now ({x, y}): none if it isn't yours or
            hasn't the points. */
        attackTargets: function(p) {
            return p?.owner === 'player' && this.canAfford(p) ?
                pkg.hex.dirs.map(([dx, dy]) => ({x:p.x + dx, y:p.y + dy})).filter(c => this.attackAt(p, c.x, c.y)) : [];
        },
        canAttack: function(p) {return this.attackTargets(p).length > 0;},
        playerAttack: function(p, x, y) {
            const done = this.attackTargets(p).some(c => c.x === x && c.y === y);
            if (done) {
                this.applyHits(p, [this.attackAt(p, x, y)]);
                if (this.pieces.has(p.id)) this.spend(p);
                this.afterPlayerAction();
            }
            return done;
        },
        
        // ---- Detach and attach ----
        // A piece other than the core can be detached from its parent, however far apart
        // they are, or, with no parent, attached to an adjacent piece of yours (in any
        // group, but not one linked below it, which would make a loop). Either is an
        // action, for the piece's action points. Ranks change to suit: a detached piece
        // keeps its own, but what it was linked to may drop. Only player pieces can do
        // either.
        canDetach: function(p) {
            return !this.over && p?.owner === 'player' && p.id !== this.playerCoreId && !!p.parentId && this.canMove(p);
        },
        attachTargets: function(p) {
            let targets = [];
            if (!this.over && p?.owner === 'player' && p.id !== this.playerCoreId && !p.parentId && this.canMove(p)) {
                const below = new Set(this.group(p).map(g => g.id));
                targets = this.piecesOf('player').filter(t => !below.has(t.id) && hexDist(t, p) === 1);
            }
            return targets;
        },
        canAttach: function(p) {return this.attachTargets(p).length > 0;},
        playerDetach: function(p) {
            let done = false;
            if (this.canDetach(p)) {
                p.parentId = null;
                this.afterLinkChange(p, 'detached');
                done = true;
            }
            return done;
        },
        playerAttach: function(p, target) {
            let done = false;
            if (this.attachTargets(p).includes(target)) {
                p.parentId = target.id;
                this.afterLinkChange(p, 'attached');
                done = true;
            }
            return done;
        },
        afterLinkChange: function(p, text) {
            this.spend(p);
            this.recomputeRanks();
            this.fx(p.x, p.y, text, '--place-ink', {});
            this.afterPlayerAction();
        },
        
        afterPlayerAction: function() {
            this.awardKills();
            this.noticeEnemies();
            this.evaluateObjectives();
            if (this.over) return;
            // Auto-end once no piece can act and there's nothing to spend gold on.
            const canAct = this.piecesOf('player').some(p => this.legalMoves(p).length || this.canDetach(p) || this.canAttach(p) || this.canSwap(p) || this.canJump(p) ||
                this.canRally(p) || this.canAttack(p) || this.canUse(p));
            if (!canAct && !this.canAffordPlace()) { this.endPlayerTurn(); return; }
            // The selection stays where it is, even on a piece that has acted.
        },
        
        playerWait: function() {
            if (this.over) return;
            this.endPlayerTurn();
        },
        
        // The rest of the turn: the enemies', then the environment's (tiles, spawning),
        // then housekeeping: every piece gets back action points, rallying pieces HP, then
        // its status effects count down (in that order, so an effect for a turn still counts
        // at its end).
        endPlayerTurn: function() {
            this.awardKills();
            this.enemyPhase();
            if (this.over) return;
            this.noticeEnemies();
            const core = this.getPlayerCore();
            if (core && !this.getSelected()) this.selectedId = core.id;
            this.turn++;
            this.tickFixtures();
            if (this.over) return;
            this.spawnGenerator.turnEnded();
            this.recoverAp();
            this.rallyHeal();
            this.tickEffects();
            this.noticeEnemies();
            this.evaluateObjectives();
        },
        
        // The enemies' turn, played by the enemy AI. Each squad's actions are animated one
        // after another, squads at once (see actionStart): each squad is a track (the AI
        // sets this.track), and each of its actions ends with endAction.
        enemyPhase: function() {
            const now = performance.now();
            for (const [track, end] of this.trackEnds) {
                if (end < now) this.trackEnds.delete(track);
            }
            try {
                this.enemyAI.takeTurn();
            } finally {
                this.endAction();
                this.track = null;
            }
        },
        
        // How many actions it takes to reach a player piece from every cell within `radius`,
        // keeping off active harm tiles (other pieces are ignored since they move). A step
        // is an action times the moveCost of the cell it steps onto (dear going counts more:
        // see moveCostAt), and a jump (see jumpOffsets) counts 2 (an action, and the
        // points its exhaustion costs: about as much again), so it's no quicker than
        // walking, but it can cross holes. With openDoors, a door a step would open (see
        // Fixtures.stepOpens) counts as a cell it can go on, an action dearer (the step that
        // opens it). Worked out in tenths, so it can go by whole numbers, and given in
        // actions.
        distanceField: function(sources, radius = 30, openDoors = false) {
            // Each cell's numeric key (see keysNear) is used while searching, and what's on
            // it looked up only once, so the search makes as little as it can.
            const {key:numKey} = keysNear(sources[0]?.x ?? 0, sources[0]?.y ?? 0),
                OPEN = 1,
                SOLID = 2,
                TENTHS = 10,
                far = radius * TENTHS,
                dist = new Map(),     // numeric key -> distance, in tenths
                costs = new Map(),    // numeric key -> a step onto it, in tenths
                costAt = (x, y) => {
                    const nk = numKey(x, y);
                    let v = costs.get(nk);
                    if (v === undefined) costs.set(nk, v = Math.max(1, Math.round(TENTHS * this.moveCostAt(x, y))) + (openDoors && !this.isOpen(x, y) ? TENTHS : 0));
                    return v;
                },
                kinds = new Map(),    // numeric key -> OPEN (open and not harm you know of), SOLID, or 0
                kindAt = (x, y) => {
                    const nk = numKey(x, y);
                    let v = kinds.get(nk);
                    if (v === undefined) {
                        v = this.isOpen(x, y) ? (this.isHarm(x, y) ? 0 : OPEN) : openDoors && this.stepOpens(x, y) ? OPEN : this.blocksJumps(x, y) ? SOLID : 0;
                        kinds.set(nk, v);
                    }
                    return v;
                },
                buckets = [], // the cells reached, by distance: [x, y, x, y, ...]
                reach = (x, y, d) => {
                    const nk = numKey(x, y);
                    if (d <= far && !(dist.get(nk) <= d) && kindAt(x, y) === OPEN) {
                        dist.set(nk, d);
                        (buckets[d] ??= []).push(x, y);
                    }
                },
                // The steps, as [dx, dy, ...], and the jumps, as [dx, dy, ox1, oy1, ox2, oy2,
                // ...] (the second cell jumped over the same as the first for a straight jump).
                steps = pkg.hex.dirs.flat(),
                jumpSteps = this.jumpOffsets().flatMap(({dx, dy, over}) => [dx, dy, ...over[0], ...(over[1] ?? over[0])]);
            for (const p of sources) {
                dist.set(numKey(p.x, p.y), 0);
                (buckets[0] ??= []).push(p.x, p.y);
            }
            for (let d = 0; d < buckets.length; d++) {
                const cells = buckets[d] ?? [];
                for (let i = 0; i < cells.length; i += 2) {
                    const x = cells[i],
                        y = cells[i + 1];
                    // Reached more cheaply since it was put here: skip it.
                    // (Out from your pieces: a piece at the next cell would step onto this one.)
                    if (dist.get(numKey(x, y)) === d && d < far) {
                        const step = costAt(x, y);
                        for (let s = 0; s < steps.length; s += 2) reach(x + steps[s], y + steps[s + 1], d + step);
                        // Only over gaps, as enemies jump (see jumpCells): elsewhere walking is
                        // as quick. A jump can't pass over solids only (see canJumpOver).
                        for (let j = 0; j < jumpSteps.length; j += 6) {
                            const ka = kindAt(x + jumpSteps[j + 2], y + jumpSteps[j + 3]),
                                kb = kindAt(x + jumpSteps[j + 4], y + jumpSteps[j + 5]);
                            if ((ka !== SOLID || kb !== SOLID) && ka !== OPEN && kb !== OPEN) reach(x + jumpSteps[j], y + jumpSteps[j + 1], d + 2 * TENTHS);
                        }
                    }
                }
            }
            // As a map from the cells' usual keys.
            const retval = new Map();
            for (let d = 0; d < buckets.length; d++) {
                const cells = buckets[d] ?? [];
                for (let i = 0; i < cells.length; i += 2) {
                    const k = this.key(cells[i], cells[i + 1]);
                    if (!retval.has(k)) retval.set(k, d / TENTHS);
                }
            }
            return retval;
        },
        
        // An effect at (x, y), for the view to play. opts.follow, a piece's id, keeps it on
        // that piece, wherever it's drawn (moving with it), while it's there.
        fx: function(x, y, text, color, opts = {}) {
            this.effects.push({x, y, text, color, t0:this.actionStart() + (opts.delay || 0), ...opts});
            if (opts.bump && this.inSight(x, y)) this.actionTakes(pkg.animMs(ANIM.BUMP_MS));
        },
        
        // ---- Animation ----
        // The view animates pieces' moves (motions: {id, from:[x, y], to:[x, y], jump, t0,
        // dur}) and effects. In the enemies' turn each squad is a track: its actions play
        // one after another, so you can follow them, and all squads play at once. A move or
        // effect made during an action starts when the action does. Your actions play at
        // once (no track), and a piece you move drops any move of its still playing. None
        // of this is saved. What you can't see takes no time (an enemy's move between cells
        // out of sight, a bump out of sight), so it holds nothing up.
        clearAnimation: function() {
            this.motions = [];
            this.track = null;            // the squad (its leader's id) acting, or null for you
            this.trackEnds = new Map();   // track -> when its next action may start
            this.openAction = null;       // the track's action being made: {t0, dur}
        },
        
        // When what's being done now shows: now, or for a squad, when its action starts.
        // With animation off, everything shows at once.
        actionStart: function() {
            const now = performance.now();
            let t = now;
            if (this.track != null && ANIM.on) {
                this.openAction ??= {t0:Math.max(now, this.trackEnds.get(this.track) ?? 0), dur:0};
                t = this.openAction.t0;
            }
            return t;
        },
        
        // The action being made takes at least ms.
        actionTakes: function(ms) {
            if (this.openAction) this.openAction.dur = Math.max(this.openAction.dur, ms);
        },
        
        // The squad's action is done: its next starts when this one has played.
        endAction: function() {
            if (this.track != null && this.openAction) this.trackEnds.set(this.track, this.openAction.t0 + this.openAction.dur);
            this.openAction = null;
        },
        
        // Whether cell (x, y) is in your sight (everything is, without fog).
        inSight: function(x, y) {
            const sight = this.cellsInSight();
            return !sight || sight.has(this.key(x, y));
        },
        
        // Piece p moved from one cell to another (by a jump, or a step). Nothing to animate
        // with animation off, or for an enemy that's out of your sight before and after.
        motionFx: function(p, from, to, jump = false) {
            const now = performance.now(),
                dur = pkg.animMs(jump ? ANIM.JUMP_MS : ANIM.MOVE_MS);
            this.motions = this.motions.filter(m => now < m.t0 + m.dur && !(this.track == null && m.id === p.id));
            if (ANIM.on && (p.owner !== 'enemy' || this.inSight(...from) || this.inSight(...to))) {
                this.motions.push({id:p.id, from, to, jump, t0:this.actionStart(), dur});
                this.actionTakes(dur);
            }
        },
        
        // When everything animating will have finished.
        animationEnd: function() {
            return Math.max(performance.now(), ...this.motions.map(m => m.t0 + m.dur), ...this.trackEnds.values());
        }
    });
})(hc);
