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
        hexDist, PIECE_TYPES
    } = pkg;
    
    // ---------------------------------------------------------------------------
    // Game state
    // ---------------------------------------------------------------------------
    pkg.Game = new JS.Class('Game', {
        include:[pkg.Movement, pkg.Goals, pkg.EffectTiles],
        
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
            this.pieces = new Map();         // id -> piece
            this.board = new Map();          // "x,y" -> id
            this.score = 0;                  // score you have to spend
            this.scoreEarned = 0;            // all the score you've earned, spent or not
            this.over = false;
            this.outcome = null;             // once over: 'won' or 'lost'
            this.lostBy = null;              // when lost: the index of the objective that lost it, or null for the core
            this.kills = 0;                  // enemy pieces destroyed
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
            this.acted = new Set();          // ids of player pieces moved this turn (each can move once a turn)
            this.fresh = new Set();          // ids of pieces placed this turn (can't move until next turn)
            this.movesUsed = 0;              // moves made this turn (counts toward the move limit)
            this.recoverUsed = false;        // whether Recover has been used this turn (once a turn)
            this.quickenUsed = false;        // whether Quicken has been used this turn (once a turn: a move more)
            this.moveMode = this.rules.moveMode; // how the player's pieces move (see Movement.js)
            const core = this.addPiece('core', 'player', 0, 0);
            this.playerCoreId = core.id;
            this.recomputeRanks();
            core.hp = core.maxHp;
            this.selectedId = core.id;
            this.corePath = [[0, 0]];       // the cells the core has been on, in order (the golden path: see extendCorePath)
            this.tileGenerator.start();
            this.revealTiles();
            this.spawnGenerator.start();
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
                acted:[...this.acted],
                fresh:[...this.fresh],
                movesUsed:this.movesUsed,
                recoverUsed:this.recoverUsed,
                quickenUsed:this.quickenUsed,
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
                !Number.isInteger(o.movesUsed) || !pkg.isObj(o.rules) ||
                ![o.pieces, o.tiles, o.seenCells, o.acted, o.fresh, o.corePath].every(isArr) ||
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
                this.pieces.set(p.id, {...p});
                this.board.set(this.key(p.x, p.y), p.id);
            }
            this.tiles = new Map(o.tiles.map(t => [this.key(t.x, t.y), {...t}]));
            this.tileGenerator = tileGenerator;
            this.spawnGenerator = spawnGenerator;
            this.enemyAI = enemyAI;
            this.seenCells = new Set(o.seenCells);
            this.acted = new Set(o.acted);
            this.fresh = new Set(o.fresh);
            this.movesUsed = o.movesUsed;
            this.recoverUsed = !!o.recoverUsed;
            this.quickenUsed = !!o.quickenUsed;
            this.moveMode = pkg.MOVE_MODES.includes(o.moveMode) ? o.moveMode : 'fixed';
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
                const sight = new Set();
                for (const p of players) {
                    for (const c of pkg.hex.disk(p.x, p.y, this.rules.visionRadius)) {
                        const k = this.key(c.x, c.y);
                        if (!sight.has(k) && this.canSee(p, c)) sight.add(k);
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
        // solid cells themselves can be seen.
        canSee: function(a, b) {
            const left = pkg.hex.line(a, b, 1),
                right = pkg.hex.line(a, b, -1),
                dist = left.length - 1;
            let range = this.rules.visionRadius;
            for (let i = 1; i < dist && range >= dist; i++) {
                const through = Math.max(this.seeThrough(left[i].x, left[i].y), this.seeThrough(right[i].x, right[i].y));
                range = i + (range - i) * through;
            }
            return range >= dist;
        },
        
        // The share of sight that gets through (x, y): 1, or for a solid, 1 less its
        // opacity (Solids.js); none for a solid of an unknown subtype.
        seeThrough: function(x, y) {
            const tile = this.tiles.get(this.key(x, y));
            return tile?.kind === TILE_TYPE_SOLID ? 1 - (pkg.solids.get(tile.subtype)?.opacity ?? 100) / 100 : 1;
        },
        
        addPiece: function(type, owner, x, y, parentId = null) {
            const s = PIECE_TYPES[type].stats[owner],
                hp = (owner === 'player' ? this.rules.hpPer : this.rules.enemyHpPer) * this.rules.rankBase,
                piece = {
                    id:this.nextId++, 
                    type, owner, x, y, parentId,
                    hp, maxHp: hp, 
                    rank:this.rules.rankBase, 
                    scoreValue:s.scoreValue,
                    score:0
                };
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
        // Max HP follows rank; HP is clamped down, and only raised with the rankUpHeals rule.
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
            for (const p of all) {
                const r = rankOf(p),
                    player = p.owner === 'player',
                    newMax = (player ? this.rules.hpPer : this.rules.enemyHpPer) * r;
                if (newMax > p.maxHp && player && this.rules.rankUpHeals) p.hp += newMax - p.maxHp;
                p.rank = r; p.maxHp = newMax;
                p.hp = Math.min(p.hp, p.maxHp);
            }
        },
        
        coreRank: function() {
            const c = this.getPlayerCore();
            return c ? c.rank : 0;
        },
        maxRank: function() {return Math.max(0, ...this.piecesOf('player').map(p => p.rank)); },
        moveLimit: function() {return this.rules.movesPer * this.maxRank() + (this.quickenUsed ? 1 : 0);},
        // Placing costs more the more pieces you have (the core and detached ones too), but
        // not with rank, so detaching to keep ranks down doesn't make pieces cheaper.
        placeCost: function() {return this.rules.placeBase + Math.ceil(this.piecesOf('player').length / Math.max(1, this.rules.placePerPieces));},
        
        // Can this player piece still move this turn?
        canMove: function(p) {
            return !this.acted.has(p.id) && !this.fresh.has(p.id) && !this.isTired(p) && this.movesUsed < this.moveLimit();
        },
        
        // Is the piece tired from a jump: one this turn, or last turn (see jumpPiece)?
        isTired: function(p) {return (p?.tiredUntil ?? -1) >= this.turn;},
        
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
                            const lost = this.damage(h.target, 1, h.attacker);   // includes pieces linked below the target
                            for (const g of lost) { kills++; value += g.scoreValue; h.attacker.score += g.scoreValue; }
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
            if they'd do damage, i.e. their rank is more than the solid's DR (its material's
            hardness). A solid of an unknown subtype can't be broken. */
        canBreak: function(piece, tile) {
            return piece.owner === 'player' && tile?.kind === TILE_TYPE_SOLID && piece.rank > (pkg.solids.get(tile.subtype)?.dr ?? Infinity);
        },
        
        /*  An attack on a solid tile: it takes the attacker's rank less its DR in damage.
            Returns whether that broke it, leaving open floor. */
        damageSolid: function(tile, attacker) {
            const dmg = attacker.rank - (pkg.solids.get(tile.subtype)?.dr ?? Infinity);
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
        // Your pieces have moved (or one was placed): the tiles they now need, and the
        // ones they now find.
        piecesMoved: function() {
            this.tileGenerator.piecesMoved();
            this.revealTiles();
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
        healCost: function() {return this.rules.healCostPer * this.coreRank();},
        healAmount: function() {return this.rules.healActPer * this.coreRank();},
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
            this.fresh.add(p.id); // a newly placed piece can't move until next turn
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
        // Each turn you may make up to moveLimit() moves, each piece moving at most once
        // (unless it's recovered), in any order. Only the piece you choose spends a move;
        // pieces it carries keep theirs.
        playerAct: function(piece, x, y) {
            if (this.over || !piece || piece.owner !== 'player' || !this.canMove(piece)) return false;
            if (!this.act(piece, x, y)) return false;
            if (this.pieces.has(piece.id)) this.useMove(piece);
            this.afterPlayerAction();
            return true;
        },
        
        movesLeft: function() {
            const eligible = this.piecesOf('player').filter(p => !this.acted.has(p.id) && !this.fresh.has(p.id) && !this.isTired(p)).length;
            return Math.max(0, Math.min(this.moveLimit() - this.movesUsed, eligible));
        },
        
        // A piece has acted: it's done for the turn, and a move is used.
        useMove: function(p) {
            this.acted.add(p.id);
            this.movesUsed++;
        },
        
        // ---- Detach and attach ----
        // A piece other than the core can be detached from its parent, however far apart
        // they are, or, with no parent, attached to an adjacent piece of yours (in any
        // group, but not one linked below it, which would make a loop). Either is the
        // piece's action for the turn, and uses a move. Ranks change to suit: a detached
        // piece keeps its own, but what it was linked to may drop, and with it the swarm's
        // rank (the highest of any piece) and the moves a turn. Only player pieces can do
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
            this.useMove(p);
            this.recomputeRanks();
            this.fx(p.x, p.y, text, '--place-ink', {});
            this.afterPlayerAction();
        },
        
        // ---- Recover ----
        // Once a turn, a piece that has moved, or was placed, this turn can be made ready to
        // move again, for its rank in score. It doesn't add a move: moving it again uses one
        // of the turn's moves left, so it's only offered while there's one. A piece tired
        // from a jump can't be recovered.
        recoverCost: function(p) {return p.rank;},
        canRecover: function(p) {
            return !this.over && !this.recoverUsed && p?.owner === 'player' && !this.isTired(p) &&
                (this.acted.has(p.id) || this.fresh.has(p.id)) &&
                this.movesUsed < this.moveLimit() && this.score >= this.recoverCost(p);
        },
        anyRecoverable: function() {return this.piecesOf('player').some(p => this.canRecover(p));},
        
        // ---- Quicken ----
        // Once a turn, one more move this turn, for the swarm's rank (its highest) in score.
        quickenCost: function() {return this.maxRank();},
        canQuicken: function() {return !this.over && !this.quickenUsed && this.score >= this.quickenCost();},
        playerQuicken: function() {
            let quickened = false;
            if (this.canQuicken()) {
                const cost = this.quickenCost(),
                    core = this.getPlayerCore();
                this.score -= cost;
                this.quickenUsed = true;
                if (core) this.fx(core.x, core.y, `-${cost} score`, '--place-ink', {});
                quickened = true;
            }
            return quickened;
        },
        playerRecover: function(p) {
            let recovered = false;
            if (this.canRecover(p)) {
                const cost = this.recoverCost(p);
                this.score -= cost;
                this.acted.delete(p.id);
                this.fresh.delete(p.id);
                this.recoverUsed = true;
                this.selectedId = p.id;
                this.fx(p.x, p.y, `-${cost} score`, '--place-ink', {});
                recovered = true;
            }
            return recovered;
        },
        
        afterPlayerAction: function() {
            this.evaluateObjectives();
            if (this.over) return;
            // Auto-end once no piece can act and there's nothing to spend score on.
            const canAct = this.piecesOf('player').some(p => this.legalMoves(p).length || this.canDetach(p) || this.canAttach(p) || this.canSwap(p) || this.canJump(p));
            if (!canAct && !this.canAffordPlace() && !this.anyRecoverable() && !this.canQuicken()) { this.endPlayerTurn(); return; }
            // The selection stays where it is, even on a piece that has acted.
        },
        
        playerWait: function() {
            if (this.over) return;
            this.endPlayerTurn();
        },
        
        endPlayerTurn: function() {
            this.enemyPhase();
            if (this.over) return;
            this.acted.clear();
            this.fresh.clear();
            this.movesUsed = 0;
            this.recoverUsed = false;
            this.quickenUsed = false;
            const core = this.getPlayerCore();
            if (core && !this.getSelected()) this.selectedId = core.id;
            this.turn++;
            this.tickTiles();
            if (this.over) return;
            this.spawnGenerator.turnEnded();
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
        
        // How many turns it takes to reach a player piece from every cell within `radius`,
        // keeping off active harm tiles (other pieces are ignored since they move). A step
        // takes a turn, and so does a jump (see jumpOffsets) but the piece then sits out the
        // next: it counts 2, so it's no quicker than walking, but it can cross holes.
        distanceField: function(sources, radius = 30) {
            const dist = new Map(),
                buckets = [], // the cells reached, by distance: [x, y, x, y, ...]
                jumps = this.jumpOffsets(),
                reach = (x, y, d) => {
                    const k = this.key(x, y);
                    if (d <= radius && !(dist.get(k) <= d) && this.isOpen(x, y) && !this.isHarm(x, y)) {
                        dist.set(k, d);
                        (buckets[d] ??= []).push(x, y);
                    }
                };
            for (const p of sources) {
                dist.set(this.key(p.x, p.y), 0);
                (buckets[0] ??= []).push(p.x, p.y);
            }
            for (let d = 0; d < buckets.length; d++) {
                const cells = buckets[d] ?? [];
                for (let i = 0; i < cells.length; i += 2) {
                    const x = cells[i],
                        y = cells[i + 1];
                    // Reached more cheaply since it was put here: skip it.
                    if (dist.get(this.key(x, y)) === d && d < radius) {
                        for (const [dx, dy] of pkg.hex.dirs) reach(x + dx, y + dy, d + 1);
                        // Only over gaps, as enemies jump (see jumpCells): elsewhere walking is as quick.
                        for (const {dx, dy, over} of jumps) {
                            if (this.canJumpOver(x, y, over) && !over.some(([ox, oy]) => this.isOpen(x + ox, y + oy) && !this.isHarm(x + ox, y + oy))) {
                                reach(x + dx, y + dy, d + 2);
                            }
                        }
                    }
                }
            }
            return dist;
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
