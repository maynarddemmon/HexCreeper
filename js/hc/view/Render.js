(pkg => {
    'use strict';
    
    const V = pkg.view,
        {
            ctx, game, cam, css, worldToScreen, screenToWorld, cellCenter, 
            inView, addCellPath, strokeRegion, sameCell, draw, fillCell
        } = V,
        
        {
            cfg:{PIECE_R, CORE_BORDER, ANIM, SHADOW},
            TILE_TYPE_HOLE, TILE_TYPE_SOLID, FIXTURE_HEAL, FIXTURE_LOOT,
            PIECE_TYPES
        } = pkg,
        
        FX_MS = 650,
        ENEMY_ARROW_SIZE = 0.75,     // an off-board enemy squad's arrow, of your core's
        
        // A hole's rim lines fade into it in this many steps (see drawTile): each a part of
        // the line drawn fainter, rather than a gradient, since making a gradient for every
        // line every frame made the browser hold on to a lot of memory.
        FADE_STEPS = 6,
        
        // Where a heal, harm or loot tile's magnitude goes, from its centre, in cells (and
        // its other numbers, mirrored; see drawTileLabels).
        TILE_LABEL_OFFSET = [0.3, 0.32],
        
        // A see-through solid's fill is drawn as see-through as it is, but at least this
        // strong, so it still shows (its edges are drawn in full).
        SOLID_MIN_FILL = 0.25,
        
        // A colour from data (any CSS colour, or a --variable), or the fallback --variable.
        dataColor = (c, fallback) => c ? (c.startsWith('--') ? css(c) : c) : css(fallback),
        
        // How strongly a solid of the subtype is filled: by its opacity (Solids.js).
        solidFillAlpha = solid => Math.max(SOLID_MIN_FILL, (solid?.opacity ?? 100) / 100),
        
        // Fills the see-through solids among tiles (each kind as one shape, so the fills
        // don't darken where neighbours overlap). Opaque ones are filled with the rest of
        // their tile (drawTile).
        fillSeeThroughSolids = tiles => {
            const byKind = new Map();
            for (const t of tiles) {
                if (t.kind === TILE_TYPE_SOLID && solidFillAlpha(pkg.solids.get(t.subtype)) < 1) {
                    if (!byKind.has(t.subtype)) byKind.set(t.subtype, []);
                    byKind.get(t.subtype).push(t);
                }
            }
            for (const [subtype, kind] of byKind) {
                const solid = pkg.solids.get(subtype);
                ctx.beginPath();
                for (const t of kind) addCellPath(t.x, t.y, -0.5);
                ctx.globalAlpha = solidFillAlpha(solid);
                ctx.fillStyle = dataColor(solid?.fillColor, '--solid');
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        },
        
        // ---- Shadows (cfg.SHADOW, from data/init.json5) ----
        // One light, so every shadow falls the same way: away from it, at SHADOW.angle. A
        // solid's shadow is its hex moved that way by its length, on the floor below it,
        // as dark as its coverage; a hole's is the shadow of its rim on the side the light
        // comes from, falling into it. Each is drawn as one shape for all the tiles with
        // the same shadow (so overlaps don't darken), and blurred by hand: filled three
        // times, a little smaller, as is and a little bigger (a hole's a little shorter, as
        // is and a little longer), each a third as dark, so its edge fades over blur px.
        // (The canvas's own blur, filter or shadowBlur, costs a lot every frame, by area.)
        
        // Where shadows fall, as a unit vector on the screen
        shadowDir = () => {
            const a = SHADOW.angle * Math.PI / 180;
            return [Math.cos(a), Math.sin(a)];
        },
        
        // A solid or hole subtype's shadow's length, in px
        shadowLengthOf = def => (def?.shadowLength ?? SHADOW.length) * cam.size,
        
        // The blur's passes: [inset in px, how dark of the shadow's colour]
        blurPasses = () => SHADOW.blur > 0 ? [[SHADOW.blur / 2, 1 / 3], [0, 1 / 3], [-SHADOW.blur / 2, 1 / 3]] : [[0, 1]],
        
        /*  The shadows of the solids among tiles, on the floor (only where it's known:
            known, a list of cells, or all of it if null). */
        drawSolidShadows = (tiles, known) => {
            const groups = new Map(); // "length,darkness" -> {len, alpha, tiles}
            for (const t of tiles) {
                if (t.kind === TILE_TYPE_SOLID) {
                    const solid = pkg.solids.get(t.subtype),
                        len = shadowLengthOf(solid),
                        alpha = (solid?.coverage ?? 100) / 100,
                        key = len + ',' + alpha;
                    if (len > 0 && alpha > 0) {
                        if (!groups.has(key)) groups.set(key, {len, alpha, tiles:[]});
                        groups.get(key).tiles.push(t);
                    }
                }
            }
            if (groups.size) {
                const [ux, uy] = shadowDir();
                ctx.save();
                if (known) {
                    ctx.beginPath();
                    for (const c of known) addCellPath(c.x, c.y, -0.5);
                    ctx.clip();
                }
                ctx.fillStyle = SHADOW.color;
                for (const {len, alpha, tiles:group} of groups.values()) {
                    ctx.save();
                    ctx.translate(ux * len, uy * len);
                    for (const [inset, dark] of blurPasses()) {
                        ctx.globalAlpha = dark * alpha;
                        ctx.beginPath();
                        for (const t of group) addCellPath(t.x, t.y, inset);
                        ctx.fill();
                    }
                    ctx.restore();
                }
                ctx.restore();
            }
        },
        
        /*  The shadows in the holes among tiles: from each edge of a hole that faces the
            light and isn't against another hole, a band its length long falls into it
            (only inside the holes). */
        drawHoleShadows = tiles => {
            const holes = tiles.filter(t => t.kind === TILE_TYPE_HOLE),
                [ux, uy] = shadowDir(),
                rims = []; // [ax, ay, bx, by, length in px]
            for (const t of holes) {
                const len = shadowLengthOf(pkg.holes.get(t.subtype));
                if (len > 0) {
                    const [cx, cy] = cellCenter(t.x, t.y),
                        pts = pkg.hex.corners(t.x, t.y).map(([wx, wy]) => worldToScreen(wx, wy));
                    for (const [dx, dy, a, b] of pkg.hex.edges) {
                        const [ax, ay] = pts[a], [bx, by] = pts[b];
                        // Facing the light: its outward side is towards where the light comes from.
                        if (game.tiles.get(game.key(t.x + dx, t.y + dy))?.kind !== TILE_TYPE_HOLE &&
                            ((ax + bx) / 2 - cx) * ux + ((ay + by) / 2 - cy) * uy < 0) {
                            rims.push([ax, ay, bx, by, len]);
                        }
                    }
                }
            }
            if (rims.length) {
                ctx.save();
                ctx.beginPath();
                for (const t of holes) addCellPath(t.x, t.y, -0.5);
                ctx.clip();
                ctx.fillStyle = SHADOW.color;
                for (const [inset, dark] of blurPasses()) {
                    ctx.globalAlpha = dark;
                    ctx.beginPath();
                    for (const [ax, ay, bx, by, len] of rims) {
                        // Each band the same way round, so where they overlap they fill as one.
                        const l = Math.max(0, len - inset), ox = ux * l, oy = uy * l,
                            [px, py, qx, qy] = (bx - ax) * oy - (by - ay) * ox >= 0 ? [ax, ay, bx, by] : [bx, by, ax, ay];
                        ctx.moveTo(px, py);
                        ctx.lineTo(qx, qy);
                        ctx.lineTo(qx + ox, qy + oy);
                        ctx.lineTo(px + ox, py + oy);
                        ctx.closePath();
                    }
                    ctx.fill();
                }
                ctx.restore();
            }
        },
        
        // Whether (x, y) holds a tile of the same kind and subtype as t, if t is a solid or
        // a hole: tiles like that run together.
        sameTerrain = (t, x, y) => {
            const n = (t.kind === TILE_TYPE_SOLID || t.kind === TILE_TYPE_HOLE) && game.tiles.get(game.key(x, y));
            return !!n && n.kind === t.kind && n.subtype === t.subtype;
        },
        
        drawTile = t => {
            if (t.kind === TILE_TYPE_SOLID) {
                // In its subtype's colours, if it has them, filling the whole hex so solids of
                // a kind run together: the outline is only on edges that don't meet a solid of
                // the same subtype (sameTerrain). A see-through one is already filled
                // (fillSeeThroughSolids).
                const solid = pkg.solids.get(t.subtype),
                    [cx, cy] = cellCenter(t.x, t.y),
                    inset = 1,
                    pts = pkg.hex.corners(t.x, t.y).map(([wx, wy]) => {
                        const [px, py] = worldToScreen(wx, wy),
                            d = Math.hypot(px - cx, py - cy) || 1;
                        return [px - (px - cx) * inset / d, py - (py - cy) * inset / d];
                    });
                // Half a pixel bigger, so neighbouring fills overlap rather than leave a faint
                // antialiased seam between them.
                if (solidFillAlpha(solid) >= 1) {
                    ctx.beginPath();
                    addCellPath(t.x, t.y, -0.5);
                    ctx.fillStyle = dataColor(solid?.fillColor, '--solid');
                    ctx.fill();
                }
                // Where an edge's neighbour isn't drawn, the corner is an outside corner of
                // the joined shape, and this hex's line and the next hex's stop short of each
                // other (each is inset into its own hex): run the line on past the corner, by
                // the inset, to where it meets the neighbour's line; round caps then join the two.
                const lineWidth = Math.max(1, cam.size * 0.03),
                    ext = inset,
                    edges = pkg.hex.edges,
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
                ctx.strokeStyle = dataColor(solid?.borderColor, '--solid-edge');
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
                    pts = pkg.hex.corners(t.x, t.y).map(([wx, wy]) => worldToScreen(wx, wy)),
                    same = pkg.hex.edges.map(([dx, dy]) => sameTerrain(t, t.x + dx, t.y + dy));
                ctx.lineWidth = 1;
                ctx.strokeStyle = css('--hole-line');
                pts.forEach(([px, py], i) => {
                    const before = same[(i + 5) % 6],
                        after = same[i];
                    if (!(before && after)) {
                        const [hx, hy] = before ? pts[(i + 5) % 6] : after ? pts[(i + 1) % 6] : [cx, cy],
                            choke = before ? !same[(i + 4) % 6] : after && !same[(i + 1) % 6],
                            len = choke ? 0.5 : 1,
                            dx = (hx - px) * len,
                            dy = (hy - py) * len;
                        // From the rim's colour to the hole's, 80% of the way along: drawn over
                        // the hole, fading out.
                        for (let n = 0; n < FADE_STEPS; n++) {
                            const a = 0.8 * n / FADE_STEPS,
                                b = 0.8 * (n + 1) / FADE_STEPS;
                            ctx.globalAlpha = 1 - n / FADE_STEPS;
                            ctx.beginPath();
                            ctx.moveTo(px + dx * a, py + dy * a);
                            ctx.lineTo(px + dx * b, py + dy * b);
                            ctx.stroke();
                        }
                        ctx.globalAlpha = 1;
                    }
                });
            }
        },
        
        // A fixture (Fixtures.js): heal, harm or loot, once it's revealed. Over its tile.
        drawFixture = t => {
            if (t.revealedAt != null) {
                const s = cam.size,
                    [cx, cy] = cellCenter(t.x, t.y),
                    loot = t.type === FIXTURE_LOOT,
                    heal = t.type === FIXTURE_HEAL,
                    ink = css(loot ? '--loot' : heal ? '--heal' : '--harm');
                ctx.beginPath();
                addCellPath(t.x, t.y, 1);
                ctx.fillStyle = css(loot ? '--loot-bg' : heal ? '--heal-bg' : '--harm-bg');
                ctx.fill();
                ctx.fillStyle = ink;
                if (loot) {
                    // A gold coin.
                    const r = s * 0.17;
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.lineWidth = Math.max(1, s * 0.035);
                    ctx.strokeStyle = css('--loot-ink');
                    ctx.beginPath();
                    ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (heal) {
                    // A heart: two lobes meeting at a point below.
                    const w = s * 0.22 * 1.05;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy + w * 0.95);
                    ctx.bezierCurveTo(cx - w * 1.45, cy + w * 0.1, cx - w * 0.95, cy - w * 1.1, cx, cy - w * 0.35);
                    ctx.bezierCurveTo(cx + w * 0.95, cy - w * 1.1, cx + w * 1.45, cy + w * 0.1, cx, cy + w * 0.95);
                    ctx.fill();
                } else {
                    // Harm: a drop of blood, pointed at the top and round below.
                    const arm = s * 0.22,
                        r = arm * 0.68,
                        by = cy + arm * 0.3,
                        tip = cy - arm * 1.1;
                    ctx.beginPath();
                    ctx.moveTo(cx, tip);
                    ctx.bezierCurveTo(cx + r * 0.3, by - r * 1.5, cx + r, by - r * 0.85, cx + r, by);
                    ctx.arc(cx, by, r, 0, Math.PI);
                    ctx.bezierCurveTo(cx - r, by - r * 0.85, cx - r * 0.3, by - r * 1.5, cx, tip);
                    ctx.fill();
                }
                if (s >= 22) drawFixtureLabels(t, cx, cy, s, ink);
            }
        },
        
        /*  A fixture's numbers, in its corners: its magnitude bottom right
            (once shown; all that's left, for a magnitude of the whole pool), what's left in
            it bottom left (with showPool; ∞ for an infinite pool) and, for a countdown, the
            turns left top right. */
        drawFixtureLabels = (t, cx, cy, s, ink) => {
            const [lx, ly] = TILE_LABEL_OFFSET,
                type = game.fixtureType(t),
                turnsLeft = game.turnsLeft(t),
                label = (text, x, y, align, baseline, size) => {
                    ctx.font = `700 ${Math.round(s * size)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = align;
                    ctx.textBaseline = baseline;
                    ctx.fillText(text, x, y);
                };
            ctx.fillStyle = ink;
            if (t.shown) label(String(t.magnitude ?? t.pool), cx + s * lx, cy + s * ly, 'right', 'bottom', 0.22);
            ctx.globalAlpha = 0.75;
            if (type.showPool) label(t.pool == null ? '∞' : String(t.pool), cx - s * lx, cy + s * ly, 'left', 'bottom', 0.18);
            if (turnsLeft != null) label(String(turnsLeft), cx + s * lx, cy - s * ly, 'right', 'top', 0.18);
            ctx.globalAlpha = 1;
        },
        
        // Half the width of a link at the end where `chain` pieces hang below it: wider the
        // longer the chain, up to a limit.
        linkHalfWidth = chain => cam.size * Math.min(0.02 * chain, 0.22),
        
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
        
        // Where a link to piece p ends: how far from its centre, at the outside of its
        // border (see PieceTypes; half a pixel in, so no gap shows), so the link doesn't show
        // through a piece drawn translucent, border and all. (No piece: an ordinary one's.)
        linkEndOf = p => cam.size * (PIECE_R + (p?.id === game.playerCoreId ? CORE_BORDER : 0)) - 0.5,
        
        // Draws a translucent link from `from` to `to` (child -> parent), behind the pieces: a
        // trapezoid along the line between the two cell centres, from piece to piece, each
        // end curved to follow the piece's border it ends in, rFrom and rTo from the centres
        // (see linkEndOf). `chain` is the longest chain of pieces from `from` down, counting
        // `from`: the link widens from that chain's width at `from` (a point for a lone
        // piece) to one more at `to`, so widths match where links meet. `hidden` ('from' or
        // 'to') says an end is out of sight: then only the part nearest the other end is
        // drawn (LINK_STUB), fading out and cut straight, so you can tell a piece is linked
        // to something you can't see, but not quite where.
        drawLink = (from, to, color, chain, hidden, rFrom, rTo) => {
            let [ax, ay] = cellCenter(from.x, from.y),
                [bx, by] = cellCenter(to.x, to.y);
            const len = Math.hypot(bx - ax, by - ay);
            if (len <= rFrom + rTo) return; // (touching, or nearly, as they move)
            // Along the link (from `from`), and across it
            const ux = (bx - ax) / len, uy = (by - ay) / len,
                px = -uy, py = ux;
            let w0 = linkHalfWidth(chain - 1),
                w1 = linkHalfWidth(chain),
                fill = css(color);
            // A stub is as wide all along as the link at its parent's end (else a lone
            // piece's would be a sliver too thin to see), and fades from the piece's edge,
            // where it shows, not its centre, under it.
            if (hidden === 'to') {
                bx = ax + (bx - ax) * LINK_STUB;
                by = ay + (by - ay) * LINK_STUB;
                w0 = w1;
                rTo = 0;
                fill = ctx.createLinearGradient(ax + ux * rFrom, ay + uy * rFrom, bx, by);
            } else if (hidden === 'from') {
                ax = bx + (ax - bx) * LINK_STUB;
                ay = by + (ay - by) * LINK_STUB;
                w0 = w1;
                rFrom = 0;
                fill = ctx.createLinearGradient(bx - ux * rTo, by - uy * rTo, ax, ay);
            }
            if (hidden) {
                fill.addColorStop(0, css(color));
                fill.addColorStop(1, clearOf(css(color)));
            }
            // Where a side of the link (across: 1 or -1) meets the end at (cx, cy), r from
            // it, toward the other end (toward: 1 along the link, -1 back); cut straight if r
            // is 0. The sides are kept inside the piece.
            const w = (half, r) => r ? Math.min(half, r * 0.9) : half;
            w0 = w(w0, rFrom);
            w1 = w(w1, rTo);
            const side = (cx, cy, r, half, across, toward) => {
                    const along = r ? toward * Math.sqrt(r * r - half * half) : 0;
                    return [cx + ux * along + px * half * across, cy + uy * along + py * half * across];
                },
                // An arc of the end at (cx, cy), r from it, from point a to point b, the short way
                arc = (cx, cy, r, [x0, y0], [x1, y1]) => {
                    const a0 = Math.atan2(y0 - cy, x0 - cx),
                        a1 = Math.atan2(y1 - cy, x1 - cx),
                        turn = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
                    ctx.arc(cx, cy, r, a0, a1, turn < 0);
                },
                a1 = side(ax, ay, rFrom, w0, 1, 1),
                a2 = side(ax, ay, rFrom, w0, -1, 1),
                b1 = side(bx, by, rTo, w1, 1, -1),
                b2 = side(bx, by, rTo, w1, -1, -1);
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(...a1);
            ctx.lineTo(...b1);
            if (rTo) arc(bx, by, rTo, b1, b2); else ctx.lineTo(...b2);
            ctx.lineTo(...a2);
            if (rFrom) arc(ax, ay, rFrom, a2, a1);
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
        
        // Your core is bigger, so its bars sit lower, clear of its selection ring. Under
        // the HP bar (red), a thinner one for the piece's action points (white), out of its
        // pool, with a tick at each whole point.
        drawBars = (p, cx, cy, s) => {
            const w = s * 0.56,
                h = Math.max(3, s * 0.06),
                x = cx - w / 2,
                y = cy + s * (0.37 + (p.id === game.playerCoreId ? CORE_BORDER : 0)),
                bar = (by, bh, frac, color) => {
                    ctx.fillStyle = css('--grid');
                    ctx.fillRect(x, by, w, bh);
                    ctx.fillStyle = css(color);
                    ctx.fillRect(x, by, w * Math.min(1, Math.max(0, frac)), bh);
                };
            if (p.maxHp > 1) bar(y, h, p.hp / p.maxHp, '--hp-bar');
            const pool = game.apMax(p);
            if (pool > 0) {
                const ay = y + h + 1,
                    ah = Math.max(2, h * 0.5);
                bar(ay, ah, p.ap / pool, '--ap-bar');
                ctx.fillStyle = css('--bg');
                for (let k = pkg.AP_UNIT; k < pool; k += pkg.AP_UNIT) ctx.fillRect(x + w * k / pool - 0.5, ay, 1, ah);
            }
        };
    
    /*  Draws a frame: floor and fog, quadrant tint, tiles, grid lines, highlights, the golden
        path, links, pieces and effects. */
    V.render = (now) => {
        V.rafPending = false;
        const panning = V.stepPan(now);
        ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
        const {W , H}= V,
            s = cam.size,
            [x0, y0] = screenToWorld(0, 0),
            [x1, y1] = screenToWorld(W, H),
            visible = [...pkg.hex.visibleCells(x0, y0, x1, y1)],
            
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
        
        // Visited quadrants, with a tile generator that has them
        const {visitedQuads:visited, quads} = game.tileGenerator;
        if (visited) fillCells(known.filter(c => visited.has(quads.key(c.x, c.y))), '--visited');
        
        // Solid and hole tiles
        const tilesShown = [...game.tiles.values()].filter(t => inView(t.x, t.y) && isKnown(t.x, t.y));
        if (SHADOW.on) drawSolidShadows(tilesShown, sight ? known : null);
        fillSeeThroughSolids(tilesShown);
        for (const t of tilesShown) drawTile(t);
        if (SHADOW.on) drawHoleShadows(tilesShown);
        
        // Heals, harms and loot (fixtures), over their tiles
        for (const f of game.fixtures.values()) if (inView(f.x, f.y) && isKnown(f.x, f.y)) drawFixture(f);
        
        // The area of the heal, harm or loot under the pointer, if it reaches past it.
        const hoverFixture = V.hover && game.fixtureAt(V.hover.x, V.hover.y);
        if (hoverFixture && game.fixtureType(hoverFixture).area.radius > 0) {
            strokeRegion(hoverFixture, game.fixtureType(hoverFixture).area.radius, '--' + hoverFixture.type);
        }
        
        // Grid lines: the same everywhere (quadrants show only as the visited tint), and
        // none between solids or holes of the same subtype, which run together.
        ctx.lineWidth = 1;
        // each hex draws its NE, E and SE edges, so every edge is drawn once; only edges
        // touching a known cell. One path on the context, not a Path2D: like gradients, a
        // Path2D made every frame holds native memory until a GC, which comes rarely.
        ctx.beginPath();
        for (const c of visible) {
            const cKnown = isKnown(c.x, c.y),
                tile = game.tiles.get(game.key(c.x, c.y));
            let cs = null;
            for (let e = 0; e < 3; e++) {
                const [dx, dy, a, b] = pkg.hex.edges[e];
                if ((cKnown || isKnown(c.x + dx, c.y + dy)) && !(tile && sameTerrain(tile, c.x + dx, c.y + dy))) {
                    cs ??= pkg.hex.corners(c.x, c.y);
                    const [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                    ctx.moveTo(ax, ay);
                    ctx.lineTo(bx, by);
                }
            }
        }
        ctx.strokeStyle = css('--grid');
        ctx.stroke();
        
        const sel = game.getSelected();
        let selGroupIds = new Set(),
            ghost = null,
            linkTargets = new Set();
        
        if (V.placeMode && sel) {
            // The cells next to the selected piece a piece could be placed on.
            for (const q of game.placeCells(sel)) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--place-hover' : '--place');
        } else if (V.jumpMode && sel) {
            // The cells the selected piece can jump to.
            fillCell(sel.x, sel.y, '--sel-bg');
            for (const q of game.jumpTargets(sel)) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--move-hover' : '--move');
            if (V.jumpAt(sel, V.hover)) ghost = [[sel.id, V.hover.x, V.hover.y]];
        } else if ((V.attachMode || V.swapMode) && sel) {
            // The pieces the selected one can attach to, or swap with.
            fillCell(sel.x, sel.y, '--sel-bg');
            for (const p of V.attachMode ? game.attachTargets(sel) : game.swapTargets(sel)) linkTargets.add(p.id);
            const q = V.swapMode && V.swapAt(sel, V.hover);
            if (q) ghost = [[sel.id, q.x, q.y], [q.id, sel.x, sel.y]];
        } else if (sel) {
            // Link-range box around the selected piece's parent
            const par = game.parent(sel);
            if (par) strokeRegion(par, game.rules.linkRange, '--range');
            
            // Fill the hex around selected (and descendant of selected) player pieces.
            const group = game.group(sel);
            selGroupIds = new Set(group.map(g => g.id));
            for (const g of group) {
                fillCell(g.x, g.y, sel.id === g.id ? '--sel-bg' : '--sel-tint');
            }
            
            let hoverHits = null, hoverMove = null;
            for (const m of V.clickMoves(sel)) {
                const isHover = sameCell(V.hover, m);
                fillCell(m.x, m.y, m.attack ? (isHover ? '--attack-hover' : '--attack') : (isHover ? '--move-hover' : '--move'));
                if (isHover && !m.attack) {
                    hoverMove = m;
                    if (group.length > 1) ghost = m.moves; // where each piece that moves would go
                }
                if (isHover && m.attack) hoverHits = m.hits;
            }
            // With Alt held, the pieces it can swap with (an Alt-click swaps), and over one,
            // the two as ghosts in each other's cells.
            if (V.alt) {
                for (const q of game.swapTargets(sel)) fillCell(q.x, q.y, sameCell(V.hover, q) ? '--move-hover' : '--move');
                const q = V.swapAt(sel, V.hover);
                if (q) ghost = [[sel.id, q.x, q.y], [q.id, sel.x, sel.y]];
            }
            // Over a cell it can jump to (a click jumps): that, and its ghost there.
            const jump = !hoverMove && !hoverHits && V.jumpAt(sel, V.hover);
            if (jump) {
                fillCell(jump.x, jump.y, '--move-hover');
                hoverMove = {moves:[[sel.id, jump.x, jump.y]]};
                ghost = hoverMove.moves;
            }
            // Where the hovered move lands: harm cells go red, heal cells bright green, loot gold
            if (hoverMove) for (const [, x, y] of hoverMove.moves) {
                const type = game.fixtureAt(x, y)?.type;
                if (type) fillCell(x, y, '--' + type + '-hover');
            }
            // Show every enemy a group attack would hit
            if (hoverHits) for (const h of hoverHits) if (!sameCell(h.target, V.hover)) fillCell(h.target.x, h.target.y, '--attack-hover');
        }
        
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
        
        // The golden path: a trail of small dots along the core's latest steps, kept
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
                if (a.seen || b.seen) drawLink(a, b, '--enemy-link', chain(p), a.seen ? (b.seen ? null : 'to') : 'from', linkEndOf(p), linkEndOf(par));
            }
        }
        for (const p of game.piecesOf('player')) {
            const par = game.parent(p);
            if (par) drawLink(placeOf(p), placeOf(par), selGroupIds.has(p.id) && p.id !== game.selectedId ? '--sel-link' : '--link', chain(p), null, linkEndOf(p), linkEndOf(par));
        }
        // The link a piece placed on the hovered cell would have
        if (V.placeMode && sel && V.hover && game.placeCells(sel).some(q => sameCell(q, V.hover))) {
            drawLink(V.hover, sel, '--place-ink', 1, null, linkEndOf(null), linkEndOf(sel));
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
                const age = (now - f.t0) / pkg.animMs(ANIM.BUMP_MS);
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
                spent: p.owner === 'player' && !game.canMove(p),
            });
            ctx.restore();
            
            const fl = flashAt.get(game.key(p.x, p.y));
            if (fl) {
                ctx.globalAlpha = fl * 0.7; ctx.fillStyle = css('--dmg');
                ctx.beginPath(); ctx.arc(sx, sy, s * (PIECE_R + (p.id === game.playerCoreId ? CORE_BORDER : 0)), 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (s >= 22) drawBars(p, sx, sy, s);
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
        
        // Off-screen indicators: an arrow at the edge of the board, pointing (from the
        // middle) at what's off it. Red, and smaller, for each enemy squad you can see none
        // of on the board, at its leader (or, if you can't see that, a piece of it you
        // can); gold for your core, over them.
        const pad = 22,
            offBoard = (sx, sy) => sx < 0 || sx > W || sy < 0 || sy > H,
            edgeArrow = (sx, sy, color, size) => {
                const ax = Math.min(W - pad, Math.max(pad, sx)), ay = Math.min(H - pad, Math.max(pad, sy));
                ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(sy - H / 2, sx - W / 2)); ctx.scale(size, size);
                ctx.fillStyle = css(color);
                ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
                ctx.restore();
            };
        for (const leader of game.piecesOf('enemy').filter(e => !game.parent(e))) {
            const seen = game.group(leader).filter(e => game.inSight(e.x, e.y)).map(e => [e, cellCenter(e.x, e.y)]);
            if (seen.length && seen.every(([, [sx, sy]]) => offBoard(sx, sy))) {
                edgeArrow(...(seen.find(([e]) => e === leader) ?? seen[0])[1], '--enemy-arrow', ENEMY_ARROW_SIZE);
            }
        }
        const core = game.getPlayerCore();
        if (core) {
            const [sx, sy] = cellCenter(core.x, core.y);
            if (offBoard(sx, sy)) edgeArrow(sx, sy, '--core', 1);
        }
        
        game.effects = game.effects.filter(f => now - f.t0 < FX_MS);
        if (game.effects.length || game.motions.length || panning) draw();
        
        // Update HUD
        pkg.app?.update();
    };
})(hc);
