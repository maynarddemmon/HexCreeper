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
            cfg:{PIECE_R, CORE_BORDER, OWNERS, LINK},
            TILE_TYPE_HEAL, TILE_TYPE_HARM, TILE_TYPE_HOLE, TILE_TYPE_SOLID,
            PIECE_TYPES
        } = pkg,
        
        FX_MS = 650,
        
        // Where a heal tile's value goes, from its centre, in cells.
        HEAL_LABEL_OFFSET = [0.3, 0.32],
        
        drawTile = (t, now) => {
            if (t.kind === TILE_TYPE_SOLID) {
                fillCell(t.x, t.y, '--solid');
                strokeCell(t.x, t.y, css('--solid-edge'), Math.max(1, cam.size * 0.03), 1);
                return;
            }
            
            if (t.kind === TILE_TYPE_HOLE) {
                fillCell(t.x, t.y, '--hole');
                // Lines from each corner, fading into the dark towards the centre, so it
                // reads as a pit rather than a cell in fog.
                const [cx, cy] = cellCenter(t.x, t.y);
                ctx.lineWidth = Math.max(1, cam.size * 0.03);
                for (const [wx, wy] of pkg.GRID.corners(t.x, t.y)) {
                    const [px, py] = worldToScreen(wx, wy),
                        fade = ctx.createLinearGradient(px, py, cx, cy);
                    fade.addColorStop(0, css('--hole-line'));
                    fade.addColorStop(0.8, css('--hole'));
                    ctx.strokeStyle = fade;
                    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
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
            const arm = s * 0.22 * k,
                th = Math.max(2, s * 0.1 * k);
            if (heal) {
                ctx.fillRect(cx - th / 2, cy - arm, th, arm * 2);
                ctx.fillRect(cx - arm, cy - th / 2, arm * 2, th);
                if (s >= 22) { // current value in the corner
                    const [lx, ly] = HEAL_LABEL_OFFSET;
                    ctx.font = `700 ${Math.round(s * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
                    ctx.fillText(String(game.healValue(t.x, t.y)), cx + s * lx, cy + s * ly);
                }
            } else {
                // Harm: a spiky X inside a smaller outline
                ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
                ctx.fillRect(-th / 2, -arm, th, arm * 2);
                ctx.fillRect(-arm, -th / 2, arm * 2, th);
                ctx.restore();
                ctx.beginPath(); addCellPath(t.x, t.y, 0, 0.64);
                ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, s * 0.03); ctx.stroke();
            }
        },
        
        // Half the width of a link at the end where `chain` pieces hang below it: wider the
        // longer the chain, up to a limit.
        linkHalfWidth = chain => cam.size * Math.min(0.03 * chain, 0.27),
        
        // Draws a translucent link from `from` to `to` (child -> parent) as a trapezoid between
        // the two cell centres, behind the pieces. `chain` is the longest chain of pieces from
        // `from` down, counting `from`: the link widens from that chain's width at `from` (a
        // point for a lone piece) to one more at `to`, so widths match where links meet.
        drawLink = (from, to, color, chain) => {
            const [ax, ay] = cellCenter(from.x, from.y),
                [bx, by] = cellCenter(to.x, to.y),
                len = Math.hypot(bx - ax, by - ay);
            if (!len) return;
            const px = (ay - by) / len, py = (bx - ax) / len,
                w0 = linkHalfWidth(chain - 1),
                w1 = linkHalfWidth(chain);
            ctx.fillStyle = css(color);
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
            // chunk key per visible cell (used for the visited tint and quadrant borders)
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
        
        if (V.placeMode) {
            if (V.placeMode.stage === 'cell') {
                for (const q of game.placeCells()) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--place-hover' : '--place');
            } else {
                fillCell(V.placeMode.x, V.placeMode.y, '--place-hover');
                for (const p of game.linkCandidates(V.placeMode.x, V.placeMode.y)) linkTargets.add(p.id);
            }
        } else if (sel && !V.healMode) {
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
                if (isHover && !m.attack) { hoverMove = m; if (group.length > 1) ghost = { group, dx: m.dx, dy: m.dy }; }
                if (isHover && m.attack) hoverHits = m.hits;
            }
            // Where the hovered move lands: harm cells go red, heal cells bright green
            if (hoverMove) for (const g of group) {
                const x = g.x + hoverMove.dx, y = g.y + hoverMove.dy;
                const kind = game.isHarm(x, y) ? TILE_TYPE_HARM : game.tileAt(x, y, TILE_TYPE_HEAL) ? TILE_TYPE_HEAL : null;
                if (!kind) continue;
                fillCell(x, y, kind === TILE_TYPE_HARM ? '--harm-hover' : '--heal-hover');
                strokeCell(x, y, kind === TILE_TYPE_HARM ? '--harm' : '--heal', Math.max(2, s * 0.06), 2);
            }
            // Show every enemy a group attack would hit
            if (hoverHits) for (const h of hoverHits) if (!sameCell(h.target, V.hover)) fillCell(h.target.x, h.target.y, '--attack-hover');
        }
        
        // Grid lines (lighter along quadrant borders)
        ctx.lineWidth = 1;
        // each hex draws its NE, E and SE edges, so every edge is drawn once; only edges
        // touching a known cell
        const minor = new Path2D(), major = new Path2D();
        for (const c of visible) {
            const cKnown = isKnown(c.x, c.y);
            let cs = null, mine;
            for (let e = 0; e < 3; e++) {
                const [dx, dy, a, b] = pkg.GRID.edges[e];
                if (!cKnown && !isKnown(c.x + dx, c.y + dy)) continue;
                if (!cs) {
                    cs = pkg.GRID.corners(c.x, c.y);
                    mine = chunkKey(c.x, c.y);
                }
                const path = chunkKey(c.x + dx, c.y + dy) === mine ? minor : major,
                    [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                path.moveTo(ax, ay); path.lineTo(bx, by);
            }
        }
        ctx.strokeStyle = css('--grid');
        ctx.stroke(minor);
        
        ctx.strokeStyle = css('--grid-major');
        ctx.stroke(major);
        
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
        for (const p of game.piecesOf('enemy')) {
            const par = game.parent(p); if (par && shown(p) && shown(par)) drawLink(p, par, '--enemy-link', chain(p));
        }
        for (const p of game.piecesOf('player')) {
            const par = game.parent(p); if (!par) continue;
            drawLink(p, par, selGroupIds.has(p.id) && p.id !== game.selectedId ? '--sel-link' : '--link', chain(p));
        }
        // Pending placement link preview
        if (V.placeMode && V.placeMode.stage === 'link' && V.hover) {
            const cand = game.pieceAt(V.hover.x, V.hover.y);
            if (cand && linkTargets.has(cand.id)) drawLink({x:V.placeMode.x, y:V.placeMode.y}, cand, '--place-ink', 1);
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
            for (const g of ghost.group) {
                const [sx, sy] = cellCenter(g.x + ghost.dx, g.y + ghost.dy);
                PIECE_TYPES[g.type].draw(ctx, sx, sy, s, g, {ghost:true, hl:true, root:g.id === game.playerCoreId});
            }
        }
        
        // Pieces
        for (const p of game.pieces.values()) {
            if (!inView(p.x, p.y) || !shown(p)) continue;
            let [sx, sy] = cellCenter(p.x, p.y);
            const sp = game.effects.find(f => f.spawn && f.x === p.x && f.y === p.y);
            let scale = 1;
            if (sp) { const a = Math.min(1, Math.max(0, (now - sp.t0) / 250)); scale = 0.3 + 0.7 * a; }
            for (const f of game.effects) {
                if (!f.bump || f.bump.from !== p) continue;
                const age = (now - f.t0) / 180;
                if (age >= 0 && age < 1) {
                    const k = Math.sin(age * Math.PI) * 0.28 * s;
                    const [tx, ty] = cellCenter(f.x, f.y), dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1;
                    sx += dx / len * k; sy += dy / len * k;
                }
            }
            ctx.save();
            ctx.translate(sx, sy); ctx.scale(scale, scale);
            PIECE_TYPES[p.type].draw(ctx, 0, 0, s, p, {
                selected: !V.placeMode && !V.healMode && p.id === game.selectedId,
                hl: !V.placeMode && !V.healMode && selGroupIds.has(p.id),
                root: p.id === game.playerCoreId,
                linkTarget: linkTargets.has(p.id),
                healTarget: V.healMode && p.owner === 'player',
                moved: p.owner === 'player' && (game.acted.has(p.id) || game.fresh.has(p.id)),
                spent: p.owner === 'player' && !game.acted.has(p.id) && !game.fresh.has(p.id) && !game.canMove(p),
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
        if (game.effects.length || panning) draw();
        
        // Update HUD
        pkg.app?.update();
    };
})(hc);
