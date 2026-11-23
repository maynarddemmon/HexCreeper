/*  How a step moves a piece and the pieces linked to it, in each movement mode (a module
    included in Game):
    
    - fixed: the piece's whole subtree moves with it, keeping its shape.
    - free: only the piece moves, but any piece linked below it that would then be out of
      link range is dragged along by the same step (and so on down).
    - follow: the piece leads and its whole tree follows (what's below it, and its parent,
      grandparent and so on, with their other branches): each piece stays or moves a
      cell, and a search finds an arrangement that keeps the links in range, if there's
      one, each piece trying first to follow in the footsteps of the piece it's linked
      to on the way back to the lead (the cells that piece has just been on:
      piece.trail). Followers keep off harm tiles you know of as if they were walls (the
      lead may step on one). So a swarm files after its leader through tight places and
      round corners, and sorts itself out where pieces are in each other's way.
    
    A step that can't be done in follow is tried in fixed, then free, as long as that
    doesn't make it an attack, so a swarm stuck following can still get going.
    
    In every mode a link may not end out of range unless it got shorter. Attacks: in fixed,
    every piece of the subtree that would land on a target hits it (a group attack); in
    free and follow only the piece itself attacks.
    
    resolveStep works on a view of the board, so the enemy planner can use it on positions
    it's trying out as well as on the board itself. */
(pkg => {
    'use strict';
    
    const {hexDist} = pkg,
        dist = ([ax, ay], [bx, by]) => hexDist({x:ax, y:ay}, {x:bx, y:by}),
        
        // Whether key a comes before key b, comparing their entries in turn.
        before = (a, b) => {
            const j = a.findIndex((v, i) => v !== b[i]);
            return j >= 0 && a[j] < b[j];
        };
    
    pkg.MOVE_MODES = ['fixed', 'free', 'follow'];
    
    // How many cells a Follow step tries for its pieces before giving up (see _follow).
    const FOLLOW_TRIES = 3000;
    
    pkg.Movement = new JS.Module('Movement', {
        /*  The result of stepping piece id by (dx, dy) in mode, on view:
                posOf(id) -> [x, y]
                kidsOf(id) -> ids linked below it
                parentOf(id) -> the id of its parent, or null
                occupant(x, y) -> the id of the piece there, or undefined
                open(x, y) -> whether a piece could stand there (terrain only)
                passable(x, y) -> optional: whether the piece itself may try to go there
                    (it may still be blocked); open, if not given
                harm(x, y) -> optional: whether there's a harm tile there you know of,
                    which followers treat as a wall
                trailOf(id) -> optional: the cells the piece was on before, latest first
                target(id, x, y) -> what the piece would hit by moving there, or null
            Returns null if it can't be done, {attack:true, hits} for an attack, or
            {attack:false, moves:[[id, x, y], ...]} for the pieces that move and where.
            In follow, if it can't be done, it's tried in fixed, then free, but not to attack. */
        resolveStep: function(view, id, dx, dy, mode) {
            let r = this._resolveStep(view, id, dx, dy, mode);
            if (!r && mode === 'follow') {
                for (const m of ['fixed', 'free']) {
                    r = this._resolveStep(view, id, dx, dy, m);
                    if (r?.attack) r = null;
                    if (r) break;
                }
            }
            return r;
        },
        
        /*  resolveStep, in mode alone. @private */
        _resolveStep: function(view, id, dx, dy, mode) {
            const {posOf, kidsOf, parentOf, open, target} = view,
                range = this.rules.linkRange,
                [px, py] = posOf(id);
            
            // The pieces that may move: the piece and what's below it, or in follow, its
            // whole tree, from the top.
            let top = id;
            if (mode === 'follow') {
                while (parentOf(top) != null) top = parentOf(top);
            }
            const pieces = [top];
            for (let i = 0; i < pieces.length; i++) pieces.push(...kidsOf(pieces[i]));
            
            // The piece itself must be able to go there, or hit what's there.
            const own = target(id, px + dx, py + dy);
            if (!own && !(view.passable ?? open)(px + dx, py + dy)) return null;
            
            // Attacks
            const hits = [];
            for (const gid of mode === 'fixed' ? pieces : [id]) {
                const [gx, gy] = posOf(gid),
                    hit = target(gid, gx + dx, gy + dy);
                if (hit) hits.push(hit);
            }
            if (hits.length) return {attack:true, hits};
            
            // Where each piece ends up
            const dest = gid => {
                    const [gx, gy] = posOf(gid);
                    return [gx + dx, gy + dy];
                },
                linkOk = (from, to, fromAfter, toAfter) => {
                    const d = dist(fromAfter, toAfter);
                    return d <= range || d < dist(from, to);
                },
                after = mode === 'follow' ? this._follow(view, id, pieces, dest, linkOk) : this._shift(view, pieces, dest, mode);
            if (!after) return null;
            
            // Links: none may end out of range unless it got shorter.
            const above = parentOf(top);
            if (above != null && !linkOk(posOf(top), posOf(above), after.get(top), posOf(above))) return null;
            for (const gid of pieces) {
                for (const kid of kidsOf(gid)) {
                    if (!linkOk(posOf(gid), posOf(kid), after.get(gid), after.get(kid))) return null;
                }
            }
            const moves = [];
            for (const gid of pieces) {
                const [x, y] = after.get(gid), [ox, oy] = posOf(gid);
                if (x !== ox || y !== oy) moves.push([gid, x, y]);
            }
            return {attack:false, moves};
        },
        
        /*  Fixed and free: the pieces that move go by the same step; in free, only the piece
            and those dragged. Returns where each piece of the subtree ends up, or null if a
            piece that moves can't land. @private */
        _shift: function(view, subtree, dest, mode) {
            const {posOf, kidsOf, occupant, open} = view,
                range = this.rules.linkRange,
                moving = new Set(mode === 'free' ? [subtree[0]] : subtree);
            if (mode === 'free') {
                for (const gid of subtree) {
                    if (moving.has(gid)) {
                        for (const kid of kidsOf(gid)) {
                            if (dist(dest(gid), posOf(kid)) > range) moving.add(kid);
                        }
                    }
                }
            }
            const after = new Map();
            for (const gid of subtree) {
                after.set(gid, moving.has(gid) ? dest(gid) : posOf(gid));
                if (moving.has(gid)) {
                    const [x, y] = dest(gid),
                        o = occupant(x, y);
                    if (!open(x, y) || (o !== undefined && !moving.has(o))) return null;
                }
            }
            return after;
        },
        
        /*  Follow: the lead goes to dest; the others each stay or move a cell, so that no
            two end on the same cell, none ends where a piece outside the swarm is or on a
            harm tile you know of (unless it's there already), no two followers trade cells
            (a piece the lead steps onto may take the lead's), and no link ends out of
            range unless it got shorter. A search finds such an arrangement, if there's one
            (it gives up after FOLLOW_TRIES tries): working out from the lead along links
            (down to its children, up to its parent, and on), each piece tries first the
            cells it would rather take, then the others, and if that leaves no way on for a
            piece after it, the next. A piece would rather keep its link to the one it was
            reached from (its guide) in range, then follow it in its footsteps: the cell
            the guide just left, then its trail, the furthest along them, not going back
            along them (or, off them, nearest the latest of them), then stay put. Returns
            where each piece ends up, or null if there's no such arrangement. @private */
        _follow: function(view, lead, pieces, dest, linkOk) {
            const {posOf, kidsOf, parentOf, occupant, open} = view,
                harm = view.harm ?? (() => false),
                trailOf = view.trailOf ?? (() => []),
                range = this.rules.linkRange,
                inTree = new Set(pieces),
                keyOf = ([x, y]) => x + ',' + y,
                same = (a, b) => a[0] === b[0] && a[1] === b[1],
                to = dest(lead),
                after = new Map([[lead, to]]),
                claimed = new Map([[keyOf(to), lead]]),
                top = pieces[0],
                above = parentOf(top),
                // The pieces each is linked to in the swarm
                linksOf = gid => {
                    const par = parentOf(gid);
                    return [...kidsOf(gid), ...(par != null && inTree.has(par) ? [par] : [])];
                };
            {
                const o = occupant(...to);
                if (!open(...to) || (o !== undefined && o !== lead && !inTree.has(o))) return null;
            }
            
            // The order: out from the lead along links, each with its guide
            const order = [lead], guideOf = new Map();
            for (let i = 0; i < order.length; i++) {
                for (const n of linksOf(order[i])) {
                    if (n !== lead && !guideOf.has(n)) {
                        guideOf.set(n, order[i]);
                        order.push(n);
                    }
                }
            }
            
            // The cells gid may end on, those it would rather take first (once its guide has
            // gone).
            const choicesOf = gid => {
                    const guide = guideOf.get(gid),
                        from = posOf(guide),
                        gto = after.get(guide),
                        here = posOf(gid),
                        cells = [...(same(from, gto) ? [] : [from]), ...trailOf(guide)],
                        steps = cells.map(keyOf),
                        stepOf = c => {
                            const i = steps.indexOf(keyOf(c));
                            return i < 0 ? steps.length : i;
                        },
                        at = stepOf(here),
                        latest = cells[0] ?? gto,
                        out = [];
                    [[0, 0], ...pkg.hex.dirs].forEach(([dx, dy], i) => {
                        const c = [here[0] + dx, here[1] + dy],
                            o = occupant(...c);
                        if (open(...c) && (i === 0 || !harm(...c)) && (o === undefined || inTree.has(o)) && !same(c, to)) {
                            const step = stepOf(c);
                            out.push({c, key:[
                                linkOk(here, from, c, gto) ? 0 : 1,
                                step <= at && step < steps.length ? step : steps.length + dist(c, latest),
                                i
                            ]});
                        }
                    });
                    return out.sort((a, b) => before(a.key, b.key) ? -1 : before(b.key, a.key) ? 1 : 0).map(o => o.c);
                },
                // Whether gid may end on c, given where those before it go.
                fits = (gid, c) => {
                    const here = posOf(gid),
                        o = occupant(...c);
                    if (claimed.has(keyOf(c))) return false;
                    // No trading cells, but with the lead
                    if (o !== undefined && o !== gid && o !== lead && after.has(o) && same(after.get(o), here)) return false;
                    for (const n of linksOf(gid)) {
                        if (after.has(n)) {
                            if (!linkOk(here, posOf(n), c, after.get(n))) return false;
                        } else {
                            // n can get no nearer than a step: can it still make it?
                            const d = dist(c, posOf(n)) - 1;
                            if (d > range && d >= dist(here, posOf(n))) return false;
                        }
                    }
                    return gid !== top || above == null || linkOk(here, posOf(above), c, posOf(above));
                };
            if (lead === top && above != null && !linkOk(posOf(lead), posOf(above), to, posOf(above))) return null;
            
            let tries = FOLLOW_TRIES;
            const place = i => {
                if (i === order.length) return true;
                const gid = order[i];
                for (const c of choicesOf(gid)) {
                    if (tries-- <= 0) return false;
                    if (fits(gid, c)) {
                        after.set(gid, c);
                        claimed.set(keyOf(c), gid);
                        if (place(i + 1)) return true;
                        after.delete(gid);
                        claimed.delete(keyOf(c));
                    }
                }
                return false;
            };
            return place(1) ? after : null;
        },
        
        /*  Whether pieces a and b (ids), next to each other and on the same side, can swap
            cells on view: every link either has ends in range after, or got shorter. What's
            linked to them stays where it is. */
        swapOk: function(view, a, b) {
            const {posOf, kidsOf, parentOf} = view,
                range = this.rules.linkRange,
                pa = posOf(a), pb = posOf(b),
                after = id => id === a ? pb : id === b ? pa : posOf(id);
            if (dist(pa, pb) !== 1) return false;
            for (const id of [a, b]) {
                const par = parentOf(id);
                for (const other of [...kidsOf(id), ...(par != null ? [par] : [])]) {
                    const d = dist(after(id), after(other));
                    if (d > range && d >= dist(posOf(id), posOf(other))) return false;
                }
            }
            return true;
        },
        
        /*  Swaps two pieces' cells (each lands on the other's tiles). */
        swapPieces: function(a, b) {
            const [ax, ay, bx, by] = [a.x, a.y, b.x, b.y];
            this.motionFx(a, [ax, ay], [bx, by]);
            this.motionFx(b, [bx, by], [ax, ay]);
            this._leaveCell(a);
            this._leaveCell(b);
            a.x = bx;
            a.y = by;
            b.x = ax;
            b.y = ay;
            this.board.set(this.key(a.x, a.y), a.id);
            this.board.set(this.key(b.x, b.y), b.id);
            const core = [a, b].find(p => p.id === this.playerCoreId);
            if (core) this.extendCorePath(core.x, core.y);
            this.landOnTiles([a, b]);
            if (a.owner === 'player') this.piecesMoved();
        },
        
        // ---- Swap ----
        // Two of your pieces next to each other can swap cells. It uses a move, and both
        // pieces are done for the turn. Enemies can swap too (see planSquad).
        swapTargets: function(p) {
            let out = [];
            if (!this.over && p?.owner === 'player' && this.canMove(p)) {
                const view = this.boardView();
                out = this.piecesOf('player').filter(q => q !== p && this.canMove(q) && this.swapOk(view, p.id, q.id));
            }
            return out;
        },
        canSwap: function(p) {return this.swapTargets(p).length > 0;},
        playerSwap: function(p, q) {
            let done = false;
            if (this.swapTargets(p).includes(q)) {
                this.swapPieces(p, q);
                this.useMove(p);
                this.acted.add(q.id);
                this.fx(p.x, p.y, 'swap', '--place-ink', {});
                this.afterPlayerAction();
                done = true;
            }
            return done;
        },
        
        // ---- Jump ----
        /*  The cells piece id could jump to on view, [{x, y}]: the twelve two steps away,
            straight over one cell or between two. It may jump over holes and pieces, but not
            over a solid: the cell it passes over, or one of the two, mustn't be solid. It
            must be able to stand where it lands (open, with no piece there), and since
            nothing linked to it moves, each of its links must end in range. With
            overGaps, only jumps over cells it couldn't stand on (not open: holes, say),
            where walking would take the long way round: enemies jump only those, since in
            open ground a jump is no quicker and leaves the piece sitting out a turn. */
        jumpCells: function(view, id, overGaps = false) {
            const {posOf, kidsOf, parentOf, occupant, open} = view,
                range = this.rules.linkRange,
                [px, py] = posOf(id),
                par = parentOf(id),
                linked = [...kidsOf(id), ...(par != null ? [par] : [])].map(posOf),
                out = [];
            for (const {dx, dy, over} of this.jumpOffsets()) {
                const x = px + dx,
                    y = py + dy;
                if (this.canJumpOver(px, py, over) && !(overGaps && over.some(([ox, oy]) => open(px + ox, py + oy))) &&
                    open(x, y) && occupant(x, y) === undefined &&
                    linked.every(q => dist([x, y], q) <= range)) {
                    out.push({x, y});
                }
            }
            return out;
        },
        
        /*  The twelve jumps from a cell, [{dx, dy, over}]: two steps away, straight over one
            cell or between two, with the offsets of the cells passed over. */
        jumpOffsets: function() {
            const dirs = pkg.hex.dirs;
            return dirs.flatMap(([ax, ay], i) => {
                const [bx, by] = dirs[(i + 1) % 6];
                return [
                    {dx:2 * ax, dy:2 * ay, over:[[ax, ay]]},
                    {dx:ax + bx, dy:ay + by, over:[[ax, ay], [bx, by]]}
                ];
            });
        },
        
        /*  Whether a jump from (x, y) can pass over the cells at the offsets `over`: not
            over a solid, so one of them mustn't be solid. */
        canJumpOver: function(x, y, over) {return over.some(([ox, oy]) => !this.isSolid(x + ox, y + oy));},
        
        /*  Jumps piece p to (x, y), if it can (jumpCells; an enemy won't land on harm). It
            lands on the tiles there, and is tired: it can't act this turn or the next. */
        jumpPiece: function(p, x, y) {
            let done = false;
            if (this.jumpCells(this.boardView(p.owner !== 'player'), p.id).some(c => c.x === x && c.y === y)) {
                this.applyMoves(p, [[p.id, x, y]], true);
                p.tiredUntil = this.turn + 1;
                this.fx(x, y, 'jump', '--place-ink', {});
                done = true;
            }
            return done;
        },
        
        // A piece of yours that can move this turn can jump, except in follow mode (unless
        // anyMode, for Go to and Explore, which jump as a last resort). It uses a move, and
        // the piece can't act again this turn or the next. Enemies can jump too (see
        // planSquad).
        jumpTargets: function(p, anyMode=false) {
            let out = [];
            if (!this.over && p?.owner === 'player' && this.canMove(p) && (anyMode || this.modeFor(p) !== 'follow')) {
                out = this.jumpCells(this.boardView(), p.id);
            }
            return out;
        },
        canJump: function(p) {return this.jumpTargets(p).length > 0;},
        playerJump: function(p, x, y, anyMode=false) {
            let done = false;
            if (this.jumpTargets(p, anyMode).some(c => c.x === x && c.y === y) && this.jumpPiece(p, x, y)) {
                this.useMove(p);
                this.afterPlayerAction();
                done = true;
            }
            return done;
        },
        
        /*  A view of the board as it is, for resolveStep. With avoidHarm, harm
            tiles count as closed. */
        boardView: function(avoidHarm = false) {
            const kids = new Map();
            for (const p of this.pieces.values()) {
                if (p.parentId) {
                    if (!kids.has(p.parentId)) kids.set(p.parentId, []);
                    kids.get(p.parentId).push(p.id);
                }
            }
            return {
                posOf: id => {
                    const p = this.pieces.get(id);
                    return [p.x, p.y];
                },
                kidsOf: id => kids.get(id) ?? [],
                trailOf: id => this.pieces.get(id).trail,
                parentOf: id => this.parent(this.pieces.get(id))?.id ?? null,
                occupant: (x, y) => this.board.get(this.key(x, y)),
                open: (x, y) => this.isOpen(x, y) && !(avoidHarm && this.isHarm(x, y)),
                harm: (x, y) => this.isHarm(x, y),
                target: (id, x, y) => {
                    const g = this.pieces.get(id),
                        t = this.pieceAt(x, y),
                        tile = this.tiles.get(this.key(x, y));
                    let hit = null;
                    if (t && t.owner !== g.owner) {
                        hit = {attacker:g, target:t};
                    } else if (this.canBreak(g, tile)) {
                        hit = {attacker:g, target:tile, solid:true};
                    }
                    return hit;
                }
            };
        },
        
        // The mode a piece moves in by default: the player's chosen mode, or fixed.
        modeFor: function(piece) {return piece?.owner === 'player' ? this.moveMode : 'fixed';},
        
        /*  Adds the cell piece g is leaving to its trail, the cells it was on, latest first,
            as many as the link range (Follow walks them). A jump starts it afresh, since
            the cells aren't next to each other. A new array, so a copy of the piece
            (exportToObj) doesn't change with it. @private */
        _leaveCell: function(g, jump=false) {
            g.trail = jump ? [] : [[g.x, g.y], ...g.trail].slice(0, this.rules.linkRange);
        },
        
        /*  Puts the pieces that move where resolveStep says (or where piece jumps to, with
            jump), to be animated. Returns the pieces moved. */
        applyMoves: function(piece, moves, jump = false) {
            const moved = moves.map(([gid]) => this.pieces.get(gid));
            for (const g of moved) this.board.delete(this.key(g.x, g.y));
            moves.forEach(([, x, y], i) => {
                const g = moved[i];
                this.motionFx(g, [g.x, g.y], [x, y], jump);
                this._leaveCell(g, jump);
                g.x = x;
                g.y = y;
                this.board.set(this.key(x, y), g.id);
            });
            if (moved.some(g => g.id === this.playerCoreId)) {
                const core = this.getPlayerCore();
                this.extendCorePath(core.x, core.y);
            }
            if (piece.owner === 'player') {
                this.landOnTiles(moved);
                this.piecesMoved();
            }
            return moved;
        }
    });
})(hc);
