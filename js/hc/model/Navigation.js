/*  Routes for your pieces to go somewhere by themselves, a step a turn (Go to and Explore:
    see App.js; a module included in Game). A route is planned only from what you know:
    cells you haven't seen may be anything, and harm tiles you know of are kept off. It's
    planned again before every step, as what you know changes. */
(pkg => {
    'use strict';
    
    const {cfg} = pkg,
        UNSEEN_COST = 3, // a step onto a cell you haven't seen counts as this many, so known ways come first
        RADIUS = 120;    // the farthest a route goes, in steps (unseen ones counting as UNSEEN_COST)
    
    pkg.Navigation = new JS.Module('Navigation', {
        // Whether you've seen the cell with key k (always, without fog of war).
        hasSeen: function(k) {return !cfg.VISION.fog || this.seenCells.has(k);},
        
        /*  Searches outward from piece p a step at a time (no jumps), over the cells it could
            go on: cells you've seen that are open, with no other piece and no harm tile you
            know of on them, and, if unseen is true, cells you haven't seen. Returns the
            route to the nearest cell (not p's own) that isGoal(x, y) accepts, as the cells
            after p's, [[x, y], ...], or null if there's none within RADIUS. */
        searchRoute: function(p, isGoal, unseen) {
            const {key, cell} = pkg.hex.keysNear(p.x, p.y), // (numbers, which cost nothing to make)
                // What each cell is to the search, worked out once: 1, seen and one it can go
                // on; UNSEEN_COST, not seen and it may go on those; 0, neither.
                costs = new Map(),
                costOf = (x, y, nk) => {
                    let v = costs.get(nk);
                    if (v === undefined) {
                        const k = this.key(x, y);
                        v = this.hasSeen(k) ? (this.isOpen(x, y) && !this.board.has(k) && !this.isHarm(x, y) ? 1 : 0) :
                            unseen && Math.abs(x) <= cfg.WORLD_LIMIT && Math.abs(y) <= cfg.WORLD_LIMIT ? UNSEEN_COST : 0;
                        costs.set(nk, v);
                    }
                    return v;
                },
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
                            for (let at = k; at !== start; at = from.get(at)) route.unshift(cell(at));
                            return route;
                        }
                        if (d < RADIUS) {
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
        
        // A route for piece p to cell (x, y), through cells you haven't seen if need be
        // (see searchRoute), or null.
        routeTo: function(p, x, y) {
            return this.searchRoute(p, (gx, gy) => gx === x && gy === y, true);
        },
        
        // A route for piece p to the nearest cell you've seen that's next to one you
        // haven't (where there's more to see), through cells you've seen, or null.
        exploreRoute: function(p) {
            return this.searchRoute(p, (x, y) => pkg.hex.dirs.some(([dx, dy]) => !this.hasSeen(this.key(x + dx, y + dy))), false);
        }
    });
})(hc);
