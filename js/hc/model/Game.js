/*  The game state and rules: pieces and link trees, ranks, moves and attacks,
    quadrants and tiles, heals, waves and spawning. Enemy turns are in EnemyAI.js and
    goals in Goals.js, modules it includes. */
(pkg => {
    'use strict';
    
    const {
        cfg:{
            WORLD_LIMIT, QUAD, VISION, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, HEAL, RANK
        },
        TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_HOLE, TILE_TYPE_SOLID, TILE_TYPE_LOOT,
        hexDist, PIECE_TYPES
    } = pkg;
    
    // ---------------------------------------------------------------------------
    // Game state
    // ---------------------------------------------------------------------------
    pkg.Game = new JS.Class('Game', {
        include:[pkg.Movement, pkg.EnemyAI, pkg.Goals],
        
        initialize: function() {
            this.level = null; // {id, name, attrs}: the level being played, set by the App
            this.seed = null;  // the seed the level is made from, set before reset (or random)
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
            this.lootOpened = 0;             // loot tiles taken
            this.objectives = this.getLevelObjectives().map(() => ({value:false, locked:false, progress:''})); // state of each of the level's goals and penalties
            this.effects = [];               // transient visuals (floating text, flashes)
            pkg.GRID = pkg.makeGrid(QUAD.radius); // fixed for the whole game
            this.grid = pkg.GRID;
            this.tiles = new Map();          // "x,y" -> {x, y, kind:"heal" | "harm" | "solid" | "hole" | "loot", timer}
            this.terrainQuads = new Set();   // quadrants whose solid and hole tiles have been placed
            this.borders = new Map();        // border key (see borderKey) -> its wall {door, hole, start}, or null: no wall
            this.tiledQuads = new Set();     // quadrants whose heal and harm tiles have been placed
            this.visitedQuads = new Set();
            this.seenCells = new Set();      // keys of cells that have been in sight (fog of war)
            this.acted = new Set();          // ids of player pieces moved this turn (each can move once a turn)
            this.fresh = new Set();          // ids of pieces placed this turn (can't move until next turn)
            this.movesUsed = 0;              // moves made this turn (counts toward the move limit)
            this.recoverUsed = false;        // whether Recover has been used this turn (once a turn)
            this.quickenUsed = false;        // whether Quicken has been used this turn (once a turn: a move more)
            this.moveMode = pkg.MOVE_MODES.includes(LINK.mode) ? LINK.mode : 'fixed'; // how the player's pieces move (see Movement.js)
            const core = this.addPiece('core', 'player', 0, 0);
            this.playerCoreId = core.id;
            this.recomputeRanks();
            core.hp = core.maxHp;
            this.selectedId = core.id;
            this.corePath = [[0, 0]];       // every cell the core has been on, in order (the golden path)
            this.updateQuadrants();
            const rng = this.rngFor('enemies');
            for (let i = 0; i < SPAWN.initial; i++) this.spawnEnemy(rng);
            this.evaluateObjectives();
        },
        
        /*  A generator for one part of the level, seeded from the game's seed and that part's
            name, so each part comes out the same for a seed whatever order the parts are
            made in (e.g. which way the player explores). Only the level is made this way:
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
                objectives:this.objectives.map(s => ({...s})),
                quadRadius:this.grid.chunkRadius,
                pieces:[...this.pieces.values()].map(p => ({...p})),
                tiles:[...this.tiles.values()].map(t => ({...t})),
                terrainQuads:[...this.terrainQuads],
                borders:[...this.borders],
                tiledQuads:[...this.tiledQuads],
                visitedQuads:[...this.visitedQuads],
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
                level:this.level
            };
        },
        
        // Replaces this game with one from exportToObj(). Throws, leaving this game as it
        // was, if the data is malformed.
        importFromObj: function(o) {
            const isNum = v => Number.isFinite(v),
                isArr = Array.isArray;
            if (!isNum(o?.turn) || !isNum(o.nextId) || !isNum(o.score) || !isNum(o.quadRadius) ||
                ![o.pieces, o.tiles, o.terrainQuads, o.borders ?? [], o.tiledQuads, o.visitedQuads, o.seenCells, o.acted, o.fresh, o.corePath ?? []].every(isArr) ||
                !o.pieces.every(p => isNum(p?.id) && isNum(p.x) && isNum(p.y) && PIECE_TYPES[p.type]) ||
                !o.tiles.every(t => isNum(t?.x) && isNum(t.y) && isNum(t.timer) && typeof t.kind === 'string')
            ) throw new Error('Malformed game data');
            const objectives = o.level?.objectives ?? [];
            try {
                for (const obj of objectives) {
                    pkg.goals.compile(obj.expression);
                    pkg.goals.compileTemplate(obj.progress ?? '');
                }
            } catch (err) {
                throw new Error('Malformed goal: ' + err.message, {cause:err});
            }
            
            this.turn = o.turn;
            this.nextId = o.nextId;
            this.seed = Number.isInteger(o.seed) ? o.seed : null;
            this.score = o.score;
            // Saves from before the total was kept only know what's left to spend.
            this.scoreEarned = Number.isFinite(o.scoreEarned) ? o.scoreEarned : o.score;
            this.over = !!o.over;
            this.outcome = this.over ? (o.outcome === 'won' ? 'won' : 'lost') : null;
            this.lostBy = Number.isInteger(o.lostBy) ? o.lostBy : null;
            // Saves from before these were kept start them at 0.
            this.kills = isNum(o.kills) ? o.kills : 0;
            this.piecesLost = isNum(o.piecesLost) ? o.piecesLost : 0;
            this.piecesPlaced = isNum(o.piecesPlaced) ? o.piecesPlaced : 0;
            this.lootOpened = isNum(o.lootOpened) ? o.lootOpened : 0;
            this.objectives = objectives.map((obj, i) => {
                const s = o.objectives?.[i];
                return {value:!!s?.value, locked:!!s?.locked, progress:typeof s?.progress === 'string' ? s.progress : ''};
            });
            this.effects = [];
            pkg.GRID = pkg.makeGrid(o.quadRadius);
            this.grid = pkg.GRID;
            this.pieces = new Map();
            this.board = new Map();
            for (const p of o.pieces) {
                this.pieces.set(p.id, {...p});
                this.board.set(this.key(p.x, p.y), p.id);
            }
            this.tiles = new Map(o.tiles.map(t => [this.key(t.x, t.y), {...t}]));
            this.terrainQuads = new Set(o.terrainQuads);
            this.borders = new Map(o.borders ?? []);
            this.tiledQuads = new Set(o.tiledQuads);
            this.visitedQuads = new Set(o.visitedQuads);
            this.seenCells = new Set(o.seenCells);
            this.acted = new Set(o.acted);
            this.fresh = new Set(o.fresh);
            // Saves from before moves were counted apart from the pieces that moved.
            this.movesUsed = Number.isInteger(o.movesUsed) ? o.movesUsed : this.acted.size;
            this.recoverUsed = !!o.recoverUsed;
            this.quickenUsed = !!o.quickenUsed;
            this.moveMode = pkg.MOVE_MODES.includes(o.moveMode) ? o.moveMode : 'fixed';
            this.playerCoreId = o.playerCoreId;
            this.selectedId = o.selectedId;
            // Saves from before the path was kept start it where the core is.
            const core = this.getPlayerCore();
            this.corePath = o.corePath?.map(c => [...c]) ?? (core ? [[core.x, core.y]] : []);
            this.level = o.level ?? null;
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
        // Solid tiles block sight; holes don't.
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
                sightKey = [VISION.radius, this.tiles.size, ...players.map(p => this.key(p.x, p.y))].join(';');
            if (sightKey !== this._sightKey) {
                const sight = new Set();
                for (const p of players) {
                    for (const c of pkg.GRID.disk(p.x, p.y, VISION.radius)) {
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
        
        // Is the line from cell a to cell b clear? Solid cells block it, but a line along an
        // edge is only blocked if the cells on both sides are solid. The end cells don't
        // count, so solid cells themselves can be seen.
        canSee: function(a, b) {
            const left = pkg.GRID.line(a, b, 1),
                right = pkg.GRID.line(a, b, -1);
            for (let i = 1; i < left.length - 1; i++) {
                if (this.isSolid(left[i].x, left[i].y) && this.isSolid(right[i].x, right[i].y)) return false;
            }
            return true;
        },
        
        addPiece: function(type, owner, x, y, parentId = null) {
            const s = PIECE_TYPES[type].stats[owner],
                hp = (owner === 'player' ? RANK.hpPer : ENEMY.hpPer) * RANK.base,
                piece = {
                    id:this.nextId++, 
                    type, owner, x, y, parentId,
                    hp, maxHp: hp, 
                    rank:RANK.base, 
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
        // Max HP follows rank; HP is clamped down, and only raised if RANK.rankUpHeals.
        recomputeRanks: function() {
            const all = [...this.pieces.values()],
                kids = new Map(all.map(p => [p.id, []]));
            for (const p of all) if (p.parentId && kids.has(p.parentId)) kids.get(p.parentId).push(p);
            const memo = new Map(),
                rankOf = p => {
                    if (memo.has(p.id)) return memo.get(p.id);
                    const rs = kids.get(p.id).map(rankOf).sort((a, b) => b - a);
                    const r = Math.max(RANK.base, 1 + Math.min(rs[0] || 0, rs[1] || 0));
                    memo.set(p.id, r);
                    return r;
                };
            for (const p of all) {
                const r = rankOf(p),
                    player = p.owner === 'player',
                    newMax = (player ? RANK.hpPer : ENEMY.hpPer) * r;
                if (newMax > p.maxHp && player && RANK.rankUpHeals) p.hp += newMax - p.maxHp;
                p.rank = r; p.maxHp = newMax;
                p.hp = Math.min(p.hp, p.maxHp);
            }
        },
        
        coreRank: function() {
            const c = this.getPlayerCore();
            return c ? c.rank : 0;
        },
        maxRank: function() {return Math.max(0, ...this.piecesOf('player').map(p => p.rank)); },
        moveLimit: function() {return RANK.movesPer * this.maxRank() + (this.quickenUsed ? 1 : 0);},
        // Placing costs more the more pieces you have (the core and detached ones too), but
        // not with rank, so detaching to keep ranks down doesn't make pieces cheaper.
        placeCost: function() {return RANK.placeBase + Math.ceil(this.piecesOf('player').length / Math.max(1, RANK.placePerPieces));},
        
        // Can this player piece still move this turn?
        canMove: function(p) {
            return !this.acted.has(p.id) && !this.fresh.has(p.id) && this.movesUsed < this.moveLimit();
        },
        
        // The piece plus everything linked below it.
        group: function(p) {
            const out = [p];
            for (let i = 0; i < out.length; i++) out.push(...this.children(out[i]));
            return out;
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
                if ((kills || broken) && piece.owner === 'player' && COMBAT.advance && this.pieces.has(piece.id) && this.canStep(piece, m.dx, m.dy, true, mode)) {
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
        
        // Apply tiles under pieces that just moved. Harm first, then heals. Eating n
        // heal tiles in one move makes each worth n x HEAL.amount (n^2 in total).
        landOnTiles: function(pieces) {
            for (const g of pieces) {
                if (this.pieces.has(g.id) && this.isHarm(g.x, g.y)) this.springHarm(g);
            }
            const eaters = pieces.filter(g => this.pieces.has(g.id) && this.tileAt(g.x, g.y, TILE_TYPE_HEAL)),
                n = eaters.length;
            for (const g of eaters) this.consumeHeal(g, g.x, g.y, n);
            if (n > 1) this.fx(eaters[0].x, eaters[0].y, `${n}× heal combo!`, '--heal', {delay:260});
            for (const g of pieces) {
                if (this.pieces.has(g.id)) this.takeLoot(g);
            }
        },
        
        // A player piece on a loot tile takes it: its score is earned and it's gone.
        // Enemies leave loot where it is.
        takeLoot: function(piece) {
            const t = piece.owner === 'player' ? this.tileAt(piece.x, piece.y, TILE_TYPE_LOOT) : null;
            if (t) {
                this.tiles.delete(this.key(t.x, t.y));
                this.lootOpened++;
                this.earn(t.value);
                this.fx(t.x, t.y, `+${t.value}`, '--loot', {});
            }
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
            for (const g of lost.slice(1)) this.fx(g.x, g.y, '', col, {burst:true, delay:80});
            this.fx(target.x, target.y, '', col, { burst: true });
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
        
        // ---- Quadrants & tiles ----
        // Quadrants are the grid's hexagonal chunks.
        quadOf: (x, y) => pkg.GRID.chunkOf(x, y),
        
        // Visits the quadrants holding player pieces. Solid and hole tiles are placed in every
        // quadrant within reach of them: enough quadrants out to cover the vision radius (at
        // least 1), so they exist wherever you could see. This doesn't depend on whether fog
        // of war is on, so turning it off and on doesn't change the world. Heal and harm
        // tiles are placed only 1 quadrant out, so their countdowns are still running when
        // you get there.
        updateQuadrants: function() {
            const reach = Math.max(1, Math.ceil(VISION.radius / (3 * pkg.GRID.chunkRadius + 2)));
            for (const p of this.piecesOf('player')) {
                const [qx, qy] = this.quadOf(p.x, p.y);
                this.visitedQuads.add(qx + ',' + qy);
                for (const q of pkg.GRID.disk(qx, qy, reach)) this.generateTerrain(q.x, q.y);
                for (const q of pkg.GRID.disk(qx, qy, 1)) this.generateTiles(q.x, q.y);
            }
        },
        
        // A quadrant's heal and harm tiles, once, on random free cells. They start with a
        // countdown.
        generateTiles: function(qx, qy) {
            const k = qx + ',' + qy;
            if (this.tiledQuads.has(k)) return;
            this.tiledQuads.add(k);
            // A loot tile replaces a heal tile at lootChance. It's active at once, and its
            // score is rolled now. (Loot has its own generator, so the rest of the
            // quadrant's tiles come out as they would without it.)
            const cells = pkg.GRID.chunkCells(qx, qy),
                rng = this.rngFor('tiles', k),
                lootRng = this.rngFor('loot', k),
                lootLo = Math.min(TILES.lootMin, TILES.lootMax),
                lootHi = Math.max(TILES.lootMin, TILES.lootMax),
                place = kind => {
                    const loot = kind === TILE_TYPE_HEAL && lootRng() * 100 < TILES.lootChance,
                        value = lootLo + Math.floor(lootRng() * (lootHi - lootLo + 1));
                    for (let tries = 0; tries < 50; tries++) {
                        const { x, y } = cells[Math.floor(rng() * cells.length)];
                        const kk = this.key(x, y);
                        if (this.tiles.has(kk) || this.pieceAt(x, y)) continue;
                        const timer = TILES.timerMin + Math.floor(rng() * (TILES.timerMax - TILES.timerMin + 1));
                        this.tiles.set(kk, loot ? {x, y, kind:TILE_TYPE_LOOT, timer:0, value} : { x, y, kind, timer });
                        return;
                    }
                };
            for (let i = 0; i < TILES.healPerQuad; i++) place(TILE_TYPE_HEAL);
            for (let i = 0; i < TILES.harmPerQuad; i++) place(TILE_TYPE_HARM);
        },
        
        // A quadrant's solid and hole tiles, once: the walls on its side of its borders,
        // then a clump of solidMin to solidMax solid tiles, then a clump of holeMin to
        // holeMax holes, which may land on (replace) solid tiles. All are there from the
        // start (no countdown).
        generateTerrain: function(qx, qy) {
            const k = qx + ',' + qy;
            if (this.terrainQuads.has(k)) return;
            this.terrainQuads.add(k);
            const cells = pkg.GRID.chunkCells(qx, qy),
                rng = this.rngFor('terrain', k);
            
            // A wall sits on the side of the quadrant whose key comes first in the border's
            // key, so it's placed when that quadrant is made.
            for (const [i, j] of pkg.GRID.chunkNeighbours(qx, qy)) {
                const bk = this.borderKey(k, i + ',' + j), wall = this.borderWall(bk);
                if (wall && bk.startsWith(k + '|')) this.placeWall(cells, i, j, wall);
            }
            this.placeClump(cells, TILE_TYPE_SOLID, TILES.solidMin, TILES.solidMax, [], rng);
            this.placeClump(cells, TILE_TYPE_HOLE, TILES.holeMin, TILES.holeMax, [TILE_TYPE_SOLID], rng);
        },
        
        // The key of the border between two quadrants ("i,j" keys), the same either way round.
        borderKey: function(a, b) {
            return a < b ? a + '|' + b : b + '|' + a;
        },
        
        // The keys of a quadrant's six borders.
        bordersOf: function(q) {
            const [i, j] = q.split(',').map(Number);
            return pkg.GRID.chunkNeighbours(i, j).map(([a, b]) => this.borderKey(q, a + ',' + b));
        },
        
        // A border as the seed makes it, on its own: a wall {door, hole, start} or null. The
        // wall's door is doorMin to doorMax cells, hole says it's made of holes, and start
        // (0 to 1) says where along the border the door goes.
        seededBorder: function(bk) {
            const rng = this.rngFor('border', bk);
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
                        const all = this.bordersOf(q).sort();
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
            const G = pkg.GRID,
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
                if (!door.has(c) && !this.tiles.has(this.key(c.x, c.y)) && !this.pieceAt(c.x, c.y)) {
                    this.tiles.set(this.key(c.x, c.y), this.makeTile(c.x, c.y, kind, wall.hole ? TILES.wallHole : TILES.wallSolid));
                }
            }
        },
        
        // One connected clump of min to max tiles of a kind within a quadrant's cells: the
        // first on a random free cell, each next one on a free cell touching the clump. A
        // cell is free if no piece is on it and it has no tile, or a tile of a kind in
        // `replaces`. rng picks the cells.
        /*  A terrain tile, there from the start. A solid or hole is of the given subtype
            (see Solids.js), and a solid has its hit points. */
        makeTile: function(x, y, kind, subtype) {
            const tile = {x, y, kind, timer:0};
            if (kind === TILE_TYPE_SOLID) {
                tile.subtype = subtype;
                tile.hp = pkg.solids.get(subtype)?.hp ?? 1;
            } else if (kind === TILE_TYPE_HOLE) {
                tile.subtype = subtype;
            }
            return tile;
        },
        
        placeClump: function(cells, kind, min, max, replaces, rng) {
            const inQuad = new Set(cells.map(c => this.key(c.x, c.y))),
                free = (x, y) => {
                    const k = this.key(x, y), t = this.tiles.get(k);
                    return inQuad.has(k) && (!t || replaces.includes(t.kind)) && !this.pieceAt(x, y);
                },
                count = min + Math.floor(rng() * (max - min + 1));
            const edge = new Map(); // free cells touching the clump, by key
            let options = cells.filter(c => free(c.x, c.y));
            for (let i = 0; i < count && options.length; i++) {
                const {x, y} = options[Math.floor(rng() * options.length)];
                this.tiles.set(this.key(x, y), this.makeTile(x, y, kind, kind === TILE_TYPE_HOLE ? TILES.clumpHole : TILES.clumpSolid));
                edge.delete(this.key(x, y));
                for (const [dx, dy] of pkg.GRID.dirs) {
                    const nx = x + dx,
                        ny = y + dy;
                    if (free(nx, ny)) edge.set(this.key(nx, ny), {x:nx, y:ny});
                }
                options = [...edge.values()];
            }
        },
        
        // Active tile at (x, y), optionally of a given kind.
        tileAt: function(x, y, kind) {
            const t = this.tiles.get(this.key(x, y));
            return t && t.timer <= 0 && (!kind || t.kind === kind) ? t : null;
        },
        isHarm: function(x, y) {
            return !!this.tileAt(x, y, TILE_TYPE_HARM);
        },
        
        // A harm tile damages the piece on it once, then is gone.
        springHarm: function(piece) {
            this.tiles.delete(this.key(piece.x, piece.y));
            this.fx(piece.x, piece.y, '', '--harm', {vanish: true});
            this.damage(piece, TILES.harmDamage, null);
        },
        
        // Count tiles down. A tile that activates under a piece takes effect at once:
        // a heal tile is eaten by a player piece standing on it; a harm tile damages
        // whatever piece is standing on it (and is gone).
        tickTiles: function() {
            const armed = [];
            for (const t of this.tiles.values()) {
                if (t.timer > 0) {
                    t.timer--;
                    if (t.timer === 0) {
                        armed.push(t);
                        this.fx(t.x, t.y, '', t.kind === TILE_TYPE_HEAL ? '--heal' : '--harm', {arm: true});
                    }
                }
            }
            for (const t of armed) {
                if (this.over) return;
                const p = this.pieceAt(t.x, t.y);
                if (p) {
                    if (t.kind === TILE_TYPE_HARM) {
                        this.springHarm(p);
                    } else if (p.owner === 'player') {
                        this.consumeHeal(p, t.x, t.y, 1);
                    }
                }
            }
        },
        
        // ---- Placing linked pieces ----
        // Adds to the score you have, and to the total earned.
        earn: function(n) {
            this.score += n;
            this.scoreEarned += n;
        },
        
        canAffordPlace: function() { return this.score >= this.placeCost(); },
        
        // ---- Heal action ----
        healCost: function() {return RANK.healCostPer * this.coreRank();},
        healAmount: function() {return RANK.healPer * this.coreRank();},
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
                for (const [dx, dy] of pkg.GRID.dirs) {
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
            if (this.tileAt(x, y, TILE_TYPE_HEAL)) this.consumeHeal(p, x, y, 1);
            this.takeLoot(p);
            this.updateQuadrants();
            this.afterPlayerAction();
            return true;
        },
        
        // ---- Heal flow ----
        // A heal tile gives healValue() heal units (x combo). They heal the piece that ate it
        // first; any surplus flows along links: up to the nearest damaged ancestor,
        // or down toward the most damaged child. Units alternate up / down, starting
        // up (so with two spare units one goes up and one goes down). Units that find
        // nobody to heal become score: RANK.healScorePer each.
        // Unvisited quadrants among those around the tile's quadrant (6).
        unvisitedAround: function(x, y) {
            const [qx, qy] = this.quadOf(x, y);
            let n = 0;
            for (const [nx, ny] of pkg.GRID.chunkNeighbours(qx, qy)) {
                if (!this.visitedQuads.has(nx + ',' + ny)) n++;
            }
            return n;
        },
        healValue: function(x, y) {
            return Math.floor(this.unvisitedAround(x, y) / Math.max(1, HEAL.per)) + HEAL.amount;
        },
        
        consumeHeal: function(piece, x, y, mult = 1) {
            const units = this.healValue(x, y) * mult;
            this.tiles.delete(this.key(x, y));
            this.applyHeal(piece, units, true, x, y);
        },
        
        // Heal `units` starting at `piece`, flowing along links. Leftover becomes
        // score only if leftoverToScore.
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
                const gain = units * RANK.healScorePer;
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
            const eligible = this.piecesOf('player').filter(p => !this.acted.has(p.id) && !this.fresh.has(p.id)).length;
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
        // of the turn's moves left, so it's only offered while there's one.
        recoverCost: function(p) {return p.rank;},
        canRecover: function(p) {
            return !this.over && !this.recoverUsed && p?.owner === 'player' &&
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
            const canAct = this.piecesOf('player').some(p => this.legalMoves(p).length || this.canDetach(p) || this.canAttach(p) || this.canSwap(p));
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
            if (this.turn % SPAWN.every === 0) this.spawnWave();
            this.evaluateObjectives();
        },
        
        // Steps-to-reach-a-player-piece for every cell within `radius`, walking
        // around active harm tiles (other pieces are ignored since they move).
        distanceField: function(sources, radius = 30) {
            const dist = new Map(), q = [];
            for (const p of sources) {
                dist.set(this.key(p.x, p.y), 0);
                q.push(p.x, p.y);
            }
            for (let i = 0; i < q.length; i += 2) {
                const x = q[i], y = q[i + 1],
                    d = dist.get(this.key(x, y));
                if (d < radius) {
                    for (const [dx, dy] of pkg.GRID.dirs) {
                        const nx = x + dx,
                            ny = y + dy,
                            k = this.key(nx, ny);
                        if (dist.has(k) || !this.isOpen(nx, ny) || this.isHarm(nx, ny)) continue;
                        dist.set(k, d + 1);
                        q.push(nx, ny);
                    }
                }
            }
            return dist;
        },
        
        // Squad size for a wave at the current turn.
        waveSize: function() {
            const R = Math.max(1, this.maxRank()),
                clock = PRESSURE.timeEvery ? Math.floor(this.turn / PRESSURE.timeEvery) : 0;
            return Math.max(0, PRESSURE.base + PRESSURE.perRank * (R - 1) + clock);
        },
        squadCap: function() {
            const R = Math.max(1, this.maxRank());
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
            const root = this.spawnEnemy(); if (!root) return null;
            const players = this.piecesOf('player');
            const nodes = [root];
            for (let i = 1; i < size; i++) {
                const parent = nodes[Math.floor((i - 1) / 2)];
                const spots = pkg.GRID.dirs.map(([dx, dy]) => ({ x: parent.x + dx, y: parent.y + dy }))
                    .filter(q => this.isOpen(q.x, q.y) && !this.pieceAt(q.x, q.y) && !this.isHarm(q.x, q.y)
                        && !players.some(p => hexDist(p, q) < 2));
                if (!spots.length) break;
                const q = spots[Math.floor(Math.random() * spots.length)];
                nodes.push(this.addPiece('core', 'enemy', q.x, q.y, parent.id));
                this.fx(q.x, q.y, '', '--enemy', { spawn: true });
            }
            this.recomputeRanks();
            for (const n of nodes) n.hp = n.maxHp;
            return root;
        },
        
        // rng picks where: Math.random for waves, the level's generator at the start.
        spawnEnemy: function(rng = Math.random) {
            const core = this.getPlayerCore();
            if (core) {
                const players = this.piecesOf('player');
                for (let tries = 0; tries < 60; tries++) {
                    const d = SPAWN.minDist + Math.floor(rng() * (SPAWN.maxDist - SPAWN.minDist + 1)),
                        {x, y} = pkg.GRID.ring(core.x, core.y, d, rng);
                    if (!this.isOpen(x, y) || this.pieceAt(x, y) || this.isHarm(x, y)) continue;
                    if (players.some(p => hexDist(p, { x, y }) < SPAWN.clearance)) continue;
                    const p = this.addPiece('core', 'enemy', x, y);
                    p.hp = p.maxHp = ENEMY.hpPer * RANK.base;
                    this.fx(x, y, '', '--enemy', { spawn: true });
                    return p;
                }
            }
        },
        
        fx: function(x, y, text, color, opts = {}) {
            this.effects.push({x, y, text, color, t0:performance.now() + (opts.delay || 0), ...opts});
        }
    });
})(hc);
