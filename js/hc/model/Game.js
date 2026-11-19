/*  The game state and rules: pieces and link trees, ranks, moves and attacks,
    quadrants and tiles, heals, waves and spawning. Enemy turns are in EnemyAI.js. */
(pkg => {
    'use strict';
    
    const {
        cfg:{
            WORLD_LIMIT, QUAD, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, HEAL, RANK
        },
        hexDist, PIECE_TYPES
    } = pkg;
    
    // ---------------------------------------------------------------------------
    // Game state
    // ---------------------------------------------------------------------------
    class Game {
        constructor() {this.reset();}
        
        reset() {
            this.turn = 1;
            this.nextId = 1;
            this.pieces = new Map();        // id -> piece
            this.board = new Map();         // "x,y" -> id
            this.score = 0;
            this.over = false;
            this.effects = [];              // transient visuals (floating text, flashes)
            pkg.GRID = pkg.makeGrid(QUAD.radius); // fixed for the whole game
            this.grid = pkg.GRID;
            this.tiles = new Map();         // "x,y" -> {x, y, kind:"heal" | "harm", timer}
            this.generatedQuads = new Set();
            this.visitedQuads = new Set();
            this.acted = new Set();         // ids of player pieces moved this turn (counts toward the move limit)
            this.fresh = new Set();         // ids of pieces placed this turn (can't move until next turn)
            const core = this.addPiece('core', 'player', 0, 0);
            this.playerCoreId = core.id;
            this.recomputeRanks();
            core.hp = core.maxHp;
            this.selectedId = core.id;
            this.updateQuadrants();
            for (let i = 0; i < SPAWN.initial; i++) this.spawnEnemy();
        }
        
        key(x, y) { return x + ',' + y; }
        inBounds(x, y) { return Math.abs(x) <= WORLD_LIMIT && Math.abs(y) <= WORLD_LIMIT; }
        
        addPiece(type, owner, x, y, parentId = null) {
            const s = PIECE_TYPES[type].stats[owner];
            const hp = (owner === 'player' ? RANK.hpPer : ENEMY.hpPer) * RANK.base;
            const piece = { id: this.nextId++, type, owner, x, y, parentId,
                hp, maxHp: hp, rank: RANK.base, scoreValue: s.scoreValue, score: 0 };
            this.pieces.set(piece.id, piece);
            this.board.set(this.key(x, y), piece.id);
            return piece;
        }
        
        // Remove a single piece from the board.
        removePiece(piece) {
            this.pieces.delete(piece.id);
            this.board.delete(this.key(piece.x, piece.y));
            if (this.selectedId === piece.id) this.selectedId = this.pieces.has(this.playerCoreId) ? this.playerCoreId : null;
        }
        
        pieceAt(x, y) {
            const id = this.board.get(this.key(x, y));
            return id ? this.pieces.get(id) : null;
        }
        
        get selected() { return this.selectedId ? this.pieces.get(this.selectedId) : null; }
        get playerCore() { return this.pieces.get(this.playerCoreId) || null; }
        piecesOf(owner) { return [...this.pieces.values()].filter(p => p.owner === owner); }
        parent(p) { return p.parentId ? this.pieces.get(p.parentId) : null; }
        children(p) { return [...this.pieces.values()].filter(c => c.parentId === p.id); }
        
        // ---- Rank ----
        // rank = max(base, 1 + min(two highest child ranks)), missing children count as 0.
        // Max HP follows rank; HP is clamped down, and only raised if RANK.rankUpHeals.
        recomputeRanks() {
            const all = [...this.pieces.values()];
            const kids = new Map(all.map(p => [p.id, []]));
            for (const p of all) if (p.parentId && kids.has(p.parentId)) kids.get(p.parentId).push(p);
            const memo = new Map();
            const rankOf = p => {
                if (memo.has(p.id)) return memo.get(p.id);
                const rs = kids.get(p.id).map(rankOf).sort((a, b) => b - a);
                const r = Math.max(RANK.base, 1 + Math.min(rs[0] || 0, rs[1] || 0));
                memo.set(p.id, r);
                return r;
            };
            for (const p of all) {
                const r = rankOf(p);
                const player = p.owner === 'player';
                const newMax = (player ? RANK.hpPer : ENEMY.hpPer) * r;
                if (newMax > p.maxHp && player && RANK.rankUpHeals) p.hp += newMax - p.maxHp;
                p.rank = r; p.maxHp = newMax;
                p.hp = Math.min(p.hp, p.maxHp);
            }
        }
        
        coreRank() { const c = this.playerCore; return c ? c.rank : 0; }
        maxRank() { return Math.max(0, ...this.piecesOf('player').map(p => p.rank)); }
        moveLimit() { return RANK.movesPer * this.maxRank(); }
        placeCost() { return RANK.costPer * this.coreRank(); }
        
        // Can this player piece still move this turn?
        canMove(p) {
            return !this.acted.has(p.id) && !this.fresh.has(p.id) && this.acted.size < this.moveLimit();
        }
        
        // The piece plus everything linked below it.
        group(p) {
            const out = [p];
            for (let i = 0; i < out.length; i++) out.push(...this.children(out[i]));
            return out;
        }
        
        // Legal actions for a piece: [{x, y, dx, dy, attack, hits}]
        // The piece and its whole group step together. If any group member would
        // step onto an opposing piece, the action is an attack instead: every such
        // member hits its target and nobody moves.
        legalMoves(piece) {
            if (!piece || this.over) return [];
            if (piece.owner === 'player' && !this.canMove(piece)) return [];
            const group = this.group(piece);
            const ids = new Set(group.map(g => g.id));
            const parent = this.parent(piece);
            const out = [];
            for (const [dx, dy] of PIECE_TYPES[piece.type].steps(piece)) {
                const x = piece.x + dx, y = piece.y + dy;
                if (!this.inBounds(x, y)) continue;
                const occ = this.pieceAt(x, y);
                if (occ && occ.owner === piece.owner && !ids.has(occ.id)) continue;
                const hits = [];
                for (const g of group) {
                    const t = this.pieceAt(g.x + dx, g.y + dy);
                    if (t && t.owner !== g.owner) hits.push({ attacker: g, target: t });
                }
                if (hits.length) { out.push({ x, y, dx, dy, attack: true, hits }); continue; }
                if (!this.groupMoveOk(group, ids, dx, dy)) continue;
                if (parent) {
                    const d = hexDist({ x, y }, parent);
                    if (d > LINK.range && d >= hexDist(piece, parent)) continue;   // must stay in range (or close the gap)
                }
                out.push({ x, y, dx, dy, attack: false });
            }
            return out;
        }
        
        // Could `piece` (with its group) step by (dx, dy) right now? Same rules as a
        // normal move; optionally refuse to step any member onto an active harm tile.
        canStep(piece, dx, dy, avoidHarm = false) {
            const group = this.group(piece);
            const ids = new Set(group.map(g => g.id));
            if (!this.groupMoveOk(group, ids, dx, dy)) return false;
            if (avoidHarm && group.some(g => this.isHarm(g.x + dx, g.y + dy))) return false;
            const parent = this.parent(piece);
            if (parent) {
                const d = hexDist({ x: piece.x + dx, y: piece.y + dy }, parent);
                if (d > LINK.range && d >= hexDist(piece, parent)) return false;
            }
            return true;
        }
        
        // Every member of the group must land on a cell that is empty or vacated by the group.
        groupMoveOk(group, ids, dx, dy) {
            for (const g of group) {
                const x = g.x + dx, y = g.y + dy;
                if (!this.inBounds(x, y)) return false;
                const o = this.pieceAt(x, y);
                if (o && !ids.has(o.id)) return false;
            }
            return true;
        }
        
        findMove(piece, x, y) {
            return this.legalMoves(piece).find(m => m.x === x && m.y === y) || null;
        }
        
        // Combo rule: killing n enemies in one move scores n x (their total value),
        // i.e. n^2 for 1-point enemies.
        act(piece, x, y) {
            const m = this.findMove(piece, x, y);
            if (!m) return false;
            if (m.attack) {
                let kills = 0, value = 0;
                for (const h of m.hits) {
                    if (!this.pieces.has(h.attacker.id) || !this.pieces.has(h.target.id)) continue;
                    const lost = this.damage(h.target, 1, h.attacker);   // includes pieces linked below the target
                    for (const g of lost) { kills++; value += g.scoreValue; h.attacker.score += g.scoreValue; }
                }
                if (kills && piece.owner === 'player') {
                    const gain = kills * value;
                    this.score += gain;
                    this.fx(piece.x, piece.y, kills > 1 ? `+${gain}  ${kills}× combo!` : `+${gain}`, '--gain', { delay: 120 });
                    if (COMBAT.advance && this.pieces.has(piece.id) && this.canStep(piece, m.dx, m.dy, true)) this.moveGroup(piece, m.dx, m.dy);
                }
            } else this.moveGroup(piece, m.dx, m.dy);
            return true;
        }
        
        moveGroup(piece, dx, dy) {
            const group = this.group(piece);
            for (const g of group) this.board.delete(this.key(g.x, g.y));
            for (const g of group) { g.x += dx; g.y += dy; this.board.set(this.key(g.x, g.y), g.id); }
            if (piece.owner === 'player') { this.landOnTiles(group); this.updateQuadrants(); }
        }
        
        // Apply tiles under pieces that just moved. Harm first, then heals. Eating n
        // heal tiles in one move makes each worth n x HEAL.amount (n^2 in total).
        landOnTiles(pieces) {
            for (const g of pieces) if (this.pieces.has(g.id) && this.isHarm(g.x, g.y)) this.damage(g, TILES.harmDamage, null);
            const eaters = pieces.filter(g => this.pieces.has(g.id) && this.tileAt(g.x, g.y, 'heal'));
            const n = eaters.length;
            for (const g of eaters) this.consumeHeal(g, g.x, g.y, n);
            if (n > 1) this.fx(eaters[0].x, eaters[0].y, `${n}× heal combo!`, '--heal', { delay: 260 });
        }
        
        // Damage a piece; returns the list of pieces destroyed (empty if it survived).
        // Destroying a piece also destroys everything linked below it.
        damage(target, dmg, attacker) {
            target.hp -= dmg;
            this.fx(target.x, target.y, `-${dmg}`, '--dmg', { flash: true, bump: attacker ? { from: attacker } : null });
            if (target.hp > 0) return [];
            const lost = this.group(target);
            const col = target.owner === 'player' ? '--core' : '--enemy';
            for (const g of lost) this.removePiece(g);
            for (const g of lost.slice(1)) this.fx(g.x, g.y, '', col, { burst: true, delay: 80 });
            this.fx(target.x, target.y, '', col, { burst: true });
            if (lost.some(g => g.id === this.playerCoreId)) this.over = true;
            this.recomputeRanks();
            return lost;
        }
        
        // Back-compat helper (single hit, scored as a 1-kill move).
        attack(attacker, target, dmg = 1) {
            const lost = this.damage(target, dmg, attacker);
            const v = lost.reduce((a, g) => a + g.scoreValue, 0);
            if (v && attacker.owner === 'player') { this.score += v * lost.length; attacker.score += v; }
            return lost.length > 0;
        }
        
        // ---- Quadrants & tiles ----
        // Quadrants are the grid's hexagonal chunks.
        quadOf(x, y) { return pkg.GRID.chunkOf(x, y); }
        
        updateQuadrants() {
            const before = this.visitedQuads.size;
            for (const p of this.piecesOf('player')) {
                const [qx, qy] = this.quadOf(p.x, p.y);
                this.visitedQuads.add(qx + ',' + qy);
                this.generateQuad(qx, qy);
                for (const [nx, ny] of pkg.GRID.chunkNeighbours(qx, qy)) this.generateQuad(nx, ny);
            }
            if (this.visitedQuads.size !== before) this.clearSurroundedHarm();
        }
        
        // Harm tiles vanish once every quadrant around theirs has been visited.
        clearSurroundedHarm() {
            for (const [k, t] of this.tiles) {
                if (t.kind !== 'harm' || this.unvisitedAround(t.x, t.y) > 0) continue;
                this.tiles.delete(k);
                this.fx(t.x, t.y, '', '--harm', { vanish: true });
            }
        }
        
        generateQuad(qx, qy) {
            const k = qx + ',' + qy;
            if (this.generatedQuads.has(k)) return;
            this.generatedQuads.add(k);
            const cells = pkg.GRID.chunkCells(qx, qy);
            const place = kind => {
                for (let tries = 0; tries < 50; tries++) {
                    const { x, y } = cells[Math.floor(Math.random() * cells.length)];
                    const kk = this.key(x, y);
                    if (this.tiles.has(kk) || this.pieceAt(x, y)) continue;
                    const timer = TILES.timerMin + Math.floor(Math.random() * (TILES.timerMax - TILES.timerMin + 1));
                    this.tiles.set(kk, { x, y, kind, timer });
                    return;
                }
            };
            for (let i = 0; i < TILES.healPerQuad; i++) place('heal');
            for (let i = 0; i < TILES.harmPerQuad; i++) place('harm');
        }
    
        // Active tile at (x, y), optionally of a given kind.
        tileAt(x, y, kind) {
            const t = this.tiles.get(this.key(x, y));
            return t && t.timer <= 0 && (!kind || t.kind === kind) ? t : null;
        }
        isHarm(x, y) { return !!this.tileAt(x, y, 'harm'); }
        
        // Count tiles down. A tile that activates under a piece takes effect at once:
        // a heal tile is eaten by a player piece standing on it; a harm tile damages
        // whatever piece is standing on it (and stays).
        tickTiles() {
            const armed = [];
            for (const t of this.tiles.values()) {
                if (t.timer <= 0) continue;
                t.timer--;
                if (t.timer === 0) { armed.push(t); this.fx(t.x, t.y, '', t.kind === 'heal' ? '--heal' : '--harm', { arm: true }); }
            }
            for (const t of armed) {
                if (this.over) return;
                const p = this.pieceAt(t.x, t.y);
                if (!p) continue;
                if (t.kind === 'harm') this.damage(p, TILES.harmDamage, null);
                else if (p.owner === 'player') this.consumeHeal(p, t.x, t.y, 1);
            }
        }
        
        // ---- Placing linked pieces ----
        canAffordPlace() { return this.score >= this.placeCost(); }
        
        // ---- Heal action ----
        healCost() { return RANK.healCostPer * this.coreRank(); }
        healAmount() { return RANK.healPer * this.coreRank(); }
        anyDamaged() { return this.piecesOf('player').some(p => p.hp < p.maxHp); }
        canAffordHeal() { return this.score >= this.healCost(); }
        
        // Spend score to heal: healAmount() units start at the chosen piece and flow
        // along links exactly like a heal tile. Unused units are lost. Doesn't use a move.
        playerHeal(piece) {
            if (this.over || !piece || piece.owner !== 'player' || !this.canAffordHeal() || !this.anyDamaged()) return false;
            const cost = this.healCost();
            this.score -= cost;
            this.fx(piece.x, piece.y, `-${cost} score`, '--place-ink', {});
            this.applyHeal(piece, this.healAmount(), false);
            return true;
        }
        
        // Empty cells adjacent to at least one player piece.
        placeCells() {
            const seen = new Set(), out = [];
            for (const p of this.piecesOf('player')) for (const [dx, dy] of pkg.GRID.dirs) {
                const x = p.x + dx, y = p.y + dy, k = this.key(x, y);
                if (seen.has(k) || !this.inBounds(x, y) || this.pieceAt(x, y) || this.isHarm(x, y)) continue;
                seen.add(k); out.push({ x, y });
            }
            return out;
        }
        
        // Player pieces a new piece at (x, y) could link to.
        linkCandidates(x, y) {
            return this.piecesOf('player').filter(p => hexDist(p, { x, y }) === 1);
        }
        
        playerPlace(x, y, parent) {
            if (this.over || !this.canAffordPlace()) return false;
            if (this.pieceAt(x, y) || !parent || parent.owner !== 'player' || hexDist(parent, { x, y }) !== 1) return false;
            const cost = this.placeCost();
            this.score -= cost;
            const p = this.addPiece('core', 'player', x, y, parent.id);
            this.fresh.add(p.id);           // a newly placed piece can't move until next turn
            this.recomputeRanks();
            p.hp = p.maxHp;
            this.fx(x, y, `-${cost} score`, '--place-ink', { spawn: true });
            if (this.tileAt(x, y, 'heal')) this.consumeHeal(p, x, y, 1);
            this.updateQuadrants();
            this.afterPlayerAction();
            return true;
        }
        
        // ---- Heal flow ----
        // A heal tile gives healValue() heal units (x combo). They heal the piece that ate it
        // first; any surplus flows along links: up to the nearest damaged ancestor,
        // or down toward the most damaged child. Units alternate up / down, starting
        // up (so with two spare units one goes up and one goes down). Units that find
        // nobody to heal become score: RANK.healScorePer each.
        // Unvisited quadrants among those around the tile's quadrant (6).
        unvisitedAround(x, y) {
            const [qx, qy] = this.quadOf(x, y);
            let n = 0;
            for (const [nx, ny] of pkg.GRID.chunkNeighbours(qx, qy)) if (!this.visitedQuads.has(nx + ',' + ny)) n++;
            return n;
        }
        healValue(x, y) { return Math.floor(this.unvisitedAround(x, y) / Math.max(1, HEAL.per)) + HEAL.amount; }
        
        consumeHeal(piece, x, y, mult = 1) {
            const units = this.healValue(x, y) * mult;
            this.tiles.delete(this.key(x, y));
            this.applyHeal(piece, units, true, x, y);
        }
        
        // Heal `units` starting at `piece`, flowing along links. Leftover becomes
        // score only if leftoverToScore.
        applyHeal(piece, units, leftoverToScore, x = piece.x, y = piece.y) {
            const self = Math.min(units, piece.maxHp - piece.hp);
            if (self > 0) { piece.hp += self; units -= self; this.fx(piece.x, piece.y, `+${self} HP`, '--heal', { delay: 60 }); }
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
                piece.score += gain; this.score += gain;
                this.fx(x, y, `+${gain} score`, '--gain', { delay: 60 });
            }
        }
        
        // Nearest damaged ancestor.
        healTargetUp(p) {
            for (let a = this.parent(p); a; a = this.parent(a)) if (a.hp < a.maxHp) return a;
            return null;
        }
        
        // Walk down: heal the most damaged child; if no child is damaged, follow the
        // child whose branch has the most missing HP.
        healTargetDown(p) {
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
        }
        
        // ---- Turn flow ----
        // Each turn you may move up to moveLimit() different pieces (= core rank),
        // each at most once, in any order. Only the piece you choose spends a move;
        // pieces it carries keep theirs.
        playerAct(piece, x, y) {
            if (this.over || !piece || piece.owner !== 'player' || !this.canMove(piece)) return false;
            if (!this.act(piece, x, y)) return false;
            if (this.pieces.has(piece.id)) this.acted.add(piece.id);
            this.afterPlayerAction();
            return true;
        }
        
        movesLeft() {
            const eligible = this.piecesOf('player').filter(p => !this.acted.has(p.id) && !this.fresh.has(p.id)).length;
            return Math.max(0, Math.min(this.moveLimit() - this.acted.size, eligible));
        }
        
        afterPlayerAction() {
            if (this.over) return;
            // Auto-end once no piece can act and there's nothing to spend score on.
            const canAct = this.piecesOf('player').some(p => this.legalMoves(p).length);
            if (!canAct && !this.canAffordPlace()) { this.endPlayerTurn(); return; }
            // Keep a piece that can still move selected.
            const sel = this.selected;
            if (!sel || !this.canMove(sel)) {
                const next = this.piecesOf('player').find(p => this.canMove(p));
                if (next) this.selectedId = next.id;
            }
        }
        
        playerWait() {
            if (this.over) return;
            this.endPlayerTurn();
        }
        
        endPlayerTurn() {
            this.enemyPhase();
            if (this.over) return;
            this.acted.clear();
            this.fresh.clear();
            const core = this.playerCore;
            if (core && !this.selected) this.selectedId = core.id;
            this.turn++;
            this.tickTiles();
            if (this.over) return;
            if (this.turn % SPAWN.every === 0) this.spawnWave();
        }
        
        // Steps-to-reach-a-player-piece for every cell within `radius`, walking
        // around active harm tiles (other pieces are ignored since they move).
        distanceField(sources, radius = 30) {
            const dist = new Map(), q = [];
            for (const p of sources) { dist.set(this.key(p.x, p.y), 0); q.push(p.x, p.y); }
            for (let i = 0; i < q.length; i += 2) {
                const x = q[i], y = q[i + 1], d = dist.get(this.key(x, y));
                if (d >= radius) continue;
                for (const [dx, dy] of pkg.GRID.dirs) {
                    const nx = x + dx, ny = y + dy, k = this.key(nx, ny);
                    if (dist.has(k) || this.isHarm(nx, ny)) continue;
                    dist.set(k, d + 1); q.push(nx, ny);
                }
            }
            return dist;
        }
        
        // Squad size for a wave at the current turn.
        waveSize() {
            const R = Math.max(1, this.maxRank());
            const clock = PRESSURE.timeEvery ? Math.floor(this.turn / PRESSURE.timeEvery) : 0;
            return Math.max(0, PRESSURE.base + PRESSURE.perRank * (R - 1) + clock);
        }
        squadCap() {
            const R = Math.max(1, this.maxRank());
            return Math.max(1, Math.min(ENEMY.maxSquad, R + PRESSURE.squadExtra));
        }
        turnsToWave() { const r = this.turn % SPAWN.every; return r === 0 ? SPAWN.every : SPAWN.every - r; }
        
        // Split the wave's enemies into squads of (cap or cap-1) pieces.
        spawnWave() {
            let left = this.waveSize();
            const cap = this.squadCap();
            while (left > 0) {
                const size = Math.min(left, Math.max(1, cap - Math.floor(Math.random() * 2)));
                this.spawnSquad(size);
                left -= size;
            }
        }
        
        // Spawn a squad of `size` enemies shaped as a binary tree (piece i links to
        // piece floor((i-1)/2)), so a squad of 3 is rank 2, 7 is rank 3, etc.
        spawnSquad(size) {
            const root = this.spawnEnemy(); if (!root) return null;
            const players = this.piecesOf('player');
            const nodes = [root];
            for (let i = 1; i < size; i++) {
                const parent = nodes[Math.floor((i - 1) / 2)];
                const spots = pkg.GRID.dirs.map(([dx, dy]) => ({ x: parent.x + dx, y: parent.y + dy }))
                    .filter(q => this.inBounds(q.x, q.y) && !this.pieceAt(q.x, q.y) && !this.isHarm(q.x, q.y)
                        && !players.some(p => hexDist(p, q) < 2));
                if (!spots.length) break;
                const q = spots[Math.floor(Math.random() * spots.length)];
                nodes.push(this.addPiece('core', 'enemy', q.x, q.y, parent.id));
                this.fx(q.x, q.y, '', '--enemy', { spawn: true });
            }
            this.recomputeRanks();
            for (const n of nodes) n.hp = n.maxHp;
            return root;
        }
        
        spawnEnemy() {
            const core = this.playerCore; if (!core) return;
            const players = this.piecesOf('player');
            for (let tries = 0; tries < 60; tries++) {
                const d = SPAWN.minDist + Math.floor(Math.random() * (SPAWN.maxDist - SPAWN.minDist + 1));
                const { x, y } = pkg.GRID.ring(core.x, core.y, d);
                if (!this.inBounds(x, y) || this.pieceAt(x, y) || this.isHarm(x, y)) continue;
                if (players.some(p => hexDist(p, { x, y }) < SPAWN.clearance)) continue;
                const p = this.addPiece('core', 'enemy', x, y);
                p.hp = p.maxHp = ENEMY.hpPer * RANK.base;
                this.fx(x, y, '', '--enemy', { spawn: true });
                return p;
            }
        }
        
        fx(x, y, text, color, opts = {}) {
            this.effects.push({x, y, text, color, t0:performance.now() + (opts.delay || 0), ...opts});
        }
    }
    
    pkg.Game = Game;
})(hc);
