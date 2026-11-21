/*  Enemy turns: squads near the player plan their turn with a beam search over
    single-piece actions; far squads march as a block. A module included in Game. */
(pkg => {
    'use strict';
    
    const {
        cfg:{AI, RANK},
        hexDist, euclid2, PIECE_TYPES
    } = pkg,
        
        // The movement modes squads plan with near the player (see expand, in planSquad).
        PLAN_MODES = ['fixed', 'free'];
    
    pkg.EnemyAI = new JS.Module('EnemyAI', {
        // ---- Enemy AI ----
        // Each squad (an enemy link tree) gets as many actions as its highest rank,
        // and — like the player — each piece may act at most once. Squads near the
        // player plan their whole turn with a small beam search over sequences of
        // single-piece actions (moving a piece carries everything linked below it),
        // scored by damage dealt and how exposed the squad is when the turn ends.
        // That lets them carry a piece into reach, strike with it, then pull it back
        // out of reach by moving an ancestor. Far-away squads just march as a block.
        enemyPhase: function() {
            let players = this.piecesOf('player');
            if (players.length) {
                const field = this.distanceField(players),
                    fd = p => field.get(this.key(p.x, p.y)) ?? Infinity,
                    front = squad => Math.min(...squad.map(fd)),
                    roots = this.piecesOf('enemy').filter(e => !this.parent(e));
                roots.sort((a, b) => front(this.group(a)) - front(this.group(b)));
                for (const root of roots) {
                    if (this.over) return;
                    if (this.pieces.has(root.id)) {
                        players = this.piecesOf('player');
                        if (!players.length) return;
                        const squad = this.group(root);
                        const budget = RANK.movesPer * Math.max(...squad.map(g => g.rank));
                        if (front(squad) <= AI.planRange) {
                            // Patience: the longer a nearby squad goes without landing a hit, the
                            // less it cares about exposure, so it can't hang back forever.
                            const idle = root.idle || 0,
                                caution = Math.max(0, 1 - idle / Math.max(1, AI.patience)),
                                hpBefore = this.piecesOf('player').reduce((a, q) => a + q.hp, 0),
                                nBefore = this.piecesOf('player').length;
                            for (const a of this.planSquad(squad, budget, field, caution)) {
                                if (this.over) return;
                                const pc = this.pieces.get(a.id);
                                if (!pc || !this.act(pc, pc.x + a.dx, pc.y + a.dy, a.mode)) break;
                            }
                            const hit = this.piecesOf('player').length < nBefore || this.piecesOf('player').reduce((a, q) => a + q.hp, 0) < hpBefore;
                            if (this.pieces.has(root.id)) root.idle = hit ? 0 : idle + 1;
                        } else {
                            this.marchSquad(root, field);
                        }
                    }
                }
            }
        },
        
        // Far from the player: step the squad one cell along the shortest harm-free path,
        // keeping its shape (fixed) if that gets it closer, or else letting it give (follow,
        // then free) to get through tight places.
        marchSquad: function(root, field) {
            const players = this.piecesOf('player'),
                fd = p => field.get(this.key(p.x, p.y)) ?? Infinity,
                members = this.group(root),
                cur = Math.min(...members.map(fd)),
                t = players.reduce((b, q) => hexDist(root, q) < hexDist(root, b) ? q : b);
            let best = null,
                bestKey = [cur, hexDist(root, t) * 1000 + euclid2(root, t)];
            for (const mode of ['fixed', 'follow', 'free']) {
                for (const m of this.legalMoves(root, mode)) {
                    if (!m.attack && this.canStep(root, m.dx, m.dy, true, mode)) {
                        const moved = new Map(m.moves.map(([id, x, y]) => [id, [x, y]])),
                            k = [
                                Math.min(...members.map(g => {
                                    const [x, y] = moved.get(g.id) ?? [g.x, g.y];
                                    return field.get(this.key(x, y)) ?? Infinity;
                                })),
                                hexDist(m, t) * 1000 + euclid2(m, t)
                            ],
                            better = cur !== Infinity
                                ? (k[0] < bestKey[0] || (k[0] === bestKey[0] && best && k[1] < bestKey[1]))
                                : (k[0] < bestKey[0] || (k[0] === Infinity && k[1] < bestKey[1]));
                        if (better) {
                            best = m;
                            bestKey = k;
                        }
                    }
                }
            }
            if (best) this.act(root, best.x, best.y, best.mode);
        },
        
        // Plan a squad's turn. Returns [{ id, dx, dy }] to execute in order.
        planSquad: function(squad, budget, field, caution = 1) {
            const ids = squad.map(p => p.id),
                byId = new Map(squad.map(p => [p.id, p])),
                kids = new Map(ids.map(id => [id, []]));
            for (const p of squad) {
                if (p.parentId && kids.has(p.parentId)) kids.get(p.parentId).push(p.id);
            }
            const subtree = new Map(),
                sub = id => {
                    if (!subtree.has(id)) {
                        const out = [id];
                        for (const c of kids.get(id)) out.push(...sub(c));
                        subtree.set(id, out);
                    }
                    return subtree.get(id);
                };
            ids.forEach(sub);
            const inSquad = new Set(ids);
            
            // Player pieces (static during planning) and their link subtrees for cascade kills.
            const players = this.piecesOf('player'),
                pAt = new Map(players.map(p => [this.key(p.x, p.y), p])),
                pGroup = new Map(players.map(p => [p.id, this.group(p).map(g => g.id)])),
                fdist = (x, y) => {
                    const d = field.get(this.key(x, y));
                    if (d !== undefined) return d;
                    let m = Infinity;
                    for (const p of players) m = Math.min(m, hexDist(p, { x, y }));
                    return m;
                },
                initial = {
                    pos:new Map(squad.map(p => [p.id, [p.x, p.y]])),
                    acted:new Set(),
                    dmg:new Map(),
                    dead:new Set(),
                    gain:0,
                    actions:[]
                },
                occupiedBySquad = st => {
                    const m = new Map();
                    for (const [id, [x, y]] of st.pos) m.set(x + ',' + y, id);
                    return m;
                },
                livePlayerAt = (st, x, y) => {
                    const p = pAt.get(x + ',' + y);
                    return p && !st.dead.has(p.id) ? p : null;
                },
                
                // Score the end state: banked attack value + position.
                evaluate = st => {
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
                },
                
                // Every action an unacted piece could take next, in fixed and free
                // (resolveStep, on the positions being tried; the same result in both is
                // kept once). Follow is only for marching: near the player it would let one
                // piece bring the whole squad in and still leave the leader's group attack,
                // which beats striking and pulling back out of reach.
                expand = st => {
                    const out = [],
                        occ = occupiedBySquad(st),
                        view = {
                            posOf: id => st.pos.get(id),
                            kidsOf: id => kids.get(id),
                            parentOf: id => {
                                const pid = byId.get(id).parentId;
                                return pid && inSquad.has(pid) ? pid : null;
                            },
                            occupant: (x, y) => {
                                const sq = occ.get(x + ',' + y),
                                    other = sq === undefined ? this.pieceAt(x, y) : null;
                                return sq ?? (other && !inSquad.has(other.id) ? other.id : undefined);
                            },
                            open: (x, y) => this.isOpen(x, y) && !this.isHarm(x, y),
                            passable: (x, y) => this.isOpen(x, y),
                            harm: (x, y) => this.tiles.get(this.key(x, y))?.kind === pkg.TILE_TYPE_HARM,
                            target: (id, x, y) => livePlayerAt(st, x, y)
                        };
                    for (const id of ids) {
                        if (st.acted.has(id)) continue;
                        const pc = byId.get(id);
                        for (const [dx, dy] of PIECE_TYPES[pc.type].steps(pc)) {
                            const seen = new Set();
                            for (const mode of PLAN_MODES) {
                                const r = this.resolveStep(view, id, dx, dy, mode),
                                    sig = r ? (r.attack ? 'a' + r.hits.map(t => t.id).sort() : 'm' + r.moves.map(m => m.join(',')).sort().join(';')) : null;
                                if (r && !seen.has(sig)) {
                                    seen.add(sig);
                                    const action = {id, dx, dy, mode};
                                    if (r.attack) {
                                        // Every hit does 1 damage; a piece at 0 HP takes what's below it.
                                        const n = {
                                            pos:st.pos,
                                            acted:new Set(st.acted).add(id),
                                            dmg:new Map(st.dmg),
                                            dead:new Set(st.dead),
                                            gain:st.gain,
                                            actions:[...st.actions, action]
                                        };
                                        for (const t of r.hits) {
                                            if (!n.dead.has(t.id)) {
                                                const d = (n.dmg.get(t.id) || 0) + 1;
                                                n.dmg.set(t.id, d);
                                                n.gain += AI.hit + (t.id === this.playerCoreId ? AI.coreHit : 0);
                                                if (t.hp - d <= 0) {
                                                    const lost = pGroup.get(t.id).filter(x => !n.dead.has(x));
                                                    lost.forEach(x => n.dead.add(x));
                                                    n.gain += AI.killPer * lost.length + (lost.includes(this.playerCoreId) ? AI.coreKill : 0);
                                                }
                                            }
                                        }
                                        out.push(n);
                                    } else {
                                        const pos = new Map(st.pos);
                                        for (const [gid, x, y] of r.moves) pos.set(gid, [x, y]);
                                        out.push({
                                            pos,
                                            acted:new Set(st.acted).add(id),
                                            dmg:st.dmg,
                                            dead:st.dead,
                                            gain:st.gain,
                                            actions:[...st.actions, action]
                                        });
                                    }
                                }
                            }
                        }
                    }
                    return out;
                },
                
                // While searching, a partial plan also gets credit for strikes it has
                // set up but not yet made (unacted pieces next to a player piece, up to
                // the actions left), so "carry into reach, strike, pull back" survives
                // the pruning even though its first step looks bad on its own.
                potential = (st, left) => {
                    if (left <= 0) return 0;
                    let k = 0;
                    for (const id of ids) {
                        if (st.acted.has(id)) continue;
                        const [x, y] = st.pos.get(id);
                        if (pkg.GRID.dirs.some(([dx, dy]) => livePlayerAt(st, x + dx, y + dy))) k++;
                    }
                    return Math.min(k, left) * AI.hit;
                };
            let best = initial,
                bestV = evaluate(initial),
                beam = [initial];
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
                for (const n of beam) {
                    if (n.v > bestV + 1e-9) {
                        best = n;
                        bestV = n.v;
                    }
                }
            }
            return best.actions;
        }
    });
})(hc);
