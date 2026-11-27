/*  Routes for your pieces to go somewhere by themselves, a step a turn (Go to and Explore:
    see App.js; a module included in Game). A route is planned only from what you know:
    cells you haven't seen may be anything, and harm tiles you know of are kept off. A shut
    door a step would open (Fixtures.stepOpens) is a way through, an action dearer: the
    step into it opens it. It's planned again before every step, as what you know
    changes. */
(pkg => {
    'use strict';
    
    const {cfg, AP_UNIT, EFFECT_EXHAUSTED} = pkg,
        UNSEEN_COST = 3, // a step onto a cell you haven't seen counts as this many, so known ways come first
        SWARM_COST = 2,  // and onto one of the piece's swarm, which makes way (Follow), this many
        RADIUS = 120,    // the farthest a route goes, in steps (unseen ones counting as UNSEEN_COST)
        FIELD_SLACK = 12, // goalField counts goals up to this much further than the nearest
        PLAN_STATES = 400, // how many positions planUntangle looks at before giving up
        LEAD_WEIGHT = 3,  // how much a step nearer for the lead counts against an action, untangling
        TENTHS = 10;      // routes and fields count in tenths of a step, so dear going (floors' moveCost) can count fractions
    
    pkg.Navigation = new JS.Module('Navigation', {
        // Whether you've seen the cell with key k (always, without fog of war).
        hasSeen: function(k) {return !cfg.VISION.fog || this.seenCells.has(k);},
        
        /*  Searches outward from piece p a step at a time (no jumps), over the cells it could
            go on: cells you've seen that are open, with no harm tile you know of and no
            piece on them but one of p's swarm (its whole tree, which makes way for it in
            Follow), and, if unseen is true, cells you haven't seen. Returns the
            route to the nearest cell (not p's own) that isGoal(x, y) accepts, as the cells
            after p's, [[x, y], ...], or null if there's none within RADIUS. */
        searchRoute: function(p, isGoal, unseen) {
            const {key, cell} = pkg.hex.keysNear(p.x, p.y), // (numbers, which cost nothing to make)
                costOf = this._stepCosts(p, unseen, SWARM_COST),
                start = key(p.x, p.y),
                cost = new Map([[start, 0]]),
                from = new Map(),
                buckets = [[p.x, p.y]]; // the cells reached, by cost: [x, y, x, y, ...]
            for (let d = 0; d < buckets.length; d++) {
                const cells = buckets[d] ?? [];
                for (let i = 0; i < cells.length; i += 2) {
                    const x = cells[i],
                        y = cells[i + 1],
                        k = key(x, y);
                    // Reached more cheaply since it was put here: skip it.
                    if (cost.get(k) === d) {
                        if (d > 0 && isGoal(x, y)) {
                            const route = [];
                            for (let at = k; at !== start; at = from.get(at)) {
                                route.unshift(cell(at));
                            }
                            return route;
                        }
                        if (d < RADIUS * TENTHS) {
                            for (const [dx, dy] of pkg.hex.dirs) {
                                const nx = x + dx,
                                    ny = y + dy,
                                    nk = key(nx, ny),
                                    step = costOf(nx, ny, nk),
                                    next = d + step;
                                if (step && !(cost.get(nk) <= next)) {
                                    cost.set(nk, next);
                                    from.set(nk, k);
                                    (buckets[next] ??= []).push(nx, ny);
                                }
                            }
                        }
                    }
                }
            }
            return null;
        },
        
        /*  What a step onto each cell costs piece p going somewhere by itself, in tenths, as
            costOf(x, y, nk), nk its key from keysNear(p.x, p.y), worked out once for each
            cell: its moveCost (see Game.moveCostAt) for a cell you've seen that's open, with
            no harm you know of and no piece on it (swarmCost times that if one of p's swarm
            is: its whole tree, which makes way for it in Follow), or a door a step would
            open (a step more, for opening it); UNSEEN_COST for one you haven't seen, if
            unseen is true; 0 for one it can't go on. @private */
        _stepCosts: function(p, unseen, swarmCost) {
            const topOf = q => {
                    while (this.parent(q)) q = this.parent(q);
                    return q;
                },
                top = topOf(p),
                pieceCost = (k, x, y) => {
                    const id = this.board.get(k),
                        step = Math.max(1, Math.round(TENTHS * this.moveCostAt(x, y)));
                    return id === undefined ? step : topOf(this.pieces.get(id)) === top ? swarmCost * step : 0;
                },
                costs = new Map();
            return (x, y, nk) => {
                let v = costs.get(nk);
                if (v === undefined) {
                    const k = this.key(x, y);
                    v = this.hasSeen(k) ? (this.isOpen(x, y) && !this.isHarm(x, y) ? pieceCost(k, x, y) :
                        this.stepOpens(x, y) && !this.isHarm(x, y) ? pieceCost(k, x, y) + TENTHS : 0) :
                        unseen && Math.abs(x) <= cfg.WORLD_LIMIT && Math.abs(y) <= cfg.WORLD_LIMIT ? UNSEEN_COST * TENTHS : 0;
                    costs.set(nk, v);
                }
                return v;
            };
        },
        
        // A route for piece p to cell (x, y), through cells you haven't seen if need be
        // (see searchRoute), or null; and how far it is from there (see goalField).
        routeTo: function(p, x, y) {return this.searchRoute(p, this._isAt(x, y), true);},
        fieldTo: function(p, x, y) {return this.goalField(p, this._isAt(x, y), true);},
        
        // A route for piece p to the nearest cell you've seen that's next to one you
        // haven't (where there's more to see), through cells you've seen, or null; and how
        // far that is from each cell (see goalField).
        exploreRoute: function(p) {return this.searchRoute(p, this._isEdge(), false);},
        exploreField: function(p) {return this.goalField(p, this._isEdge(), false);},
        
        // Goals for routes, as isGoal(x, y). @private
        _isAt: (x, y) => (gx, gy) => gx === x && gy === y,
        _isEdge: function() {return (x, y) => pkg.hex.dirs.some(([dx, dy]) => !this.hasSeen(this.key(x + dx, y + dy)));},
        
        // ---- Untangling ----
        
        /*  How far piece p would have to go from each cell to get to a cell isGoal(x, y)
            accepts, by the costs routes count (with its swarm out of the way, since that
            moves), as far(x, y): Infinity for one it can't get there from, or too far off.
            Works out from p to the goals within reach (those up to FIELD_SLACK further
            than the nearest), then back from them. (Counted in tenths, given in steps.) */
        goalField: function(p, isGoal, unseen) {
            const {key} = pkg.hex.keysNear(p.x, p.y),
                costOf = this._stepCosts(p, unseen, 1),
                walk = (starts, stopAt) => {
                    const cost = new Map(starts.map(([x, y]) => [key(x, y), 0])),
                        buckets = [starts.flat()];
                    for (let d = 0; d < buckets.length && d <= stopAt(); d++) {
                        const cells = buckets[d] ?? [];
                        for (let i = 0; i < cells.length; i += 2) {
                            const x = cells[i], y = cells[i + 1];
                            if (cost.get(key(x, y)) === d && onCell(x, y, d)) {
                                for (const [dx, dy] of pkg.hex.dirs) {
                                    const nx = x + dx, ny = y + dy, nk = key(nx, ny),
                                        // out: the step onto the cell; back: onto this one
                                        step = back ? (reached.has(nk) || (nx === p.x && ny === p.y) ? costOf(x, y, key(x, y)) || UNSEEN_COST * TENTHS : 0) : costOf(nx, ny, nk),
                                        next = d + step;
                                    if (step && !(cost.get(nk) <= next)) {
                                        cost.set(nk, next);
                                        (buckets[next] ??= []).push(nx, ny);
                                    }
                                }
                            }
                        }
                    }
                    return cost;
                },
                goals = [];
            let back = false, nearest = Infinity, onCell = (x, y, d) => {
                if (d > 0 && isGoal(x, y)) {
                    nearest = Math.min(nearest, d);
                    goals.push([x, y]);
                }
                return d < RADIUS * TENTHS;
            };
            const reached = walk([[p.x, p.y]], () => nearest + FIELD_SLACK * TENTHS);
            back = true;
            onCell = () => true;
            const far = goals.length ? walk(goals, () => Infinity) : new Map();
            return (x, y) => (far.get(key(x, y)) ?? Infinity) / TENTHS;
        },
        
        /*  When piece p can't step on its way (far, as goalField gives it), a plan to get
            it nearer, untangling its swarm (its whole tree): each piece of it with the
            action points (see Combat.js; when none has, they're got back as at the end of a
            turn, but not by an exhausted piece) may step in Free mode, or swap with a piece
            next to it, or jump (which exhausts it, so it counts the points it won't get
            back as spent: see Effects.js), and p may step in Follow mode too. The plan is the fewest action points spent to get p
            nearer, keeping links slack on the way, found by a search out from where the
            swarm is (best first, giving up after PLAN_STATES positions), and keeping off
            positions in avoid (a Set of keys, as plan's position keys). Returns
            [{id, kind:'follow'|'free'|'swap'|'jump', x, y, other}, ...] (other: the piece
            swapped with), or null. */
        planUntangle: function(p, far, avoid=new Set()) {
            const tree = [],
                topOf = q => this.parent(q) ? topOf(this.parent(q)) : q;
            for (const q of this.piecesOf(p.owner)) if (topOf(q) === topOf(p)) tree.push(q.id);
            const inTree = new Set(tree),
                range = this.rules.linkRange,
                // what an action costs each piece (see Combat.js), and the turns a jump
                // exhausts it for (see Effects.js)
                costs = new Map(tree.map(id => [id, this.actionCost(this.pieces.get(id))])),
                exhaustion = new Map(tree.map(id => [id, Math.max(0, this.statRule('jumpExhaustion', this.pieces.get(id)))])),
                links = tree.filter(id => inTree.has(this.pieces.get(id).parentId)).map(id => [id, this.pieces.get(id).parentId]),
                // A position: where each piece of the swarm is, its action points, and the
                // turns each is exhausted for.
                keyOf = pos => tree.map(id => pos.get(id).join(',')).join(';'),
                tension = pos => links.reduce((t, [a, b]) => {
                    const [ax, ay] = pos.get(a), [bx, by] = pos.get(b);
                    return t + Math.max(0, pkg.hexDist({x:ax, y:ay}, {x:bx, y:by}) - 1) / range;
                }, 0),
                score = st => st.cost + LEAD_WEIGHT * far(...st.pos.get(p.id)) + tension(st.pos),
                viewOf = pos => {
                    const at = new Map(tree.map(id => [pos.get(id).join(','), id]));
                    return {
                        posOf: id => pos.get(id) ?? [this.pieces.get(id).x, this.pieces.get(id).y],
                        kidsOf: id => tree.filter(k => this.pieces.get(k).parentId === id),
                        parentOf: id => this.parent(this.pieces.get(id))?.id ?? null,
                        occupant: (x, y) => at.get(x + ',' + y) ?? (inTree.has(this.board.get(this.key(x, y))) ? undefined : this.board.get(this.key(x, y))),
                        open: (x, y) => this.isOpen(x, y) && !this.isHarm(x, y),
                        harm: (x, y) => this.isHarm(x, y),
                        trailOf: id => this.pieces.get(id).trail,
                        target: (id, x, y) => {
                            const o = this.pieceAt(x, y);
                            return (o && !inTree.has(o.id) && o.owner !== p.owner) || this.canBreak(this.pieces.get(id), this.tiles.get(this.key(x, y))) ||
                                this.fixtureBlocks(x, y) && this.canBreakFixture(this.pieces.get(id), this.fixtures.get(this.key(x, y))) ? {} : null;
                        }
                    };
                },
                start = {
                    pos:new Map(tree.map(id => [id, [this.pieces.get(id).x, this.pieces.get(id).y]])),
                    ap:new Map(tree.map(id => [id, this.pieces.get(id).ap])),
                    tired:new Map(tree.map(id => [id, this.effectOn(this.pieces.get(id), EFFECT_EXHAUSTED)?.countdown ?? 0])),
                    cost:0,
                    plan:[]
                },
                goal = far(...start.pos.get(p.id)),
                seen = new Set([keyOf(start.pos), ...avoid]),
                open = [start];
            start.score = score(start);
            for (let n = 0; n < PLAN_STATES && open.length; n++) {
                // The best position to go on from
                let b = 0;
                for (let i = 1; i < open.length; i++) if (open[i].score < open[b].score) b = i;
                const st = open[b];
                open[b] = open[open.length - 1];
                open.pop();
                if (far(...st.pos.get(p.id)) < goal) return st.plan;
                // A new turn, when nothing more can act in this one
                const can = (s, id, cost=costs.get(id)) => s.ap.get(id) >= cost;
                let base = st;
                if (!tree.some(id => can(st, id))) {
                    base = {
                        ...st,
                        ap:new Map(tree.map(id => {
                            const q = this.pieces.get(id),
                                back = st.tired.get(id) ? 0 : this.apRecovery(q);
                            return [id, Math.max(st.ap.get(id), Math.min(this.apMax(q), st.ap.get(id) + back))];
                        })),
                        tired:new Map(tree.map(id => [id, Math.max(0, st.tired.get(id) - 1)]))
                    };
                }
                const view = viewOf(base.pos),
                    next = (id, kind, moves, x, y, other) => {
                        const pos = new Map(base.pos);
                        for (const [gid, mx, my] of moves) pos.set(gid, [mx, my]);
                        const k = keyOf(pos),
                            // A step costs more onto dear going (see Combat.moveCost).
                            spent = kind === 'jump' || kind === 'swap' ? costs.get(id) :
                                this.moveCost(this.pieces.get(id), {moves}),
                            // a jump's exhaustion: the points it won't get back
                            tiring = kind === 'jump' ? exhaustion.get(id) : 0;
                        if (!seen.has(k) && base.ap.get(id) >= spent) {
                            seen.add(k);
                            const ap = new Map(base.ap).set(id, base.ap.get(id) - spent),
                                tired = tiring ? new Map(base.tired).set(id, base.tired.get(id) + tiring) : base.tired,
                                lost = tiring * this.apRecovery(this.pieces.get(id)),
                                child = {pos, ap, tired, cost:base.cost + (spent + lost) / AP_UNIT, plan:[...base.plan, {id, kind, x, y, other}]};
                            if (other !== undefined) {
                                ap.set(other, ap.get(other) - costs.get(other));
                            }
                            child.score = score(child);
                            open.push(child);
                        }
                    };
                for (const id of tree) {
                    if (can(base, id)) {
                        const [x, y] = base.pos.get(id);
                        for (const mode of id === p.id ? ['follow', 'free'] : ['free']) {
                            for (const [dx, dy] of pkg.hex.dirs) {
                                const r = this.resolveStep(view, id, dx, dy, mode);
                                if (r && !r.attack) next(id, mode, r.moves, x + dx, y + dy);
                            }
                        }
                        for (const other of tree) {
                            if (other !== id && can(base, other) && this.swapOk(view, id, other)) {
                                next(id, 'swap', [[id, ...base.pos.get(other)], [other, x, y]], ...base.pos.get(other), other);
                            }
                        }
                        for (const c of this.jumpCells(view, id)) {
                            next(id, 'jump', [[id, c.x, c.y]], c.x, c.y);
                        }
                    }
                }
            }
            return null;
        },
        
        // The key for a swarm's position, as planUntangle keeps them, from the board.
        swarmKey: function(p) {
            const topOf = q => this.parent(q) ? topOf(this.parent(q)) : q,
                tree = this.piecesOf(p.owner).filter(q => topOf(q) === topOf(p)).map(q => q.id);
            return tree.map(id => [this.pieces.get(id).x, this.pieces.get(id).y].join(',')).join(';');
        }
    });
})(hc);
