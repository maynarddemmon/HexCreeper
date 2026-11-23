/*  The "squad" enemy AI. Each squad (an enemy link tree) gets as many actions as its
    highest rank, and — like the player — each piece may act at most once. Squads near the
    player (planRange) plan their whole turn with a small beam search over sequences of
    single-piece actions (moving a piece carries everything linked below it), scored by
    damage dealt and how exposed the squad is when the turn ends. That lets them carry a
    piece into reach, strike with it, then pull it back out of reach by moving an ancestor.
    Far-away squads just march as a block. */
(pkg => {
    'use strict';
    
    const {
        attrs:{num},
        hexDist, euclid2, PIECE_TYPES
    } = pkg,
        
        // The movement modes squads plan with near the player (see expand, in planSquad).
        PLAN_MODES = ['fixed', 'free'];
    
    pkg.SquadAI = new JS.Class('SquadAI', pkg.EnemyAI, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[
                num('planRange', 6, 1, 30),        // squads whose nearest piece is within this many steps plan their turn
                num('beam', 12, 1, 100),           // plans kept per search step
                num('hit', 10, 0, 100),            // value of each hit on a player piece
                num('killPer', 6, 0, 100),         // extra value per player piece destroyed (incl. pieces linked below it)
                num('coreHit', 15, 0, 100),        // extra value for hitting the player's core
                num('coreKill', 1000, 0, 10000),   // destroying the core
                num('expose', 12, 0, 50),          // caution: penalty per piece (incl. pieces linked below) left next to a player piece
                num('patience', 2, 1, 20),         // turns without a hit before a nearby squad stops minding exposure
                num('poise', 1, 0, 10, 0.1),       // bonus for a piece ending exactly 2 steps away (can strike next turn, can't be hit)
                num('approach', 0.5, 0, 10, 0.1),  // penalty per step of distance for pieces further away
                num('jump', 0.5, 0, 10, 0.1),      // cost of a jump: the piece sits out next turn, which is worth a step of approach
                num('jumpClose', 1, 0, 10)         // pieces this close (steps) to a player piece don't jump when planning
            ]
        },
        
        // Methods /////////////////////////////////////////////////////////////
        // Each squad, nearest the player first.
        takeTurn: function() {
            let players = this.game.piecesOf('player');
            // (Without enemies there's nothing to plan, so no distances to work out.)
            if (players.length && this.game.piecesOf('enemy').length) {
                const field = this.game.distanceField(players),
                    fd = p => field.get(this.game.key(p.x, p.y)) ?? Infinity,
                    front = squad => Math.min(...squad.map(fd)),
                    roots = this.game.piecesOf('enemy').filter(e => !this.game.parent(e));
                roots.sort((a, b) => front(this.game.group(a)) - front(this.game.group(b)));
                for (const root of roots) {
                    if (this.game.over) return;
                    if (this.game.pieces.has(root.id)) {
                        players = this.game.piecesOf('player');
                        if (!players.length) return;
                        this.game.endAction();
                        this.game.track = root.id;
                        const squad = this.game.group(root);
                        const budget = this.game.rules.movesPer * Math.max(...squad.map(g => g.rank));
                        if (front(squad) <= this.attrs.planRange) {
                            // Patience: the longer a nearby squad goes without landing a hit, the
                            // less it cares about exposure, so it can't hang back forever.
                            const idle = root.idle || 0,
                                caution = Math.max(0, 1 - idle / Math.max(1, this.attrs.patience)),
                                hpBefore = this.game.piecesOf('player').reduce((a, q) => a + q.hp, 0),
                                nBefore = this.game.piecesOf('player').length;
                            for (const a of this.planSquad(squad, budget, field, caution)) {
                                if (this.game.over) return;
                                const pc = this.game.pieces.get(a.id);
                                if (a.swap) {
                                    const other = this.game.pieces.get(a.swap);
                                    if (!pc || !other || !this.game.swapOk(this.game.boardView(), pc.id, other.id)) break;
                                    this.game.swapPieces(pc, other);
                                } else if (a.jump) {
                                    if (!pc || !this.game.jumpPiece(pc, ...a.jump)) break;
                                } else if (!pc || !this.game.act(pc, pc.x + a.dx, pc.y + a.dy, a.mode)) {
                                    break;
                                }
                                this.game.endAction();
                            }
                            const hit = this.game.piecesOf('player').length < nBefore || this.game.piecesOf('player').reduce((a, q) => a + q.hp, 0) < hpBefore;
                            if (this.game.pieces.has(root.id)) root.idle = hit ? 0 : idle + 1;
                        } else {
                            this.marchSquad(root, field);
                        }
                    }
                }
            }
        },
        
        // Far from the player: step the squad one cell along the shortest path (see
        // distanceField), keeping its shape (fixed) if that gets it closer, or else letting
        // it give (follow, then free) to get through tight places. If no step gets it closer
        // (a line of holes in the way, say), one of its pieces jumps instead, if that gets
        // the squad's nearest piece closer, or else its pieces closer in all: so the rest
        // can follow the first over. A tired leader doesn't step, but the others may jump.
        marchSquad: function(root, field) {
            const players = this.game.piecesOf('player'),
                fd = p => field.get(this.game.key(p.x, p.y)) ?? Infinity,
                members = this.game.group(root),
                cur = Math.min(...members.map(fd)),
                t = players.reduce((b, q) => hexDist(root, q) < hexDist(root, b) ? q : b);
            let best = null,
                bestKey = [cur, hexDist(root, t) * 1000 + euclid2(root, t)];
            for (const mode of this.game.isTired(root) ? [] : ['fixed', 'follow', 'free']) {
                for (const m of this.game.legalMoves(root, mode)) {
                    if (!m.attack && this.game.canStep(root, m.dx, m.dy, true, mode)) {
                        const moved = new Map(m.moves.map(([id, x, y]) => [id, [x, y]])),
                            k = [
                                Math.min(...members.map(g => {
                                    const [x, y] = moved.get(g.id) ?? [g.x, g.y];
                                    return field.get(this.game.key(x, y)) ?? Infinity;
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
            if (!(best && bestKey[0] < cur) && cur !== Infinity) {
                // [nearest, total] after a jump of piece g to (x, y)
                const sumOf = vals => vals.reduce((a, v) => a + v, 0),
                    after = (g, x, y) => {
                        const vals = members.map(m => m === g ? field.get(this.game.key(x, y)) ?? Infinity : fd(m));
                        return [Math.min(...vals), sumOf(vals)];
                    },
                    view = this.game.boardView(true);
                let jump = null,
                    jumpKey = [cur, sumOf(members.map(fd))];
                for (const g of members) {
                    if (!this.game.isTired(g)) {
                        for (const c of this.game.jumpCells(view, g.id, true)) {
                            const k = after(g, c.x, c.y);
                            if (k[0] < jumpKey[0] || (k[0] === jumpKey[0] && k[1] < jumpKey[1])) {
                                jump = [g, c];
                                jumpKey = k;
                            }
                        }
                    }
                }
                if (jump) {
                    best = null;
                    this.game.jumpPiece(jump[0], jump[1].x, jump[1].y);
                }
            }
            if (best) this.game.act(root, best.x, best.y, best.mode);
        },
        
        // Plan a squad's turn. Returns the actions to carry out in order: {id, dx, dy, mode}
        // to step, {id, swap} to swap with another squad piece, or {id, jump:[x, y]}. Pieces
        // tired from a jump last turn can't act.
        planSquad: function(squad, budget, field, caution = 1) {
            const A = this.attrs,
                ids = squad.map(p => p.id),
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
            const players = this.game.piecesOf('player'),
                pAt = new Map(players.map(p => [this.game.key(p.x, p.y), p])),
                pGroup = new Map(players.map(p => [p.id, this.game.group(p).map(g => g.id)])),
                fdist = (x, y) => {
                    const d = field.get(this.game.key(x, y));
                    if (d !== undefined) return d;
                    let m = Infinity;
                    for (const p of players) m = Math.min(m, hexDist(p, { x, y }));
                    return m;
                },
                initial = {
                    pos:new Map(squad.map(p => [p.id, [p.x, p.y]])),
                    acted:new Set(ids.filter(id => this.game.isTired(byId.get(id)))),
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
                        for (const [dx, dy] of pkg.hex.dirs) if (livePlayerAt(st, x + dx, y + dy)) adj++;
                        if (adj) {
                            const pc = byId.get(id);
                            v -= caution * A.expose * sub(id).length * (pc.hp <= 1 ? 1 : 0.6);
                        } else {
                            const d = fdist(x, y);
                            v += (d === 2 ? caution * A.poise : 0) - A.approach * Math.min(d, 30);
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
                                    other = sq === undefined ? this.game.pieceAt(x, y) : null;
                                return sq ?? (other && !inSquad.has(other.id) ? other.id : undefined);
                            },
                            open: (x, y) => this.game.isOpen(x, y) && !this.game.isHarm(x, y),
                            passable: (x, y) => this.game.isOpen(x, y),
                            harm: (x, y) => this.game.isHarm(x, y),
                            target: (id, x, y) => livePlayerAt(st, x, y)
                        };
                    for (const id of ids) {
                        if (st.acted.has(id)) continue;
                        const pc = byId.get(id);
                        // Swapping with a squad piece next to it that hasn't acted: both are
                        // then done.
                        for (const other of ids) {
                            if (other > id && !st.acted.has(other) && this.game.swapOk(view, id, other)) {
                                const pos = new Map(st.pos);
                                pos.set(id, st.pos.get(other));
                                pos.set(other, st.pos.get(id));
                                out.push({
                                    pos,
                                    acted:new Set(st.acted).add(id).add(other),
                                    dmg:st.dmg,
                                    dead:st.dead,
                                    gain:st.gain,
                                    actions:[...st.actions, {id, swap:other}]
                                });
                            }
                        }
                        for (const [dx, dy] of PIECE_TYPES[pc.type].steps(pc)) {
                            const seen = new Set();
                            for (const mode of PLAN_MODES) {
                                const r = this.game.resolveStep(view, id, dx, dy, mode),
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
                                                n.gain += A.hit + (t.id === this.game.playerCoreId ? A.coreHit : 0);
                                                if (t.hp - d <= 0) {
                                                    const lost = pGroup.get(t.id).filter(x => !n.dead.has(x));
                                                    lost.forEach(x => n.dead.add(x));
                                                    n.gain += A.killPer * lost.length + (lost.includes(this.game.playerCoreId) ? A.coreKill : 0);
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
                        // Jumping: only it moves, two cells, and it's then done, and tired next
                        // turn, which costs jump. After the steps, so a step wins a tie.
                        // Only over gaps (holes, harm): in open ground a jump gets it no
                        // nearer than walking, and leaves it unable to strike next turn.
                        // Not within jumpClose of a player piece, where sitting out the
                        // next turn would spoil striking and pulling back: it's for getting
                        // to the player, over holes, say.
                        const [x0, y0] = st.pos.get(id),
                            near = players.some(p => !st.dead.has(p.id) && hexDist(p, {x:x0, y:y0}) <= A.jumpClose);
                        for (const {x, y} of near ? [] : this.game.jumpCells(view, id, true)) {
                            const pos = new Map(st.pos);
                            pos.set(id, [x, y]);
                            out.push({
                                pos,
                                acted:new Set(st.acted).add(id),
                                dmg:st.dmg,
                                dead:st.dead,
                                gain:st.gain - A.jump,
                                actions:[...st.actions, {id, jump:[x, y]}]
                            });
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
                        if (pkg.hex.dirs.some(([dx, dy]) => livePlayerAt(st, x + dx, y + dy))) k++;
                    }
                    return Math.min(k, left) * A.hit;
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
                beam = next.slice(0, A.beam);
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
    pkg.EnemyAI.register('squad', pkg.SquadAI);
})(hc);
