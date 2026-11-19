/*  Enemy turns: squads near the player plan their turn with a beam search over
    single-piece actions; far squads march as a block. Mixed into Game.prototype. */
(pkg => {
    'use strict';
    
    const {
        cfg:{LINK, AI, RANK},
        cheb, euclid2, PIECE_TYPES
    } = pkg;
    class EnemyAI {
        // ---- Enemy AI ----
        // Each squad (an enemy link tree) gets as many actions as its highest rank,
        // and — like the player — each piece may act at most once. Squads near the
        // player plan their whole turn with a small beam search over sequences of
        // single-piece actions (moving a piece carries everything linked below it),
        // scored by damage dealt and how exposed the squad is when the turn ends.
        // That lets them carry a piece into reach, strike with it, then pull it back
        // out of reach by moving an ancestor. Far-away squads just march as a block.
        enemyPhase() {
            let players = this.piecesOf('player');
            if (!players.length) return;
            const field = this.distanceField(players);
            const fd = p => field.get(this.key(p.x, p.y)) ?? Infinity;
            const front = squad => Math.min(...squad.map(fd));
            const roots = this.piecesOf('enemy').filter(e => !this.parent(e));
            roots.sort((a, b) => front(this.group(a)) - front(this.group(b)));
            for (const root of roots) {
                if (this.over) return;
                if (!this.pieces.has(root.id)) continue;
                players = this.piecesOf('player');
                if (!players.length) return;
                const squad = this.group(root);
                const budget = RANK.movesPer * Math.max(...squad.map(g => g.rank));
                if (front(squad) <= AI.planRange) {
                    // Patience: the longer a nearby squad goes without landing a hit, the
                    // less it cares about exposure, so it can't hang back forever.
                    const idle = root.idle || 0;
                    const caution = Math.max(0, 1 - idle / Math.max(1, AI.patience));
                    const hpBefore = this.piecesOf('player').reduce((a, q) => a + q.hp, 0);
                    const nBefore = this.piecesOf('player').length;
                    for (const a of this.planSquad(squad, budget, field, caution)) {
                        if (this.over) return;
                        const pc = this.pieces.get(a.id);
                        if (!pc || !this.act(pc, pc.x + a.dx, pc.y + a.dy)) break;
                    }
                    const hit = this.piecesOf('player').length < nBefore || this.piecesOf('player').reduce((a, q) => a + q.hp, 0) < hpBefore;
                    if (this.pieces.has(root.id)) root.idle = hit ? 0 : idle + 1;
                } else {
                    this.marchSquad(root, field);
                }
            }
        }
        
        // Far from the player: step the whole squad one cell along the shortest
        // harm-free path, keeping its shape.
        marchSquad(root, field) {
            const players = this.piecesOf('player');
            const fd = p => field.get(this.key(p.x, p.y)) ?? Infinity;
            const members = this.group(root);
            const cur = Math.min(...members.map(fd));
            const t = players.reduce((b, q) => cheb(root, q) < cheb(root, b) ? q : b);
            let best = null, bestKey = [cur, cheb(root, t) * 1000 + euclid2(root, t)];
            for (const m of this.legalMoves(root)) {
                if (m.attack || !this.canStep(root, m.dx, m.dy, true)) continue;
                const k = [Math.min(...members.map(g => field.get(this.key(g.x + m.dx, g.y + m.dy)) ?? Infinity)),
                                      cheb(m, t) * 1000 + euclid2(m, t)];
                const better = cur !== Infinity
                    ? (k[0] < bestKey[0] || (k[0] === bestKey[0] && best && k[1] < bestKey[1]))
                    : (k[0] < bestKey[0] || (k[0] === Infinity && k[1] < bestKey[1]));
                if (better) { best = m; bestKey = k; }
            }
            if (best) this.act(root, best.x, best.y);
        }
        
        // Plan a squad's turn. Returns [{ id, dx, dy }] to execute in order.
        planSquad(squad, budget, field, caution = 1) {
            const ids = squad.map(p => p.id);
            const byId = new Map(squad.map(p => [p.id, p]));
            const kids = new Map(ids.map(id => [id, []]));
            for (const p of squad) if (p.parentId && kids.has(p.parentId)) kids.get(p.parentId).push(p.id);
            const subtree = new Map();
            const sub = id => { if (!subtree.has(id)) { const out = [id]; for (const c of kids.get(id)) out.push(...sub(c)); subtree.set(id, out); } return subtree.get(id); };
            ids.forEach(sub);
            const inSquad = new Set(ids);
            
            // Player pieces (static during planning) and their link subtrees for cascade kills.
            const players = this.piecesOf('player');
            const pAt = new Map(players.map(p => [this.key(p.x, p.y), p]));
            const pGroup = new Map(players.map(p => [p.id, this.group(p).map(g => g.id)]));
            const fdist = (x, y) => {
                const d = field.get(this.key(x, y));
                if (d !== undefined) return d;
                let m = Infinity; for (const p of players) m = Math.min(m, cheb(p, { x, y }));
                return m;
            };
            
            const initial = { pos: new Map(squad.map(p => [p.id, [p.x, p.y]])), acted: new Set(), dmg: new Map(), dead: new Set(), gain: 0, actions: [] };
            const occupiedBySquad = st => { const m = new Map(); for (const [id, [x, y]] of st.pos) m.set(x + ',' + y, id); return m; };
            const livePlayerAt = (st, x, y) => { const p = pAt.get(x + ',' + y); return p && !st.dead.has(p.id) ? p : null; };
            
            // Score the end state: banked attack value + position.
            const evaluate = st => {
                let v = st.gain;
                for (const id of ids) {
                    const [x, y] = st.pos.get(id);
                    let adj = 0;
                    for (const [dx, dy] of pkg.GRID.dirs) if (livePlayerAt(st, x + dx, y + dy)) adj++;
                    if (adj) {
                        const pc = byId.get(id);
                        v -= caution * AI.expose * sub(id).length * (pc.hp <= 1 ? 1 : 0.6);
                    } else {
                        const d = fdist(x, y);
                        v += (d === 2 ? caution * AI.poise : 0) - AI.approach * Math.min(d, 30);
                    }
                }
                return v;
            };
            
            const expand = st => {
                const out = [];
                const occ = occupiedBySquad(st);
                for (const id of ids) {
                    if (st.acted.has(id)) continue;
                    const pc = byId.get(id);
                    const [px, py] = st.pos.get(id);
                    const grp = sub(id), gset = new Set(grp);
                    const par = pc.parentId && inSquad.has(pc.parentId) ? st.pos.get(pc.parentId) : null;
                    for (const [dx, dy] of PIECE_TYPES[pc.type].steps(pc)) {
                        // attack if any member would land on a live player piece
                        const hits = [];
                        for (const gid of grp) {
                            const [gx, gy] = st.pos.get(gid);
                            const t = livePlayerAt(st, gx + dx, gy + dy);
                            if (t) hits.push(t);
                        }
                        if (hits.length) {
                            const n = { pos: st.pos, acted: new Set(st.acted).add(id), dmg: new Map(st.dmg), dead: new Set(st.dead),
                                                    gain: st.gain, actions: [...st.actions, { id, dx, dy }] };
                            for (const t of hits) {
                                if (n.dead.has(t.id)) continue;
                                const d = (n.dmg.get(t.id) || 0) + 1;
                                n.dmg.set(t.id, d);
                                n.gain += AI.hit + (t.id === this.playerCoreId ? AI.coreHit : 0);
                                if (t.hp - d <= 0) {
                                    const lost = pGroup.get(t.id).filter(x => !n.dead.has(x));
                                    lost.forEach(x => n.dead.add(x));
                                    n.gain += AI.killPer * lost.length + (lost.includes(this.playerCoreId) ? AI.coreKill : 0);
                                }
                            }
                            out.push(n);
                            continue;
                        }
                        // otherwise a move: every member lands on a free, harm-free cell
                        let ok = true;
                        for (const gid of grp) {
                            const [gx, gy] = st.pos.get(gid), nx = gx + dx, ny = gy + dy;
                            if (!this.inBounds(nx, ny) || this.isHarm(nx, ny)) { ok = false; break; }
                            const sq = occ.get(nx + ',' + ny);
                            if (sq !== undefined && !gset.has(sq)) { ok = false; break; }
                            if (sq === undefined) {
                                const other = this.pieceAt(nx, ny);
                                if (other && !inSquad.has(other.id)) { ok = false; break; } // other squads / player pieces
                            }
                        }
                        if (!ok) continue;
                        if (par) {
                            const d = cheb({x:px + dx, y:py + dy}, {x:par[0], y:par[1]});
                            if (d > LINK.range && d >= cheb({x:px, y:py}, {x:par[0], y:par[1]})) continue;
                        }
                        const pos = new Map(st.pos);
                        for (const gid of grp) { const [gx, gy] = st.pos.get(gid); pos.set(gid, [gx + dx, gy + dy]);}
                        out.push({pos, acted:new Set(st.acted).add(id), dmg:st.dmg, dead:st.dead, gain:st.gain, actions:[...st.actions, {id, dx, dy}]});
                    }
                }
                return out;
            };
            
            // While searching, a partial plan also gets credit for strikes it has
            // set up but not yet made (unacted pieces next to a player piece, up to
            // the actions left), so "carry into reach, strike, pull back" survives
            // the pruning even though its first step looks bad on its own.
            const potential = (st, left) => {
                if (left <= 0) return 0;
                let k = 0;
                for (const id of ids) {
                    if (st.acted.has(id)) continue;
                    const [x, y] = st.pos.get(id);
                    if (pkg.GRID.dirs.some(([dx, dy]) => livePlayerAt(st, x + dx, y + dy))) k++;
                }
                return Math.min(k, left) * AI.hit;
            };
            let best = initial, bestV = evaluate(initial);
            let beam = [initial];
            for (let depth = 0; depth < budget && beam.length; depth++) {
                const next = [];
                for (const st of beam) for (const n of expand(st)) {
                    n.v = evaluate(n);
                    n.rankV = n.v + potential(n, budget - depth - 1);
                    next.push(n);
                }
                next.sort((a, b) => b.rankV - a.rankV);
                beam = next.slice(0, AI.beam);
                // the actual choice uses only realised value; prefer the shorter plan on ties
                for (const n of beam) if (n.v > bestV + 1e-9) { best = n; bestV = n.v; }
            }
            return best.actions;
        }
    }
    
    const proto = pkg.Game.prototype;
    for (const name of Object.getOwnPropertyNames(EnemyAI.prototype)) {
        if (name !== 'constructor') Object.defineProperty(proto, name, Object.getOwnPropertyDescriptor(EnemyAI.prototype, name));
    }
})(hc);
