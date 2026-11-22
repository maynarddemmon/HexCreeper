/*  Draws a frame: quadrant tint, tiles, highlights, grid lines, links, pieces and
    effects. */
(pkg => {
    'use strict';
    
    const V = pkg.view,
        {
            ctx, game, cam, css, worldToScreen, screenToWorld, cellCenter, 
            inView, addCellPath, strokeCell, strokeRegion, sameCell, draw, fillCell
        } = V,
        
        {
            cfg:{PIECE_R, CORE_BORDER, OWNERS, LINK, ANIM},
            TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_HOLE, TILE_TYPE_SOLID, TILE_TYPE_LOOT,
            PIECE_TYPES
        } = pkg,
        
        FX_MS = 650,
        
        // Where a heal tile's value goes, from its centre, in cells.
        HEAL_LABEL_OFFSET = [0.3, 0.32],
        
        // Whether (x, y) holds a tile of the same kind and subtype as t, if t is a solid or
        // a hole: tiles like that run together.
        sameTerrain = (t, x, y) => {
            const n = (t.kind === TILE_TYPE_SOLID || t.kind === TILE_TYPE_HOLE) && game.tiles.get(game.key(x, y));
            return !!n && n.kind === t.kind && n.subtype === t.subtype;
        },
        
        drawTile = (t, now) => {
            if (t.kind === TILE_TYPE_SOLID) {
                // In its subtype's colours, if it has them, filling the whole hex so solids of
                // a kind run together: the outline is only on edges that don't meet a solid of
                // the same subtype (sameTerrain).
                const solid = pkg.solids.get(t.subtype),
                    color = (c, fallback) => c ? (c.startsWith('--') ? css(c) : c) : css(fallback),
                    [cx, cy] = cellCenter(t.x, t.y),
                    inset = 1,
                    pts = pkg.GRID.corners(t.x, t.y).map(([wx, wy]) => {
                        const [px, py] = worldToScreen(wx, wy),
                            d = Math.hypot(px - cx, py - cy) || 1;
                        return [px - (px - cx) * inset / d, py - (py - cy) * inset / d];
                    });
                // Half a pixel bigger, so neighbouring fills overlap rather than leave a faint
                // antialiased seam between them.
                ctx.beginPath();
                addCellPath(t.x, t.y, -0.5);
                ctx.fillStyle = color(solid?.fillColor, '--solid');
                ctx.fill();
                // Where an edge's neighbour isn't drawn, the corner is an outside corner of
                // the joined shape, and this hex's line and the next hex's stop short of each
                // other (each is inset into its own hex): run the line on past the corner, by
                // the inset, to where it meets the neighbour's line; round caps then join the two.
                const lineWidth = Math.max(1, cam.size * 0.03),
                    ext = inset,
                    edges = pkg.GRID.edges,
                    drawn = edges.map(([dx, dy]) => !sameTerrain(t, t.x + dx, t.y + dy));
                ctx.beginPath();
                edges.forEach(([, , a, b], i) => {
                    if (drawn[i]) {
                        const [ax, ay] = pts[a], [bx, by] = pts[b],
                            len = Math.hypot(bx - ax, by - ay) || 1,
                            ux = (bx - ax) / len, uy = (by - ay) / len,
                            pre = drawn[(i + 5) % 6] ? 0 : ext,
                            post = drawn[(i + 1) % 6] ? 0 : ext;
                        ctx.moveTo(ax - ux * pre, ay - uy * pre);
                        ctx.lineTo(bx + ux * post, by + uy * post);
                    }
                });
                ctx.strokeStyle = color(solid?.borderColor, '--solid-edge');
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();
                ctx.lineCap = 'butt';
                // Once damaged, a bar shows how much it has left.
                const maxHp = solid?.hp ?? t.hp;
                if (t.hp < maxHp && cam.size >= 22) {
                    const s = cam.size,
                        [cx, cy] = cellCenter(t.x, t.y),
                        w = s * 0.56,
                        h = Math.max(3, s * 0.06);
                    ctx.fillStyle = css('--grid');
                    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
                    ctx.fillStyle = css('--dmg');
                    ctx.fillRect(cx - w / 2, cy - h / 2, w * Math.max(0, t.hp) / maxHp, h);
                }
                return;
            }
            
            if (t.kind === TILE_TYPE_HOLE) {
                // In its subtype's colour, if it has one, filling the whole hex (and half a
                // pixel more, so there's no seam), so holes of a kind run together into one
                // bigger hole, with no grid line between them (sameTerrain).
                const fillColor = pkg.holes.get(t.subtype)?.fillColor,
                    fill = fillColor ? (fillColor.startsWith('--') ? css(fillColor) : fillColor) : css('--hole');
                ctx.beginPath();
                addCellPath(t.x, t.y, -0.5);
                ctx.fillStyle = fill;
                ctx.fill();
                // Lines in from the corners on the hole's rim, as thin as the grid, fading into
                // the dark, so it reads as a pit rather than a cell in fog. Corner i is between
                // edges i - 1 and i. From a corner that sticks out (no neighbour of the hole at
                // it) the line heads for the centre. From one the rim turns in at (more than
                // 180°: one neighbour of the hole at it) it heads along the edge shared with that
                // neighbour, following the grid; the neighbour draws the same line. Where the
                // rim turns in at both ends of that edge (a choke point), the lines from either
                // end go only halfway, so they don't run over each other. A corner inside the
                // bigger hole gets none.
                const [cx, cy] = cellCenter(t.x, t.y),
                    pts = pkg.GRID.corners(t.x, t.y).map(([wx, wy]) => worldToScreen(wx, wy)),
                    same = pkg.GRID.edges.map(([dx, dy]) => sameTerrain(t, t.x + dx, t.y + dy));
                ctx.lineWidth = 1;
                pts.forEach(([px, py], i) => {
                    const before = same[(i + 5) % 6],
                        after = same[i];
                    if (!(before && after)) {
                        const [hx, hy] = before ? pts[(i + 5) % 6] : after ? pts[(i + 1) % 6] : [cx, cy],
                            choke = before ? !same[(i + 4) % 6] : after && !same[(i + 1) % 6],
                            len = choke ? 0.5 : 1,
                            tx = px + (hx - px) * len,
                            ty = py + (hy - py) * len,
                            fade = ctx.createLinearGradient(px, py, tx, ty);
                        fade.addColorStop(0, css('--hole-line'));
                        fade.addColorStop(0.8, fill);
                        ctx.strokeStyle = fade;
                        ctx.beginPath();
                        ctx.moveTo(px, py);
                        ctx.lineTo(tx, ty);
                        ctx.stroke();
                    }
                });
                return;
            }
            
            if (t.kind === TILE_TYPE_LOOT) {
                // Gold, with a coin, and its score in the corner.
                const s = cam.size,
                    [cx, cy] = cellCenter(t.x, t.y),
                    r = s * 0.17;
                ctx.beginPath(); addCellPath(t.x, t.y, 1);
                ctx.fillStyle = css('--loot-bg'); ctx.fill();
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fillStyle = css('--loot'); ctx.fill();
                ctx.lineWidth = Math.max(1, s * 0.035);
                ctx.strokeStyle = css('--loot-ink');
                ctx.beginPath(); ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2); ctx.stroke();
                if (s >= 22) {
                    const [lx, ly] = HEAL_LABEL_OFFSET;
                    ctx.fillStyle = css('--loot');
                    ctx.font = `700 ${Math.round(s * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
                    ctx.fillText(String(t.value), cx + s * lx, cy + s * ly);
                }
                return;
            }
            
            const s = cam.size,
                [cx, cy] = cellCenter(t.x, t.y),
                heal = t.kind === TILE_TYPE_HEAL,
                ink = css(heal ? '--heal' : '--harm'), bg = css(heal ? '--heal-bg' : '--harm-bg');
            if (t.timer > 0) {
                // Pending: faint dashed outline and the countdown
                ctx.globalAlpha = 0.55;
                strokeCell(t.x, t.y, ink, 1.2, 3.5, [3, 3]);
                if (s >= 16) {
                    ctx.fillStyle = ink;
                    ctx.font = `600 ${Math.round(s * 0.3)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(t.timer), cx, cy + 1);
                }
                ctx.globalAlpha = 1;
                return;
            }
            
            // Active: pop briefly when it arms
            const armFx = game.effects.find(f => f.arm && f.x === t.x && f.y === t.y);
            let k = 1;
            if (armFx) {
                const a = Math.min(1, Math.max(0, (now - armFx.t0) / 300));
                k = 0.4 + 0.6 * a;
            }
            ctx.beginPath(); addCellPath(t.x, t.y, 1);
            ctx.fillStyle = bg; ctx.fill();
            ctx.fillStyle = ink;
            const arm = s * 0.22 * k;
            if (heal) {
                // A heart: two lobes meeting at a point below.
                const w = arm * 1.05;
                ctx.beginPath();
                ctx.moveTo(cx, cy + w * 0.95);
                ctx.bezierCurveTo(cx - w * 1.45, cy + w * 0.1, cx - w * 0.95, cy - w * 1.1, cx, cy - w * 0.35);
                ctx.bezierCurveTo(cx + w * 0.95, cy - w * 1.1, cx + w * 1.45, cy + w * 0.1, cx, cy + w * 0.95);
                ctx.fill();
                if (s >= 22) { // current value in the corner
                    const [lx, ly] = HEAL_LABEL_OFFSET;
                    ctx.font = `700 ${Math.round(s * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
                    ctx.fillText(String(game.healValue(t.x, t.y)), cx + s * lx, cy + s * ly);
                }
            } else {
                // Harm: a drop of blood, pointed at the top and round below.
                const r = arm * 0.68,
                    by = cy + arm * 0.3,
                    tip = cy - arm * 1.1;
                ctx.beginPath();
                ctx.moveTo(cx, tip);
                ctx.bezierCurveTo(cx + r * 0.3, by - r * 1.5, cx + r, by - r * 0.85, cx + r, by);
                ctx.arc(cx, by, r, 0, Math.PI);
                ctx.bezierCurveTo(cx - r, by - r * 0.85, cx - r * 0.3, by - r * 1.5, cx, tip);
                ctx.fill();
            }
        },
        
        // Half the width of a link at the end where `chain` pieces hang below it: wider the
        // longer the chain, up to a limit.
        linkHalfWidth = chain => cam.size * Math.min(0.03 * chain, 0.27),
        
        // How much of a link to a piece out of sight is drawn, from the end in sight.
        LINK_STUB = 0.5,
        
        // A colour as written in index.html (#rgb, #rgba, #rrggbb or #rrggbbaa), made fully
        // transparent, for fading to: fading to plain "transparent" would go through black.
        clearOf = c => {
            const hex = c.trim().replace('#', ''),
                full = hex.length <= 4 ? [...hex].map(h => h + h).join('') : hex,
                [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
            return `rgba(${r}, ${g}, ${b}, 0)`;
        },
        
        // Draws a translucent link from `from` to `to` (child -> parent) as a trapezoid between
        // the two cell centres, behind the pieces. `chain` is the longest chain of pieces from
        // `from` down, counting `from`: the link widens from that chain's width at `from` (a
        // point for a lone piece) to one more at `to`, so widths match where links meet.
        // `hidden` ('from' or 'to') says an end is out of sight: then only the part nearest
        // the other end is drawn (LINK_STUB), fading out, so you can tell a piece is linked to
        // something you can't see, but not quite where.
        drawLink = (from, to, color, chain, hidden = null) => {
            let [ax, ay] = cellCenter(from.x, from.y),
                [bx, by] = cellCenter(to.x, to.y);
            const len = Math.hypot(bx - ax, by - ay);
            if (!len) return;
            const px = (ay - by) / len, py = (bx - ax) / len;
            let w0 = linkHalfWidth(chain - 1),
                w1 = linkHalfWidth(chain),
                fill = css(color);
            if (hidden === 'to') {
                bx = ax + (bx - ax) * LINK_STUB;
                by = ay + (by - ay) * LINK_STUB;
                w1 = w0 + (w1 - w0) * LINK_STUB;
                fill = ctx.createLinearGradient(ax, ay, bx, by);
            } else if (hidden === 'from') {
                ax = bx + (ax - bx) * LINK_STUB;
                ay = by + (ay - by) * LINK_STUB;
                w0 = w1 + (w0 - w1) * LINK_STUB;
                fill = ctx.createLinearGradient(bx, by, ax, ay);
            }
            if (hidden) {
                fill.addColorStop(0, css(color));
                fill.addColorStop(1, clearOf(css(color)));
            }
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(ax + px * w0, ay + py * w0);
            ctx.lineTo(bx + px * w1, by + py * w1);
            ctx.lineTo(bx - px * w1, by - py * w1);
            ctx.lineTo(ax - px * w0, ay - py * w0);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        },
        
        // Fills each cell on its own. (One path holding many closed cells is far slower to
        // fill: hundreds of ms for a screenful.)
        fillCells = (cells, color) => {
            ctx.fillStyle = css(color);
            for (const c of cells) {
                ctx.beginPath();
                addCellPath(c.x, c.y, 0);
                ctx.fill();
            }
        },
        
        // Your core is bigger, so its bar sits lower, clear of its selection ring.
        drawHpBar = (p, cx, cy, s) => {
            const w = s * 0.56,
                h = Math.max(3, s * 0.06),
                x = cx - w / 2,
                y = cy + s * (0.37 + (p.id === game.playerCoreId ? CORE_BORDER : 0));
            ctx.fillStyle = css('--grid');
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = css(OWNERS[p.owner].fill);
            ctx.fillRect(x, y, w * Math.max(0, p.hp) / p.maxHp, h);
        };
    
    V.render = (now) => {
        V.rafPending = false;
        const panning = V.stepPan(now);
        ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
        const {W , H}= V,
            s = cam.size,
            [x0, y0] = screenToWorld(0, 0),
            [x1, y1] = screenToWorld(W, H),
            visible = [...pkg.GRID.visibleCells(x0, y0, x1, y1)],
            // chunk key per visible cell (for the visited tint)
            chunkKeys = new Map(),
            chunkKey = (x, y) => {
                const k = x + ',' + y;
                let v = chunkKeys.get(k);
                if (v === undefined) {
                    v = pkg.GRID.chunkKey(x, y); chunkKeys.set(k, v);
                }
                return v;
            },
            
            // Fog of war: sight is null when it's off. Enemies show only on cells in sight,
            // until the game is over, when they all show, to see what came for you.
            // Cells never seen show only as fog, so the board below is drawn only on cells
            // that have been seen ("known"); the ones out of sight now are dimmed after.
            sight = game.cellsInSight(),
            inSight = (x, y) => !sight || sight.has(game.key(x, y)),
            shown = p => p.owner === 'player' || game.over || inSight(p.x, p.y),
            isKnown = (x, y) => !sight || game.seenCells.has(game.key(x, y)),
            known = sight ? visible.filter(c => isKnown(c.x, c.y)) : visible;
        
        // Each piece's moves still to play (Game.motionFx), in order.
        game.motions = game.motions.filter(m => now < m.t0 + m.dur);
        const motionsOf = new Map(),
            places = new Map(),
            
            // Where a piece is drawn, {x, y, scale, seen}: along the first of its moves still
            // to play that's in sight at either end, eased, growing and shrinking for a jump,
            // or before that move starts, where it starts; with none, where it is (so a move
            // entirely out of sight isn't animated). seen: whether to draw it (an enemy
            // shows only in sight, or on its way into or out of it).
            placeOf = p => {
                let place = places.get(p.id);
                if (!place) {
                    const seenAt = (x, y) => p.owner === 'player' || game.over || inSight(x, y),
                        m = (motionsOf.get(p.id) ?? []).find(m => inSight(...m.from) || inSight(...m.to));
                    if (!m) {
                        place = {x:p.x, y:p.y, scale:1, seen:seenAt(p.x, p.y)};
                    } else if (now < m.t0) {
                        place = {x:m.from[0], y:m.from[1], scale:1, seen:seenAt(...m.from)};
                    } else {
                        const t = Math.min(1, (now - m.t0) / m.dur),
                            e = t * t * (3 - 2 * t);
                        place = {
                            x:m.from[0] + (m.to[0] - m.from[0]) * e,
                            y:m.from[1] + (m.to[1] - m.from[1]) * e,
                            scale:m.jump ? 1 + ANIM.JUMP_GROW * Math.sin(Math.PI * t) : 1,
                            seen:true
                        };
                    }
                    places.set(p.id, place);
                }
                return place;
            };
        for (const m of game.motions) {
            if (!motionsOf.has(m.id)) motionsOf.set(m.id, []);
            motionsOf.get(m.id).push(m);
        }
        
        // Background: fog everywhere, then plain floor on known cells.
        ctx.fillStyle = css('--bg');
        ctx.fillRect(0, 0, W, H);
        if (sight) {
            ctx.fillStyle = css('--fog');
            ctx.fillRect(0, 0, W, H);
            fillCells(known, '--bg');
        }
        
        // Visited quadrants
        fillCells(known.filter(c => game.visitedQuads.has(chunkKey(c.x, c.y))), '--visited');
        
        // Heal, harm, solid and hole tiles
        for (const t of game.tiles.values()) {
            if (inView(t.x, t.y) && isKnown(t.x, t.y)) drawTile(t, now);
        }
        
        // Tint occupied cells
        for (const p of game.pieces.values()) {
            if (!inView(p.x, p.y) || !shown(p)) continue;
            fillCell(p.x, p.y, p.owner === 'player' ? '--core-tint' : '--enemy-tint');
        }
        
        const sel = game.getSelected();
        let selGroupIds = new Set(), ghost = null, linkTargets = new Set();
        
        if (V.placeMode && sel) {
            // The cells next to the selected piece a piece could be placed on.
            for (const q of game.placeCells(sel)) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--place-hover' : '--place');
        } else if (V.jumpMode && sel) {
            // The cells the selected piece can jump to.
            fillCell(sel.x, sel.y, '--sel-bg');
            for (const q of game.jumpTargets(sel)) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--move-hover' : '--move');
        } else if ((V.attachMode || V.swapMode) && sel) {
            // The pieces the selected one can attach to, or swap with.
            fillCell(sel.x, sel.y, '--sel-bg');
            for (const p of V.attachMode ? game.attachTargets(sel) : game.swapTargets(sel)) linkTargets.add(p.id);
        } else if (sel) {
            // Link-range box around the selected piece's parent
            const par = game.parent(sel);
            if (par) strokeRegion(par, LINK.range, '--range');
            const group = game.group(sel);
            selGroupIds = new Set(group.map(g => g.id));
            for (const g of group) if (g !== sel) fillCell(g.x, g.y, '--sel-tint');
            fillCell(sel.x, sel.y, '--sel-bg');
            let hoverHits = null, hoverMove = null;
            for (const m of game.legalMoves(sel)) {
                const isHover = sameCell(V.hover, m);
                fillCell(m.x, m.y, m.attack ? (isHover ? '--attack-hover' : '--attack') : (isHover ? '--move-hover' : '--move'));
                if (isHover && !m.attack) {
                    hoverMove = m;
                    if (group.length > 1) ghost = m.moves; // where each piece that moves would go
                }
                if (isHover && m.attack) hoverHits = m.hits;
            }
            // Where the hovered move lands: harm cells go red, heal cells bright green, loot gold
            if (hoverMove) for (const [, x, y] of hoverMove.moves) {
                const kind = game.isHarm(x, y) ? TILE_TYPE_HARM : game.tileAt(x, y, TILE_TYPE_HEAL) ? TILE_TYPE_HEAL : game.tileAt(x, y, TILE_TYPE_LOOT) ? TILE_TYPE_LOOT : null;
                if (kind) fillCell(x, y, '--' + kind + '-hover');
            }
            // Show every enemy a group attack would hit
            if (hoverHits) for (const h of hoverHits) if (!sameCell(h.target, V.hover)) fillCell(h.target.x, h.target.y, '--attack-hover');
        }
        
        // Grid lines: the same everywhere (quadrants show only as the visited tint), and
        // none between solids or holes of the same subtype, which run together.
        ctx.lineWidth = 1;
        // each hex draws its NE, E and SE edges, so every edge is drawn once; only edges
        // touching a known cell
        const grid = new Path2D();
        for (const c of visible) {
            const cKnown = isKnown(c.x, c.y),
                tile = game.tiles.get(game.key(c.x, c.y));
            let cs = null;
            for (let e = 0; e < 3; e++) {
                const [dx, dy, a, b] = pkg.GRID.edges[e];
                if ((cKnown || isKnown(c.x + dx, c.y + dy)) && !(tile && sameTerrain(tile, c.x + dx, c.y + dy))) {
                    cs ??= pkg.GRID.corners(c.x, c.y);
                    const [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                    grid.moveTo(ax, ay); grid.lineTo(bx, by);
                }
            }
        }
        ctx.strokeStyle = css('--grid');
        ctx.stroke(grid);
        
        // Origin marker
        {
            const [sx, sy] = cellCenter(0, 0);
            if (sx > -s && sx < W + s && sy > -s && sy < H + s) {
                ctx.strokeStyle = css('--grid-major');
                ctx.lineWidth = 1.5;
                const r = s * 0.12;
                ctx.beginPath();
                ctx.moveTo(sx - r, sy);
                ctx.lineTo(sx + r, sy);
                ctx.moveTo(sx, sy - r);
                ctx.lineTo(sx, sy + r);
                ctx.stroke();
            }
        }
        
        // The golden path: a trail of small dots along every step the core has taken, kept
        // faint and small since it's only a reminder of where you've been. Each step starts
        // at the centre of its cell and stops a gap short of the next one, where the next
        // step starts, so steps don't overlap; the last step goes all the way to the core.
        // Each step is filled on its own, so retraced steps stack up and look darker.
        const path = game.corePath,
            dot = Math.max(0.7, s * 0.025);
        ctx.fillStyle = css('--path');
        for (let i = 1; i < path.length; i++) {
            const [ax, ay] = path[i - 1], [bx, by] = path[i];
            if (!inView(ax, ay) && !inView(bx, by)) continue;
            const [sx, sy] = cellCenter(ax, ay), [ex, ey] = cellCenter(bx, by),
                len = Math.hypot(ex - sx, ey - sy);
            if (!len) continue;
            const n = Math.max(1, Math.round(len / Math.max(8, s * 0.22)));
            ctx.beginPath();
            for (let k = 0, last = i === path.length - 1 ? n : n - 1; k <= last; k++) {
                const t = k / n, px = sx + (ex - sx) * t, py = sy + (ey - sy) * t;
                ctx.moveTo(px + dot, py);
                ctx.arc(px, py, dot, 0, 2 * Math.PI);
            }
            ctx.fill();
        }
        
        // Known cells out of sight are dimmed
        if (sight) fillCells(known.filter(c => !sight.has(game.key(c.x, c.y))), '--fog');
        
        // Link lines: from each child to its parent. A piece's chain is the longest chain of
        // pieces from it down to a leaf, counting itself.
        const chains = new Map();
        for (const p of game.pieces.values()) {
            let n = 1;
            for (let a = game.parent(p); a; a = game.parent(a)) {
                if ((chains.get(a.id) ?? 0) >= ++n) break; // already set from a longer chain
                chains.set(a.id, n);
            }
        }
        const chain = p => chains.get(p.id) ?? 1;
        // Between where the pieces are drawn (placeOf). An enemy's link to a piece out of
        // sight shows as a stub fading into the fog.
        for (const p of game.piecesOf('enemy')) {
            const par = game.parent(p);
            if (par) {
                const a = placeOf(p),
                    b = placeOf(par);
                if (a.seen || b.seen) drawLink(a, b, '--enemy-link', chain(p), a.seen ? (b.seen ? null : 'to') : 'from');
            }
        }
        for (const p of game.piecesOf('player')) {
            const par = game.parent(p);
            if (par) drawLink(placeOf(p), placeOf(par), selGroupIds.has(p.id) && p.id !== game.selectedId ? '--sel-link' : '--link', chain(p));
        }
        // The link a piece placed on the hovered cell would have
        if (V.placeMode && sel && V.hover && game.placeCells(sel).some(q => sameCell(q, V.hover))) {
            drawLink(V.hover, sel, '--place-ink', 1);
        }
        
        // Effects state per cell (flash)
        const flashAt = new Map();
        for (const f of game.effects) {
            if (!f.flash) continue;
            const age = now - f.t0;
            if (age >= 0 && age < 220) flashAt.set(game.key(f.x, f.y), 1 - age / 220);
        }
        
        // Ghost preview of a group move
        if (ghost) {
            for (const [id, x, y] of ghost) {
                const g = game.pieces.get(id),
                    [sx, sy] = cellCenter(x, y);
                PIECE_TYPES[g.type].draw(ctx, sx, sy, s, g, {ghost:true, hl:true, root:g.id === game.playerCoreId});
            }
        }
        
        // Pieces destroyed in an action that hasn't played yet (Game.damage), until it does.
        for (const f of game.effects) {
            const p = f.piece;
            if (p && now < f.t0 && !game.pieces.has(p.id) && inView(p.x, p.y) && (p.owner === 'player' || inSight(p.x, p.y))) {
                const [sx, sy] = cellCenter(p.x, p.y);
                PIECE_TYPES[p.type].draw(ctx, sx, sy, s, p, {root:p.id === game.playerCoreId});
            }
        }
        
        // Pieces, where placeOf says.
        for (const p of game.pieces.values()) {
            const place = placeOf(p);
            if (!inView(place.x, place.y) || !place.seen) continue;
            let [sx, sy] = cellCenter(place.x, place.y);
            const sp = game.effects.find(f => f.spawn && f.x === p.x && f.y === p.y);
            let scale = place.scale;
            if (sp) { const a = Math.min(1, Math.max(0, (now - sp.t0) / 250)); scale *= 0.3 + 0.7 * a; }
            for (const f of game.effects) {
                if (!f.bump || f.bump.from !== p) continue;
                const age = (now - f.t0) / ANIM.BUMP_MS;
                if (age >= 0 && age < 1) {
                    const k = Math.sin(age * Math.PI) * 0.28 * s;
                    const [tx, ty] = cellCenter(f.x, f.y), dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1;
                    sx += dx / len * k; sy += dy / len * k;
                }
            }
            ctx.save();
            ctx.translate(sx, sy); ctx.scale(scale, scale);
            PIECE_TYPES[p.type].draw(ctx, 0, 0, s, p, {
                selected: !V.placeMode && p.id === game.selectedId,
                hl: !V.placeMode && selGroupIds.has(p.id),
                root: p.id === game.playerCoreId,
                linkTarget: linkTargets.has(p.id),
                moved: p.owner === 'player' && (game.acted.has(p.id) || game.fresh.has(p.id) || game.isTired(p)),
                spent: p.owner === 'player' && !game.acted.has(p.id) && !game.fresh.has(p.id) && !game.isTired(p) && !game.canMove(p),
            });
            ctx.restore();
            
            const fl = flashAt.get(game.key(p.x, p.y));
            if (fl) {
                ctx.globalAlpha = fl * 0.7; ctx.fillStyle = css('--dmg');
                ctx.beginPath(); ctx.arc(sx, sy, s * (PIECE_R + (p.id === game.playerCoreId ? CORE_BORDER : 0)), 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (p.maxHp > 1 && s >= 22) drawHpBar(p, sx, sy, s);
        }
        
        // Floating text + death bursts
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const f of game.effects) {
            const age = (now - f.t0) / FX_MS;
            if (age < 0 || age >= 1 || !inSight(f.x, f.y)) continue;
            const [sx, sy] = cellCenter(f.x, f.y);
            if (f.text) {
                ctx.globalAlpha = 1 - age;
                ctx.fillStyle = css(f.color);
                ctx.font = `600 ${Math.max(12, s * 0.3)}px ui-sans-serif, system-ui, sans-serif`;
                ctx.fillText(f.text, sx + (f.text[0] === '+' ? s * 0.25 : 0), sy - s * 0.45 - age * s * 0.5);
            }
            if (f.vanish) {
                ctx.globalAlpha = 0.6 * (1 - age);
                ctx.strokeStyle = css(f.color); ctx.lineWidth = 2;
                const r = s * 0.22 * (1 + age);
                ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r); ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r); ctx.stroke();
            }
            if (f.burst) {
                ctx.globalAlpha = 1 - age;
                ctx.strokeStyle = css(f.color); ctx.lineWidth = 2;
                for (let i = 0; i < 8; i++) {
                    const a = i / 8 * Math.PI * 2, r0 = s * (0.15 + age * 0.35), r1 = r0 + s * 0.12;
                    ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
                    ctx.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
        }
        
        // Off-screen indicator for the player's core
        const core = game.getPlayerCore();
        if (core) {
            const [sx, sy] = cellCenter(core.x, core.y);
            const pad = 22;
            if (sx < 0 || sx > W || sy < 0 || sy > H) {
                const ax = Math.min(W - pad, Math.max(pad, sx)), ay = Math.min(H - pad, Math.max(pad, sy));
                const ang = Math.atan2(sy - H / 2, sx - W / 2);
                ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
                ctx.fillStyle = css('--core');
                ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
                ctx.restore();
            }
        }
        
        game.effects = game.effects.filter(f => now - f.t0 < FX_MS);
        if (game.effects.length || game.motions.length || panning) draw();
        
        // Update HUD
        pkg.app?.update();
    };
})(hc);
