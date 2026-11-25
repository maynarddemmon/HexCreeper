/*  The "squad" enemy AI. Each squad (an enemy link tree) gets as many actions as its
    highest rank, and — like the player — each piece may act at most once. Squads near the
    player (planRange) plan their whole turn with a small beam search over sequences of
    single-piece actions (moving a piece carries everything linked below it), scored by
    the damage they can expect to deal (each strike's hit chance and damage odds, and the
    chances of a kill: see Combat.js) and how exposed the squad is when the turn ends.
    That lets them carry a piece into reach, strike with it, then pull it back out of
    reach by moving an ancestor. A plan that goes stale as it's carried out (a strike kills
    its target, so the next attack there would be a step) is made again from there. Far-away
    squads just march as a block. */
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
                num('hit', 10, 0, 100),            // value of each HP of damage a strike can be expected to do to a player piece
                num('killPer', 6, 0, 100),         // extra value per player piece destroyed (incl. pieces linked below it), times the chance
                num('coreHit', 15, 0, 100),        // extra value per HP of damage to the player's core
                num('coreKill', 1000, 0, 10000),   // destroying the core, times the chance
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
                let walkField = null;
                // A squad none of whose pieces can ever have a jump's points goes by the
                // field without jumps (made only if it's needed).
                const field = this.game.distanceField(players),
                    canJump = squad => squad.some(g => this.game.apMax(g) >= this.game.jumpCost(g)),
                    fieldFor = squad => canJump(squad) ? field : (walkField ??= this.game.distanceField(players, 30, false)),
                    fd = p => field.get(this.game.key(p.x, p.y)) ?? Infinity,
                    front = squad => Math.min(...squad.map(fd)),
                    roots = this.game.piecesOf('enemy').filter(e => !this.game.parent(e)),
                    // the most actions a squad has the points for
                    budgetOf = squad => squad.reduce((n, g) => n + Math.floor(g.ap / this.game.actionCost(g)), 0);
                roots.sort((a, b) => front(this.game.group(a)) - front(this.game.group(b)));
                for (const root of roots) {
                    if (this.game.over) return;
                    if (this.game.pieces.has(root.id)) {
                        players = this.game.piecesOf('player');
                        if (!players.length) return;
                        this.game.endAction();
                        this.game.track = root.id;
                        const squad = this.game.group(root),
                            budget = budgetOf(squad);
                        if (!budget) continue;
                        if (front(squad) <= this.attrs.planRange) {
                            // Patience: the longer a nearby squad goes without landing a hit, the
                            // less it cares about exposure, so it can't hang back forever.
                            const idle = root.idle || 0,
                                caution = Math.max(0, 1 - idle / Math.max(1, this.attrs.patience)),
                                hpBefore = this.game.piecesOf('player').reduce((a, q) => a + q.hp, 0),
                                nBefore = this.game.piecesOf('player').length;
                            let plan = this.planSquad(squad, budget, fieldFor(squad), caution),
                                next = 0,
                                fresh = true,
                                ok = true;
                            while (ok && next < plan.length && !this.game.over) {
                                const a = plan[next++],
                                    pc = this.game.pieces.get(a.id),
                                    m = pc && !a.swap && !a.jump ? this.game.findMove(pc, pc.x + a.dx, pc.y + a.dy, a.mode) : null;
                                if (m && !m.attack !== !a.attack) {
                                    // Stale: plan the rest of the turn again, from here (unless
                                    // the plan was only just made, which would go round again).
                                    ok = !fresh && this.game.pieces.has(root.id);
                                    if (ok) {
                                        const rest = this.game.group(root);
                                        plan = this.planSquad(rest, budgetOf(rest), fieldFor(rest), caution);
                                        next = 0;
                                        fresh = true;
                                    }
                                } else {
                                    ok = this.carryOut(a, pc, m);
                                    fresh = false;
                                    if (ok) this.game.endAction();
                                }
                            }
                            if (this.game.over) return;
                            const hit = this.game.piecesOf('player').length < nBefore || this.game.piecesOf('player').reduce((a, q) => a + q.hp, 0) < hpBefore;
                            if (this.game.pieces.has(root.id)) root.idle = hit ? 0 : idle + 1;
                        } else {
                            this.marchSquad(root, fieldFor(squad));
                        }
                    }
                }
            }
        },
        
        /*  Carries out planned action a (see planSquad) with piece pc, if it has the points
            for it and it can: m is the move, for a step or an attack (Game.findMove).
            Returns whether it did. */
        carryOut: function(a, pc, m) {
            let done = false;
            if (a.swap) {
                const other = this.game.pieces.get(a.swap);
                done = this.game.canAfford(pc) && this.game.canAfford(other) && this.game.swapOk(this.game.boardView(), pc.id, other.id);
                if (done) {
                    this.game.swapPieces(pc, other);
                    this.game.spend(pc);
                    this.game.spend(other);
                }
            } else if (a.jump) {
                done = this.game.canAfford(pc, this.game.jumpCost(pc)) && this.game.jumpPiece(pc, ...a.jump);
                if (done) this.game.spend(pc, this.game.jumpCost(pc));
            } else if (m) {
                const cost = this.game.moveCost(pc, m);
                done = this.game.canAfford(pc, cost) && this.game.act(pc, pc.x + a.dx, pc.y + a.dy, a.mode);
                if (done && this.game.pieces.has(pc.id)) this.game.spend(pc, cost);
            }
            return !!done;
        },
        
        // Far from the player: step the squad one cell along the shortest path (see
        // distanceField), keeping its shape (fixed) if that gets it closer, or else letting
        // it give (follow, then free) to get through tight places. If no step gets it closer
        // (a line of holes in the way, say), one of its pieces jumps instead, if that gets
        // the squad's nearest piece closer, or else its pieces closer in all: so the rest
        // can follow the first over. Only with the action points for it: a leader without
        // them doesn't step, but the others may jump.
        marchSquad: function(root, field) {
            const players = this.game.piecesOf('player'),
                fd = p => field.get(this.game.key(p.x, p.y)) ?? Infinity,
                members = this.game.group(root),
                cur = Math.min(...members.map(fd)),
                t = players.reduce((b, q) => hexDist(root, q) < hexDist(root, b) ? q : b);
            let best = null,
                bestKey = [cur, hexDist(root, t) * 1000 + euclid2(root, t)];
            for (const mode of this.game.canAfford(root) ? ['fixed', 'follow', 'free'] : []) {
                for (const m of this.game.legalMoves(root, mode)) {
                    if (!m.attack && this.game.canStep(root, m.dx, m.dy, true, mode) && this.game.canAfford(root, this.game.moveCost(root, m))) {
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
                    if (this.game.canAfford(g, this.game.jumpCost(g))) {
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
                    if (this.game.jumpPiece(jump[0], jump[1].x, jump[1].y)) this.game.spend(jump[0], this.game.jumpCost(jump[0]));
                }
            }
            if (best) {
                const cost = this.game.moveCost(root, best);
                if (this.game.act(root, best.x, best.y, best.mode)) this.game.spend(root, cost);
            }
        },
        
        // Plan a squad's turn. Returns the actions to carry out in order: {id, dx, dy, mode}
        // to step ({id, dx, dy, mode, attack:true} to attack), {id, swap} to swap with
        // another squad piece, or {id, jump:[x, y]}. Each spends the piece's action points
        // (both pieces', for a swap: see Combat.js), so a piece acts only with the points
        // for it, and may act more than once.
        //
        // Strikes aren't sure, so a plan keeps the odds of each player piece's HP it has
        // struck (hp, {id:[chance of each HP]}), and a strike is worth the HP it can be
        // expected to take (hit) and the chances of the kills it makes (killPer, coreKill;
        // a piece destroyed takes what's linked below it, so the chance a piece is still
        // there is the chance it and everything above it are). A player piece the plan is
        // sure to have destroyed is gone (its cell can be stepped into); any other is
        // still in the way, and threatening as much as it's likely to still be there.
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
            
            // Player pieces (static during planning), and each one's line up to its top,
            // for the chance it's still there.
            const players = this.game.piecesOf('player'),
                pAt = new Map(players.map(p => [this.game.key(p.x, p.y), p])),
                pLine = new Map(players.map(p => {
                    const line = [];
                    for (let q = p; q; q = this.game.parent(q)) line.push(q.id);
                    return [p.id, line];
                })),
                pById = new Map(players.map(p => [p.id, p])),
                fdist = (x, y) => {
                    const d = field.get(this.game.key(x, y));
                    if (d !== undefined) return d;
                    let m = Infinity;
                    for (const p of players) m = Math.min(m, hexDist(p, { x, y }));
                    return m;
                },
                initial = {
                    pos:new Map(squad.map(p => [p.id, [p.x, p.y]])),
                    ap:new Map(squad.map(p => [p.id, p.ap])),
                    hp:new Map(),
                    gain:0,
                    actions:[]
                },
                occupiedBySquad = st => {
                    const m = new Map();
                    for (const [id, [x, y]] of st.pos) m.set(x + ',' + y, id);
                    return m;
                },
                // whether piece id has the points for an action costing cost in state st
                costs = new Map(squad.map(p => [p.id, this.game.actionCost(p)])),
                jumpCosts = new Map(squad.map(p => [p.id, this.game.jumpCost(p)])),
                can = (st, id, cost=costs.get(id)) => st.ap.get(id) >= cost,
                // st's action points once piece id (and other, for a swap) spends cost
                spent = (st, id, cost=costs.get(id), other) => {
                    const ap = new Map(st.ap);
                    ap.set(id, ap.get(id) - cost);
                    if (other !== undefined) ap.set(other, ap.get(other) - costs.get(other));
                    return ap;
                },
                // the odds of player piece id's HP in state st ([h]: the chance it has h)
                hpOdds = (st, id) => st.hp.get(id) ?? Object.assign(Array(pById.get(id).hp + 1).fill(0), {[pById.get(id).hp]:1}),
                // the chance player piece id is still there in state st
                there = (st, id) => pLine.get(id).reduce((c, q) => c * (1 - hpOdds(st, q)[0]), 1),
                livePlayerAt = (st, x, y) => {
                    const p = pAt.get(x + ',' + y);
                    return p && there(st, p.id) > 1e-9 ? p : null;
                },
                // what the chances of destroying player pieces are worth in state st
                killValue = st => players.reduce((v, p) => v + (1 - there(st, p.id)) * (A.killPer + (p.id === this.game.playerCoreId ? A.coreKill : 0)), 0),
                // piece id's strikes on player piece t: {chance (0 to 1), odds (Combat.damageOdds), mean (damage a hit does)}
                strikes = new Map(),
                strikeOn = (id, t) => {
                    const k = id + ',' + t.id;
                    if (!strikes.has(k)) {
                        const odds = this.game.damageOdds(byId.get(id), t);
                        strikes.set(k, {chance:this.game.hitChance(byId.get(id), t) / 100, odds, mean:odds.reduce((a, o, n) => a + o * n, 0)});
                    }
                    return strikes.get(k);
                },
                // HP odds h after a strike s
                struck = (h, {chance, odds}) => {
                    const out = h.map(c => c * (1 - chance));
                    h.forEach((c, n) => {
                        if (c) odds.forEach((o, d) => {
                            out[Math.max(0, n - d)] += c * chance * o;
                        });
                    });
                    return out;
                },
                meanOf = h => h.reduce((a, c, n) => a + c * n, 0),
                
                // Score the end state: banked attack value + position.
                evaluate = st => {
                    let v = st.gain;
                    for (const id of ids) {
                        const [x, y] = st.pos.get(id);
                        // (safe: the chance none of the player pieces next to it is there)
                        let adj = 0,
                            safe = 1;
                        for (const [dx, dy] of pkg.hex.dirs) {
                            const p = livePlayerAt(st, x + dx, y + dy);
                            if (p) {
                                adj++;
                                safe *= 1 - there(st, p.id);
                            }
                        }
                        if (adj) {
                            const pc = byId.get(id);
                            v -= caution * A.expose * sub(id).length * (pc.hp <= 1 ? 1 : 0.6) * (1 - safe);
                        } else {
                            const d = fdist(x, y);
                            v += (d === 2 ? caution * A.poise : 0) - A.approach * Math.min(d, 30);
                        }
                    }
                    return v;
                },
                
                // Every action a piece with the points could take next, in fixed and free
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
                        if (!can(st, id)) continue;
                        const pc = byId.get(id);
                        // Swapping with a squad piece next to it that has the points: both
                        // spend them.
                        for (const other of ids) {
                            if (other > id && can(st, other) && this.game.swapOk(view, id, other)) {
                                const pos = new Map(st.pos);
                                pos.set(id, st.pos.get(other));
                                pos.set(other, st.pos.get(id));
                                out.push({
                                    pos,
                                    ap:spent(st, id, costs.get(id), other),
                                    hp:st.hp,
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
                                // (a step onto dear going costs more: see Combat.moveCost)
                                if (r && !seen.has(sig) && can(st, id, r.attack ? costs.get(id) : this.game.moveCost(pc, r))) {
                                    seen.add(sig);
                                    const action = {id, dx, dy, mode};
                                    if (r.attack) {
                                        // Worth the HP it can be expected to take, and the
                                        // chances of the kills it makes.
                                        const n = {
                                            pos:st.pos,
                                            ap:spent(st, id),
                                            hp:new Map(st.hp),
                                            gain:st.gain - killValue(st),
                                            actions:[...st.actions, {...action, attack:true}]
                                        };
                                        for (const t of r.hits) {
                                            const h = hpOdds(n, t.id),
                                                after = struck(h, strikeOn(id, t));
                                            n.hp.set(t.id, after);
                                            n.gain += (A.hit + (t.id === this.game.playerCoreId ? A.coreHit : 0)) * (meanOf(h) - meanOf(after));
                                        }
                                        n.gain += killValue(n);
                                        out.push(n);
                                    } else {
                                        const pos = new Map(st.pos);
                                        for (const [gid, x, y] of r.moves) pos.set(gid, [x, y]);
                                        out.push({
                                            pos,
                                            ap:spent(st, id, this.game.moveCost(pc, r)),
                                            hp:st.hp,
                                            gain:st.gain,
                                            actions:[...st.actions, action]
                                        });
                                    }
                                }
                            }
                        }
                        // Jumping: only it moves, two cells, for its jump cost in points, which
                        // costs jump. After the steps, so a step wins a tie. Only over gaps
                        // (holes, harm): in open ground a jump gets it no nearer than
                        // walking, for twice the points. Not within jumpClose of a player
                        // piece, where the points are better spent striking and pulling
                        // back: it's for getting to the player, over holes, say.
                        const [x0, y0] = st.pos.get(id),
                            near = players.some(p => there(st, p.id) > 1e-9 && hexDist(p, {x:x0, y:y0}) <= A.jumpClose);
                        for (const {x, y} of near || !can(st, id, jumpCosts.get(id)) ? [] : this.game.jumpCells(view, id, true)) {
                            const pos = new Map(st.pos);
                            pos.set(id, [x, y]);
                            out.push({
                                pos,
                                ap:spent(st, id, jumpCosts.get(id)),
                                hp:st.hp,
                                gain:st.gain - A.jump,
                                actions:[...st.actions, {id, jump:[x, y]}]
                            });
                        }
                    }
                    return out;
                },
                
                // While searching, a partial plan also gets credit for strikes it has
                // set up but not yet made (pieces with the points next to a player piece,
                // each its best strike's expected damage, the best of them up to the
                // actions left), so "carry into reach, strike, pull back" survives the
                // pruning even though its first step looks bad on its own.
                potential = (st, left) => {
                    const best = [];
                    if (left > 0) {
                        for (const id of ids) {
                            if (can(st, id)) {
                                const [x, y] = st.pos.get(id);
                                let b = 0;
                                for (const [dx, dy] of pkg.hex.dirs) {
                                    const t = livePlayerAt(st, x + dx, y + dy);
                                    if (t) {
                                        const s = strikeOn(id, t);
                                        b = Math.max(b, s.chance * s.mean);
                                    }
                                }
                                if (b) best.push(b);
                            }
                        }
                    }
                    return best.sort((a, b) => b - a).slice(0, left).reduce((v, b) => v + b * A.hit, 0);
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
