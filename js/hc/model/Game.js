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
        TILE_TYPE_HARM, TILE_TYPE_HOLE, TILE_TYPE_SOLID,
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
        include:[pkg.Movement, pkg.Navigation, pkg.Formation, pkg.Combat, pkg.Goals, pkg.EffectTiles],
        
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
            this.score = 0;                  // score you have to spend
            this.scoreEarned = 0;            // all the score you've earned, spent or not
            this.over = false;
            this.outcome = null;             // once over: 'won' or 'lost'
            this.lostBy = null;              // when lost: the index of the objective that lost it, or null for the core
            this.kills = 0;                  // enemy pieces destroyed
            this.combatRolls = 0;            // rolls made in combat, for the next (see Combat.js)
            this.combatLog = [];             // what happened in combat (see Combat.js; not saved)
            this.piecesLost = 0;             // player pieces destroyed
            this.piecesPlaced = 0;
            this.lootOpened = 0;             // loot tiles emptied
            this.lootTaken = 0;              // score taken from loot tiles
            this.objectives = this.getMapObjectives().map(() => ({value:false, locked:false, progress:''})); // state of each of the map's goals and penalties
            this.effects = [];               // transient visuals (floating text, flashes)
            this.clearAnimation();
            this.rules = pkg.settings.resolveRules(this.gameMap?.rules, 'Game'); // the map's rules, the rest at their defaults (see Settings.js)
            // The map's components (see MapComponent.js), with its attrs for them.
            const {tileGenerator:tiles, spawnGenerator:spawns, enemyAI:ai} = this.gameMap ?? pkg.Game.NO_MAP;
            this.tileGenerator = pkg.TileGenerator.make(tiles.type, this, tiles.attrs);   // places the map's tiles
            this.spawnGenerator = pkg.SpawnGenerator.make(spawns.type, this, spawns.attrs); // and its enemies
            this.enemyAI = pkg.EnemyAI.make(ai.type, this, ai.attrs);                       // which it plays
            this.tiles = new Map();          // "x,y" -> {x, y, kind:"heal" | "harm" | "solid" | "hole" | "loot", subtype, ...} (see makeTile)
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
            this.revealTiles();
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
                score:this.score,
                scoreEarned:this.scoreEarned,
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
            if (!isNum(o?.turn) || !isNum(o.nextId) || !isNum(o.score) || !isNum(o.scoreEarned) ||
                !isNum(o.kills) || !isNum(o.piecesLost) || !isNum(o.piecesPlaced) || !isNum(o.lootOpened) || !isNum(o.lootTaken) ||
                !pkg.isObj(o.rules) ||
                ![o.pieces, o.tiles, o.seenCells, o.corePath].every(isArr) ||
                !o.pieces.every(p => isNum(p?.id) && isNum(p.x) && isNum(p.y) && PIECE_TYPES[p.type]) ||
                !o.tiles.every(t => isNum(t?.x) && isNum(t.y) && typeof t.kind === 'string')
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
            this.score = o.score;
            this.scoreEarned = o.scoreEarned;
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
            this.clearAnimation();
            this.pieces = new Map();
            this.board = new Map();
            for (const p of o.pieces) {
                const trail = isArr(p.trail) && p.trail.every(c => isArr(c) && c.length === 2 && c.every(Number.isInteger)) ? p.trail : [],
                    piece = {...p, trail};
                // From before pieces had profiles (see Combat.js): an ordinary one, at the
                // HP it had, if that fits.
                if (!piece.stats) {
                    this.giveProfile(piece, piece.enemyId);
                    piece.hp = Math.min(piece.maxHp, Math.max(1, p.hp | 0));
                }
                // From before action points: a full pool
                if (!Number.isInteger(piece.ap) || piece.ap < 0) piece.ap = this.apMax(piece);
                // A named enemy's id and band (see newBand), if it has them and they're usable
                if (typeof piece.enemyId !== 'string') delete piece.enemyId;
                if (!Number.isInteger(piece.band)) delete piece.band;
                this.pieces.set(p.id, piece);
                this.board.set(this.key(p.x, p.y), p.id);
            }
            this.nextBand = 1 + Math.max(0, ...[...this.pieces.values()].map(p => p.band ?? 0));
            this.tiles = new Map(o.tiles.map(t => [this.key(t.x, t.y), {...t}]));
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
        // Can a piece ever be on (x, y)? Not past the edge of the world, or on a solid or
        // hole tile.
        isOpen: function(x, y) {
            if (Math.abs(x) > WORLD_LIMIT || Math.abs(y) > WORLD_LIMIT) return false;
            const kind = this.tiles.get(this.key(x, y))?.kind;
            return kind !== TILE_TYPE_SOLID && kind !== TILE_TYPE_HOLE;
        },
        // Solid tiles block movement (and jumps over them); how much they block sight is
        // seeThrough's. Holes don't block sight.
        isSolid: function(x, y) { return this.tiles.get(this.key(x, y))?.kind === TILE_TYPE_SOLID; },
        
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
        // opacity (Solids.js); none for a solid of an unknown subtype.
        seeThrough: function(x, y) {
            const tile = this.tiles.get(this.key(x, y));
            return tile?.kind === TILE_TYPE_SOLID ? 1 - (pkg.solids.get(tile.subtype)?.opacity ?? 100) / 100 : 1;
        },
        
        /*  A number for enemies spawned together, so they can be known as a band: each
            piece of theirs has it (piece.band). */
        newBand: function() {return this.nextBand++;},
        
        /*  A new piece, with the profile profileId (see Combat.giveProfile: if not given,
            yours are adventurers, enemies creepers), at full HP. */
        addPiece: function(type, owner, x, y, parentId = null, profileId) {
            const s = PIECE_TYPES[type].stats[owner],
                piece = {
                    id:this.nextId++, 
                    type, owner, x, y, parentId,
                    rank:this.rules.rankBase, 
                    scoreValue:s.scoreValue,
                    score:0,
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
        // member hits its target and nobody moves.
        legalMoves: function(piece, mode = this.modeFor(piece)) {
            if (!piece || this.over) return [];
            if (piece.owner === 'player' && !this.canMove(piece)) return [];
            const view = this.boardView(),
                out = [];
            for (const [dx, dy] of PIECE_TYPES[piece.type].steps(piece)) {
                const r = this.resolveStep(view, piece.id, dx, dy, mode);
                if (r) out.push({x:piece.x + dx, y:piece.y + dy, dx, dy, mode, ...r});
            }
            return out;
        },
        
        // Could `piece` step by (dx, dy) right now, in mode? Same rules as a normal move;
        // optionally refuse to step any piece that moves onto an active harm tile.
        canStep: function(piece, dx, dy, avoidHarm = false, mode = this.modeFor(piece)) {
            const r = this.resolveStep(this.boardView(avoidHarm), piece.id, dx, dy, mode);
            return !!r && !r.attack;
        },
        
        findMove: function(piece, x, y, mode = this.modeFor(piece)) {
            return this.legalMoves(piece, mode).find(m => m.x === x && m.y === y) || null;
        },
        
        // Combo rule: killing n enemies in one move scores n x (their total value),
        // i.e. n^2 for 1-point enemies.
        act: function(piece, x, y, mode = this.modeFor(piece)) {
            const m = this.findMove(piece, x, y, mode);
            if (!m) return false;
            if (m.attack) {
                let kills = 0, value = 0, broken = 0;
                for (const h of m.hits) {
                    if (this.pieces.has(h.attacker.id)) {
                        if (h.solid) {
                            if (this.tiles.get(this.key(h.target.x, h.target.y)) === h.target && this.damageSolid(h.target, h.attacker)) broken++;
                        } else if (this.pieces.has(h.target.id)) {
                            const lost = this.strike(h.attacker, h.target);   // includes pieces linked below the target
                            for (const g of lost) { kills++; value += g.scoreValue; h.attacker.score += g.scoreValue; }
                            // Your piece learns from the enemies it killed (see Combat.js).
                            if (h.attacker.owner === 'player' && this.pieces.has(h.attacker.id)) {
                                const xp = lost.reduce((n, g) => n + (g.owner === 'enemy' ? g.xpValue : 0), 0);
                                if (xp) this.gainXp(h.attacker, xp);
                            }
                        }
                    }
                }
                if (kills && piece.owner === 'player') {
                    const gain = kills * value;
                    this.earn(gain);
                    this.fx(piece.x, piece.y, kills > 1 ? `+${gain}  ${kills}× combo!` : `+${gain}`, '--gain', { delay: 120 });
                }
                // Advance into the space cleared, if a piece was destroyed or a solid broken.
                if ((kills || broken) && piece.owner === 'player' && this.rules.advance && this.pieces.has(piece.id) && this.canStep(piece, m.dx, m.dy, true, mode)) {
                    this.moveGroup(piece, m.dx, m.dy, mode);
                }
            } else {
                this.applyMoves(piece, m.moves);
            }
            return true;
        },
        
        // Moves a piece by (dx, dy) in mode (as resolveStep says), if it can. Returns
        // whether it did.
        moveGroup: function(piece, dx, dy, mode = this.modeFor(piece)) {
            const r = this.resolveStep(this.boardView(), piece.id, dx, dy, mode);
            if (r && !r.attack) this.applyMoves(piece, r.moves);
            return !!r && !r.attack;
        },
        
        // Damage a piece; returns the list of pieces destroyed (empty if it survived).
        // Destroying a piece also destroys everything linked below it.
        damage: function(target, dmg, attacker) {
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
            open floor. */
        damageSolid: function(tile, attacker) {
            const dmg = this.rollDamage(attacker) - this.armorAgainst(attacker, pkg.solids.get(tile.subtype)?.dr ?? Infinity);
            let broken = false;
            if (dmg > 0) {
                tile.hp -= dmg;
                this.fx(tile.x, tile.y, `-${dmg}`, '--dmg', {bump:{from:attacker}});
                if (tile.hp <= 0) {
                    this.tiles.delete(this.key(tile.x, tile.y));
                    this._sightKey = null; // it no longer blocks sight
                    this.fx(tile.x, tile.y, '', '--solid', {burst:true});
                    broken = true;
                }
            }
            return broken;
        },
        
        // Back-compat helper (single hit, scored as a 1-kill move).
        attack: function(attacker, target, dmg = 1) {
            const lost = this.damage(target, dmg, attacker);
            const v = lost.reduce((a, g) => a + g.scoreValue, 0);
            if (v && attacker.owner === 'player') { this.earn(v * lost.length); attacker.score += v; }
            return lost.length > 0;
        },
        
        // ---- Tiles ----
        // Your pieces have moved (or one was placed): the tiles they now need, the ones
        // they now find, and any enemies that come of where they've gone.
        piecesMoved: function() {
            this.tileGenerator.piecesMoved();
            this.revealTiles();
            this.spawnGenerator.piecesMoved();
        },
        
        /*  A tile of the given kind and subtype: a solid (see Solids.js) with its hit
            points, a hole, or a heal, harm or loot tile, its pool and magnitude rolled by rng
            (see EffectTiles.js). */
        makeTile: function(x, y, kind, subtype, rng = Math.random) {
            let tile = {x, y, kind, subtype};
            if (kind === TILE_TYPE_SOLID) {
                tile.hp = pkg.solids.get(subtype)?.hp ?? 1;
            } else if (this.isEffectTile(tile)) {
                tile = this.makeEffectTile(x, y, kind, subtype, rng);
            }
            return tile;
        },
        
        // The tile at (x, y) you know of (see isRevealed), optionally of a given kind.
        tileAt: function(x, y, kind) {
            const t = this.tiles.get(this.key(x, y));
            return t && this.isRevealed(t) && (!kind || t.kind === kind) ? t : null;
        },
        // A harm tile you know of. (Harm tiles only hurt what you set them off on, so the
        // enemies, who keep off them, needn't know of hidden ones.)
        isHarm: function(x, y) {
            return !!this.tileAt(x, y, TILE_TYPE_HARM);
        },
        
        // ---- Placing linked pieces ----
        // Adds to the score you have, and to the total earned.
        earn: function(n) {
            this.score += n;
            this.scoreEarned += n;
        },
        
        canAffordPlace: function() { return this.score >= this.placeCost(); },
        
        // ---- Heal action ----
        healCost: function() {return Math.max(0, this.costRule('healCost'));},
        healAmount: function() {return Math.max(1, this.costRule('healAmount'));},
        
        /*  A cost rule's formula (placeCost, healCost, healAmount: see Settings.js), of your
            core's level, your highest and your pieces' levels together, rounded down. */
        costRule: function(rule) {
            return Math.floor(pkg.attrs.evaluate(this.rules[rule], pkg.COST_VARS,
                {coreLevel:this.coreLevel(), maxLevel:this.maxLevel(), levels:this.totalLevels()})) || 0;
        },
        anyDamaged: function() {return this.piecesOf('player').some(p => p.hp < p.maxHp);},
        canAffordHeal: function() {return this.score >= this.healCost();},
        
        // Spend score to heal: healAmount() units start at the chosen piece and flow
        // along links exactly like a heal tile. Unused units are lost. Doesn't use a move.
        playerHeal: function(piece) {
            if (this.over || !piece || piece.owner !== 'player' || !this.canAffordHeal() || !this.anyDamaged()) return false;
            const cost = this.healCost();
            this.score -= cost;
            this.fx(piece.x, piece.y, `-${cost} score`, '--place-ink', {});
            this.applyHeal(piece, this.healAmount(), false);
            return true;
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
            this.score -= cost;
            const p = this.addPiece('core', 'player', x, y, parent.id);
            this.piecesPlaced++;
            this.recomputeRanks();
            p.hp = p.maxHp;
            this.fx(x, y, `-${cost} score`, '--place-ink', { spawn: true });
            this.landOnTiles([p]);
            this.piecesMoved();
            this.afterPlayerAction();
            return true;
        },
        
        // ---- Heal flow ----
        // Heal units (from a heal tile, or the Heal action) heal the piece first; any
        // surplus flows along links: up to the nearest damaged ancestor, or down toward the
        // most damaged child. Units alternate up / down, starting up (so with two spare
        // units one goes up and one goes down). Units that find nobody to heal become
        // score, the healScore rule's worth each, if leftoverToScore.
        applyHeal: function(piece, units, leftoverToScore, x = piece.x, y = piece.y) {
            const self = Math.min(units, piece.maxHp - piece.hp);
            if (self > 0) {
                piece.hp += self;
                units -= self;
                this.fx(piece.x, piece.y, `+${self} HP`, '--heal', { delay: 60 });
            }
            let up = true;
            while (units > 0) {
                const t = up ? (this.healTargetUp(piece) || this.healTargetDown(piece))
                    : (this.healTargetDown(piece) || this.healTargetUp(piece));
                if (!t) break;
                t.hp += 1; units -= 1; up = !up;
                this.fx(t.x, t.y, '+1 HP', '--heal', { delay: 160 });
            }
            if (units > 0 && leftoverToScore) {
                const gain = units * this.rules.healScore;
                piece.score += gain; this.earn(gain);
                this.fx(x, y, `+${gain} score`, '--gain', { delay: 60 });
            }
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
            if (piece?.owner !== 'player' || !this.canMove(piece)) return false;
            if (!this.act(piece, x, y, mode)) return false;
            this.spend(piece);
            this.afterPlayerAction();
            return true;
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
            this.noticeEnemies();
            this.evaluateObjectives();
            if (this.over) return;
            // Auto-end once no piece can act and there's nothing to spend score on.
            const canAct = this.piecesOf('player').some(p => this.legalMoves(p).length || this.canDetach(p) || this.canAttach(p) || this.canSwap(p) || this.canJump(p));
            if (!canAct && !this.canAffordPlace()) { this.endPlayerTurn(); return; }
            // The selection stays where it is, even on a piece that has acted.
        },
        
        playerWait: function() {
            if (this.over) return;
            this.endPlayerTurn();
        },
        
        // The rest of the turn: the enemies', then the environment's (tiles, spawning),
        // then housekeeping: every piece gets back action points.
        endPlayerTurn: function() {
            this.enemyPhase();
            if (this.over) return;
            this.noticeEnemies();
            const core = this.getPlayerCore();
            if (core && !this.getSelected()) this.selectedId = core.id;
            this.turn++;
            this.tickTiles();
            if (this.over) return;
            this.spawnGenerator.turnEnded();
            this.recoverAp();
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
        // is an action, and a jump (see jumpOffsets), with jumps, costs twice the points:
        // it counts 2, so it's no quicker than walking, but it can cross holes.
        distanceField: function(sources, radius = 30, jumps = true) {
            // Each cell's numeric key (see keysNear) is used while searching, and what's on
            // it looked up only once, so the search makes as little as it can.
            const {key:numKey} = keysNear(sources[0]?.x ?? 0, sources[0]?.y ?? 0),
                OPEN = 1,
                SOLID = 2,
                dist = new Map(),     // numeric key -> distance
                kinds = new Map(),    // numeric key -> OPEN (open and not harm you know of), SOLID, or 0
                kindAt = (x, y) => {
                    const nk = numKey(x, y);
                    let v = kinds.get(nk);
                    if (v === undefined) {
                        v = this.isOpen(x, y) ? (this.isHarm(x, y) ? 0 : OPEN) : this.isSolid(x, y) ? SOLID : 0;
                        kinds.set(nk, v);
                    }
                    return v;
                },
                buckets = [], // the cells reached, by distance: [x, y, x, y, ...]
                reach = (x, y, d) => {
                    const nk = numKey(x, y);
                    if (d <= radius && !(dist.get(nk) <= d) && kindAt(x, y) === OPEN) {
                        dist.set(nk, d);
                        (buckets[d] ??= []).push(x, y);
                    }
                },
                // The steps, as [dx, dy, ...], and the jumps, as [dx, dy, ox1, oy1, ox2, oy2,
                // ...] (the second cell jumped over the same as the first for a straight jump).
                steps = pkg.hex.dirs.flat(),
                jumpSteps = !jumps ? [] : this.jumpOffsets().flatMap(({dx, dy, over}) => [dx, dy, ...over[0], ...(over[1] ?? over[0])]);
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
                    if (dist.get(numKey(x, y)) === d && d < radius) {
                        for (let s = 0; s < steps.length; s += 2) reach(x + steps[s], y + steps[s + 1], d + 1);
                        // Only over gaps, as enemies jump (see jumpCells): elsewhere walking is
                        // as quick. A jump can't pass over solids only (see canJumpOver).
                        for (let j = 0; j < jumpSteps.length; j += 6) {
                            const ka = kindAt(x + jumpSteps[j + 2], y + jumpSteps[j + 3]),
                                kb = kindAt(x + jumpSteps[j + 4], y + jumpSteps[j + 5]);
                            if ((ka !== SOLID || kb !== SOLID) && ka !== OPEN && kb !== OPEN) reach(x + jumpSteps[j], y + jumpSteps[j + 1], d + 2);
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
                    if (!retval.has(k)) retval.set(k, d);
                }
            }
            return retval;
        },
        
        fx: function(x, y, text, color, opts = {}) {
            this.effects.push({x, y, text, color, t0:this.actionStart() + (opts.delay || 0), ...opts});
            if (opts.bump) this.actionTakes(ANIM.BUMP_MS);
        },
        
        // ---- Animation ----
        // The view animates pieces' moves (motions: {id, from:[x, y], to:[x, y], jump, t0,
        // dur}) and effects. In the enemies' turn each squad is a track: its actions play
        // one after another, so you can follow them, and all squads play at once. A move or
        // effect made during an action starts when the action does. Your actions play at
        // once (no track), and a piece you move drops any move of its still playing. None
        // of this is saved.
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
        
        // Piece p moved from one cell to another (by a jump, or a step). Nothing to animate
        // with animation off.
        motionFx: function(p, from, to, jump = false) {
            const now = performance.now(),
                dur = jump ? ANIM.JUMP_MS : ANIM.MOVE_MS;
            this.motions = this.motions.filter(m => now < m.t0 + m.dur && !(this.track == null && m.id === p.id));
            if (ANIM.on) {
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
