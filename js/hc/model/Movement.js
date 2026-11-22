/*  How a step moves a piece and the pieces linked to it, in each movement mode (a module
    included in Game):
    
    - fixed: the piece's whole subtree moves with it, keeping its shape.
    - free: only the piece moves, but any piece linked below it that would then be out of
      link range is dragged along by the same step (and so on down).
    - follow: the piece leads and its whole tree follows (what's below it, and its parent,
      grandparent and so on, with their other branches), each piece keeping its place
      relative to the piece it's linked to on the way back to the lead; a piece that
      can't get there takes the free cell (within a step of where it is, or where it is)
      nearest that place, keeping its link close to its old length. Followers keep off
      harm tiles, armed or not, as if they were walls (the lead may step on one). So a
      swarm flows after its leader around obstacles, its links stretching and shrinking.
    
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
    
    pkg.Movement = new JS.Module('Movement', {
        /*  The result of stepping piece id by (dx, dy) in mode, on view:
                posOf(id) -> [x, y]
                kidsOf(id) -> ids linked below it
                parentOf(id) -> the id of its parent, or null
                occupant(x, y) -> the id of the piece there, or undefined
                open(x, y) -> whether a piece could stand there (terrain only)
                passable(x, y) -> optional: whether the piece itself may try to go there
                    (it may still be blocked); open, if not given
                harm(x, y) -> optional: whether there's a harm tile there (armed or not),
                    which followers treat as a wall
                target(id, x, y) -> what the piece would hit by moving there, or null
            Returns null if it can't be done, {attack:true, hits} for an attack, or
            {attack:false, moves:[[id, x, y], ...]} for the pieces that move and where. */
        resolveStep: function(view, id, dx, dy, mode) {
            const {posOf, kidsOf, parentOf, open, target} = view,
                range = pkg.cfg.LINK.range,
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
                range = pkg.cfg.LINK.range,
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
        
        /*  Follow: the lead goes first; then, working out from it along links (down to its
            children, up to its parent, and on), each piece goes where it would keep its
            place relative to the piece it was reached from (its guide). If it can't, it
            takes the best free cell within a step of where it is (staying counts): one that
            keeps its link to its guide in range, nearest that place, then keeping the link
            closest to its old length, then staying put. Returns where each piece ends up,
            or null if one has nowhere to go. @private */
        _follow: function(view, lead, pieces, dest, linkOk) {
            const {posOf, kidsOf, parentOf, occupant, open} = view,
                harm = view.harm ?? (() => false),
                inTree = new Set(pieces),
                after = new Map(),
                claimed = new Set(),
                keyOf = ([x, y]) => x + ',' + y,
                // A cell gid can end on: open (and, for a follower, without a harm tile), not
                // taken, and empty or left by a piece of the tree (one that hasn't gone yet
                // only for where gid keeps its place).
                free = (c, gid, ideal) => {
                    const [x, y] = c,
                        o = occupant(x, y);
                    return open(x, y) && (gid === lead || !harm(x, y)) && !claimed.has(keyOf(c)) &&
                        (o === undefined || o === gid || (inTree.has(o) && (after.has(o) || ideal)));
                },
                put = (gid, c) => {
                    after.set(gid, c);
                    claimed.add(keyOf(c));
                };
            
            if (!free(dest(lead), lead, true)) return null;
            put(lead, dest(lead));
            const queue = [lead], guideOf = new Map();
            for (let i = 0; i < queue.length; i++) {
                const g = queue[i], par = parentOf(g);
                for (const n of [...kidsOf(g), ...(par != null && inTree.has(par) ? [par] : [])]) {
                    if (n !== lead && !guideOf.has(n)) {
                        guideOf.set(n, g);
                        queue.push(n);
                    }
                }
            }
            for (const gid of queue.slice(1)) {
                const guide = guideOf.get(gid),
                    [px, py] = posOf(guide), [gx, gy] = posOf(gid), [ax, ay] = after.get(guide),
                    ideal = [ax + gx - px, ay + gy - py];
                if (free(ideal, gid, true)) {
                    put(gid, ideal);
                } else {
                    const oldLink = dist([gx, gy], [px, py]);
                    let best = null, bestKey = null;
                    [[0, 0], ...pkg.GRID.dirs].forEach(([ddx, ddy], i) => {
                        const c = [gx + ddx, gy + ddy];
                        if (free(c, gid, false)) {
                            const link = dist(c, after.get(guide)),
                                key = [linkOk([gx, gy], [px, py], c, after.get(guide)) ? 0 : 1, dist(c, ideal), Math.abs(link - oldLink), i];
                            if (!bestKey || before(key, bestKey)) {
                                best = c;
                                bestKey = key;
                            }
                        }
                    });
                    if (!best) return null;
                    put(gid, best);
                }
            }
            return after;
        },
        
        /*  Whether pieces a and b (ids), next to each other and on the same side, can swap
            cells on view: every link either has ends in range after, or got shorter. What's
            linked to them stays where it is. */
        swapOk: function(view, a, b) {
            const {posOf, kidsOf, parentOf} = view,
                range = pkg.cfg.LINK.range,
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
            a.x = bx;
            a.y = by;
            b.x = ax;
            b.y = ay;
            this.board.set(this.key(a.x, a.y), a.id);
            this.board.set(this.key(b.x, b.y), b.id);
            const core = [a, b].find(p => p.id === this.playerCoreId);
            if (core) this.corePath.push([core.x, core.y]);
            this.landOnTiles([a, b]);
            if (a.owner === 'player') this.updateQuadrants();
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
            nothing linked to it moves, each of its links must end in range. */
        jumpCells: function(view, id) {
            const {posOf, kidsOf, parentOf, occupant, open} = view,
                range = pkg.cfg.LINK.range,
                [px, py] = posOf(id),
                dirs = pkg.GRID.dirs,
                par = parentOf(id),
                linked = [...kidsOf(id), ...(par != null ? [par] : [])].map(posOf),
                out = [];
            dirs.forEach(([ax, ay], i) => {
                const [bx, by] = dirs[(i + 1) % 6],
                    jumps = [
                        {dx:2 * ax, dy:2 * ay, over:[[ax, ay]]},
                        {dx:ax + bx, dy:ay + by, over:[[ax, ay], [bx, by]]}
                    ];
                for (const {dx, dy, over} of jumps) {
                    const x = px + dx,
                        y = py + dy;
                    if (over.some(([ox, oy]) => !this.isSolid(px + ox, py + oy)) && open(x, y) && occupant(x, y) === undefined &&
                        linked.every(q => dist([x, y], q) <= range)) {
                        out.push({x, y});
                    }
                }
            });
            return out;
        },
        
        /*  Jumps piece p to (x, y), if it can (jumpCells; an enemy won't land on harm). It
            lands on the tiles there, and is tired: it can't act this turn or the next. */
        jumpPiece: function(p, x, y) {
            let done = false;
            if (this.jumpCells(this.boardView(p.owner !== 'player'), p.id).some(c => c.x === x && c.y === y)) {
                this.applyMoves(p, [[p.id, x, y]]);
                p.tiredUntil = this.turn + 1;
                this.fx(x, y, 'jump', '--place-ink', {});
                done = true;
            }
            return done;
        },
        
        // A piece of yours that can move this turn can jump, except in follow mode. It uses
        // a move, and the piece can't act again this turn or the next. Enemies can jump too
        // (see planSquad).
        jumpTargets: function(p) {
            let out = [];
            if (!this.over && p?.owner === 'player' && this.canMove(p) && this.modeFor(p) !== 'follow') {
                out = this.jumpCells(this.boardView(), p.id);
            }
            return out;
        },
        canJump: function(p) {return this.jumpTargets(p).length > 0;},
        playerJump: function(p, x, y) {
            let done = false;
            if (this.jumpTargets(p).some(c => c.x === x && c.y === y) && this.jumpPiece(p, x, y)) {
                this.useMove(p);
                this.afterPlayerAction();
                done = true;
            }
            return done;
        },
        
        /*  A view of the board as it is, for resolveStep. With avoidHarm, active harm
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
                parentOf: id => this.parent(this.pieces.get(id))?.id ?? null,
                occupant: (x, y) => this.board.get(this.key(x, y)),
                open: (x, y) => this.isOpen(x, y) && !(avoidHarm && this.isHarm(x, y)),
                harm: (x, y) => this.tiles.get(this.key(x, y))?.kind === pkg.TILE_TYPE_HARM,
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
        
        /*  Puts the pieces that move where resolveStep says. Returns the pieces moved. */
        applyMoves: function(piece, moves) {
            const moved = moves.map(([gid]) => this.pieces.get(gid));
            for (const g of moved) this.board.delete(this.key(g.x, g.y));
            moves.forEach(([, x, y], i) => {
                const g = moved[i];
                g.x = x;
                g.y = y;
                this.board.set(this.key(x, y), g.id);
            });
            if (moved.some(g => g.id === this.playerCoreId)) {
                const core = this.getPlayerCore();
                this.corePath.push([core.x, core.y]);
            }
            if (piece.owner === 'player') {
                this.landOnTiles(moved);
                this.updateQuadrants();
            }
            return moved;
        }
    });
})(hc);
