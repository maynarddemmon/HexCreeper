/*  Getting a swarm into a formation, an action at a time (Snake and Tree: see App.js; a
    module included in Game), by detaching pieces, walking them over and attaching them
    where they're wanted, at the usual cost of each.
    
    - snake: a single chain, from the swarm's top piece (the core) to the piece that leads
      it, which is cut loose first and attached last, so it ends at the free end, where it
      can lead. Any piece with more than one child loses all but the one with the most
      below it, and each group cut loose is walked to the end of the chain and attached
      there. A snake gets through anything a step wide, but its rank is the lowest.
    - tree: as near a complete binary tree from the top as it can get, which has the
      highest rank for the number of pieces. Any piece with more than two children loses
      the extras; each group cut loose is attached to the shallowest piece with a free
      place (fewer than two children); then the deepest piece without children moves up to
      a free place two or more levels nearer the top, until there's none. */
(pkg => {
    'use strict';
    
    const {hexDist} = pkg;
    
    pkg.Formation = new JS.Module('Formation', {
        /*  The next action toward getting the pieces with the ids in `ids` (a swarm, with
            the piece root at its top and lead leading it; ids may name pieces since lost)
            into shape ('snake' or 'tree'), that can be done now:
                {kind:'detach', id}
                {kind:'attach', id, target} (target: the id of the piece to attach to)
                {kind:'step', id, x, y} (the top of a group cut loose steps, in Follow)
            or 'wait' if there's more to do but not this turn, 'done' if it's in shape, or
            'stuck' if it can't get on. */
        formationAction: function(ids, root, lead, shape) {
            const ps = ids.map(id => this.pieces.get(id)).filter(Boolean),
                kidsOf = p => ps.filter(q => q.parentId === p.id),
                topOf = p => this.parent(p) ? topOf(this.parent(p)) : p,
                size = p => 1 + kidsOf(p).reduce((n, k) => n + size(k), 0),
                top = this.pieces.get(root),
                head = this.pieces.get(lead) ?? top,
                // The groups cut loose (not the head, which goes last in a snake)
                loose = ps.filter(p => p !== top && !this.parent(p) && !(shape === 'snake' && p === head)),
                // What to do, most pressing first: [action, the piece that acts]
                todo = [],
                detach = p => todo.push([{kind:'detach', id:p.id}, p]),
                // The action that gets group g (its top) on to piece t, attaching it there:
                // attaching it if it's next to t, else a step toward a free cell next to
                // t; or null if it can't get there.
                toward = (g, t) => {
                    let action = null;
                    if (hexDist(g, t) === 1) {
                        action = {kind:'attach', id:g.id, target:t.id};
                    } else {
                        const route = this.searchRoute(g, (x, y) => hexDist({x, y}, t) === 1 && !this.board.has(this.key(x, y)), false),
                            [x, y] = route?.[0] ?? [],
                            move = route && this.resolveStep(this.boardView(), g.id, x - g.x, y - g.y, 'follow');
                        if (move && !move.attack) action = {kind:'step', id:g.id, x, y};
                    }
                    return action;
                },
                bring = (g, t) => todo.push([toward(g, t), g]),
                nearest = (cands, p) => cands.reduce((b, c) => !b || hexDist(c, p) < hexDist(b, p) ? c : b, null);
            if (!top) return 'stuck';
            
            if (shape === 'snake') {
                const cut = head !== top && topOf(head) === top;
                // The head: its children cut loose, then it (unless it's the end of the
                // chain already).
                if (head !== top) kidsOf(head).forEach(detach);
                // Pieces in the chain with more than one child keep the one with most below.
                const chain = ps.filter(p => topOf(p) === top && (p !== head || head === top));
                for (const p of chain) {
                    const kids = kidsOf(p).filter(k => k !== head).sort((a, b) => size(b) - size(a));
                    kids.slice(1).forEach(detach);
                }
                const tail = chain.length === 1 || chain.every(p => kidsOf(p).filter(k => k !== head).length <= 1) ?
                        chain.find(p => !kidsOf(p).some(k => k !== head)) : null,
                    whole = !loose.length && chain.length + (head !== top ? 1 : 0) === ps.length;
                if (cut && !(whole && head.parentId === tail?.id && !kidsOf(head).length)) detach(head);
                if (tail) {
                    const g = nearest(loose, tail);
                    if (g) {
                        bring(g, tail);
                    } else if (head !== top && !this.parent(head)) {
                        bring(head, tail);
                    }
                }
            } else {
                // Depths from the top
                const depth = new Map([[top.id, 0]]),
                    main = [top];
                for (let i = 0; i < main.length; i++) {
                    for (const k of kidsOf(main[i])) {
                        depth.set(k.id, depth.get(main[i].id) + 1);
                        main.push(k);
                    }
                }
                for (const p of main) kidsOf(p).sort((a, b) => size(b) - size(a)).slice(2).forEach(detach);
                // The places free, shallowest first
                const free = main.filter(p => kidsOf(p).length < 2),
                    shallowest = Math.min(...free.map(p => depth.get(p.id)));
                if (loose.length) {
                    // To the shallowest place free it can get to, the nearest first
                    const g = loose[0],
                        spots = free.sort((a, b) => depth.get(a.id) - depth.get(b.id) || hexDist(a, g) - hexDist(b, g));
                    todo.push([spots.map(t => toward(g, t)).find(Boolean) ?? null, g]);
                } else {
                    const leaves = main.filter(p => p !== top && !kidsOf(p).length),
                        deepest = Math.max(...leaves.map(p => depth.get(p.id)));
                    if (deepest - shallowest >= 2) {
                        const spots = free.filter(p => depth.get(p.id) === shallowest);
                        detach(leaves.filter(p => depth.get(p.id) === deepest).reduce((b, p) =>
                            !b || hexDist(p, nearest(spots, p)) < hexDist(b, nearest(spots, b)) ? p : b, null));
                    }
                }
            }
            
            let out = 'done';
            for (const [action, p] of todo) {
                if (!action) {
                    if (out === 'done') out = 'stuck';
                } else if (this.canMove(p)) {
                    return action;
                } else {
                    out = 'wait';
                }
            }
            return out;
        }
    });
})(hc);
