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
            cfg:{PIECE_R, OWNERS, LINK},
            PIECE_TYPES
        } = pkg,
        
        FX_MS = 650,
        
        // Where a heal tile's value goes, from its centre, in cells.
        HEAL_LABEL_OFFSET = [0.3, 0.32],
        
        drawTile = (t, now) => {
            const s = cam.size,
                [cx, cy] = cellCenter(t.x, t.y),
                heal = t.kind === 'heal',
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
        
        // Draws a tapered arrow from `from` (thick end) to `to` (arrowhead).
        // Links are drawn child -> parent.
        drawLink = (from, to, color) => {
            const parent = from, child = to; // geometry below: thick at `parent`, tip at `child`
            const s = cam.size;
            const [ax, ay] = cellCenter(parent.x, parent.y);
            const [bx, by] = cellCenter(child.x, child.y);
            const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy); if (!len) return;
            const ux = dx / len, uy = dy / len, px = -uy, py = ux;
            const gap = s * (PIECE_R + 0.05);
            const sx = ax + ux * gap, sy = ay + uy * gap;          // start: parent edge
            const ex = bx - ux * gap, ey = by - uy * gap;          // end: child edge (arrow tip)
            const head = Math.min(s * 0.16, (len - 2 * gap) * 0.5);
            const hx = ex - ux * head, hy = ey - uy * head;        // arrowhead base
            const w0 = s * 0.07, w1 = s * 0.015, wh = s * 0.075;
            ctx.fillStyle = css(color);
            ctx.beginPath();
            ctx.moveTo(sx + px * w0, sy + py * w0);
            ctx.lineTo(hx + px * w1, hy + py * w1);
            ctx.lineTo(hx + px * wh, hy + py * wh);
            ctx.lineTo(ex, ey);
            ctx.lineTo(hx - px * wh, hy - py * wh);
            ctx.lineTo(hx - px * w1, hy - py * w1);
            ctx.lineTo(sx - px * w0, sy - py * w0);
            ctx.closePath();
            ctx.fill();
        },
        
        drawHpBar = (p, cx, cy, s) => {
            const w = s * 0.56,
                h = Math.max(3, s * 0.06),
                x = cx - w / 2,
                y = cy + s * 0.37;
            ctx.fillStyle = css('--grid');
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = css(OWNERS[p.owner].fill);
            ctx.fillRect(x, y, w * Math.max(0, p.hp) / p.maxHp, h);
        };
    
    V.render = (now) => {
        V.rafPending = false;
        ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
        const W = V.W,
            H = V.H,
            s = cam.size;
        ctx.fillStyle = css('--bg');
        ctx.fillRect(0, 0, W, H);
        
        const [x0, y0] = screenToWorld(0, 0),
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
            };
        
        // Visited quadrants
        ctx.beginPath();
        for (const c of visible) if (game.visitedQuads.has(chunkKey(c.x, c.y))) addCellPath(c.x, c.y, 0);
        ctx.fillStyle = css('--visited'); ctx.fill();
        
        // Heal / harm tiles
        for (const t of game.tiles.values()) {
            if (inView(t.x, t.y)) drawTile(t, now);
        }
        
        // Tint occupied cells
        for (const p of game.pieces.values()) {
            if (!inView(p.x, p.y)) continue;
            fillCell(p.x, p.y, p.owner === 'player' ? '--core-tint' : '--enemy-tint');
        }
        
        const sel = game.selected;
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
                const kind = game.isHarm(x, y) ? 'harm' : game.tileAt(x, y, 'heal') ? 'heal' : null;
                if (!kind) continue;
                fillCell(x, y, kind === 'harm' ? '--harm-hover' : '--heal-hover');
                strokeCell(x, y, kind === 'harm' ? '--harm' : '--heal', Math.max(2, s * 0.06), 2);
            }
            // Show every enemy a group attack would hit
            if (hoverHits) for (const h of hoverHits) if (!sameCell(h.target, V.hover)) fillCell(h.target.x, h.target.y, '--attack-hover');
        }
        
        // Grid lines (darker along quadrant borders)
        ctx.lineWidth = 1;
        // each hex draws its NE, E and SE edges, so every edge is drawn once
        const minor = new Path2D(), major = new Path2D();
        for (const c of visible) {
            const cs = pkg.GRID.corners(c.x, c.y), mine = chunkKey(c.x, c.y);
            for (let e = 0; e < 3; e++) {
                const [dx, dy, a, b] = pkg.GRID.edges[e],
                    path = chunkKey(c.x + dx, c.y + dy) === mine ? minor : major,
                    [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                path.moveTo(ax, ay); path.lineTo(bx, by);
            }
        }
        ctx.strokeStyle = css('--grid'); ctx.stroke(minor);
        ctx.strokeStyle = css('--grid-major'); ctx.lineWidth = 1.5; ctx.stroke(major); ctx.lineWidth = 1;
        
        // Origin marker
        {
            const [sx, sy] = cellCenter(0, 0);
            if (sx > -s && sx < W + s && sy > -s && sy < H + s) {
                ctx.strokeStyle = css('--grid-major'); ctx.lineWidth = 1.5;
                const r = s * 0.12;
                ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy); ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r); ctx.stroke();
            }
        }
        
        // Link lines: arrows from each child to its parent
        for (const p of game.piecesOf('enemy')) {
            const par = game.parent(p); if (par) drawLink(p, par, '--enemy-link');
        }
        for (const p of game.piecesOf('player')) {
            const par = game.parent(p); if (!par) continue;
            drawLink(p, par, selGroupIds.has(p.id) && p.id !== game.selectedId ? '--sel-link' : '--link');
        }
        // Pending placement link preview
        if (V.placeMode && V.placeMode.stage === 'link' && V.hover) {
            const cand = game.pieceAt(V.hover.x, V.hover.y);
            if (cand && linkTargets.has(cand.id)) drawLink({ x: V.placeMode.x, y: V.placeMode.y }, cand, '--place-ink');
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
            if (!inView(p.x, p.y)) continue;
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
                ctx.beginPath(); ctx.arc(sx, sy, s * PIECE_R, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (p.maxHp > 1 && s >= 22) drawHpBar(p, sx, sy, s);
        }
        
        // Floating text + death bursts
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const f of game.effects) {
            const age = (now - f.t0) / FX_MS;
            if (age < 0 || age >= 1) continue;
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
        const core = game.playerCore;
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
        if (game.effects.length) draw();
        
        V.updateHud();
    };
})(hc);
