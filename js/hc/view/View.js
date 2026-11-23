/*  Shared view state (pkg.view): the canvas and camera, the game being shown, the
    current input mode, and helpers for drawing cells in either grid shape. */
(pkg => {
    'use strict';
    
    const {min:mathMin, max:mathMax, round:mathRound, hypot:mathHypot} = Math,
        
        // The canvas is made here and placed into the page by GameView.
        canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d'),
        cam = {
            x:0.5,
            y:0.5, // world coords at screen center
            size:56 // px per cell
        },
        
        cssCache = {},
        css = name => {
            if (!(name in cssCache)) cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return cssCache[name];
        },
        
        draw = () => {
            if (!V.rafPending) {
                V.rafPending = true;
                requestAnimationFrame(now => V.render(now));
            }
        },
        
        /*  An animated pan of the camera, or null: {fromX, fromY, toX, toY, t0}. */
        pan = {current:null},
        
        /*  Moves the camera's centre to world point (x, y), animated over PAN_MS unless
            animate is false. */
        panTo = (x, y, animate = true) => {
            if (animate) {
                pan.current = {fromX:cam.x, fromY:cam.y, toX:x, toY:y, t0:performance.now()};
            } else {
                pan.current = null;
                cam.x = x;
                cam.y = y;
            }
            draw();
        },
        
        /*  Steps the camera's pan to time now. Returns true while it's still going. */
        stepPan = now => {
            const p = pan.current;
            if (!p) return false;
            const t = mathMin(1, mathMax(0, (now - p.t0) / pkg.cfg.PAN_MS)),
                ease = 1 - (1 - t) ** 3; // fast, then settling
            cam.x = p.fromX + (p.toX - p.fromX) * ease;
            cam.y = p.fromY + (p.toY - p.fromY) * ease;
            if (t >= 1) pan.current = null;
            return t < 1;
        },
        
        worldToScreen = (wx, wy) => {
            return [
                (wx - cam.x) * cam.size + V.W / 2,
                (wy - cam.y) * cam.size + V.H / 2
            ];
        },
        
        screenToWorld = (sx, sy) => {
            return [
                (sx - V.W / 2) / cam.size + cam.x,
                (sy - V.H / 2) / cam.size + cam.y
            ];
        },
        
        // Screen position of a cell's centre.
        cellCenter = (x, y) => {
            const [wx, wy] = pkg.hex.center(x, y);
            return worldToScreen(wx, wy);
        },
        
        // Append a cell's outline to the current path, shrunk toward its center by
        // `insetPx` pixels (or scaled by `scale` if given).
        addCellPath = (x, y, insetPx = 0, scale = null) => {
            const [cx, cy] = cellCenter(x, y),
                pts = pkg.hex.corners(x, y).map(([wx, wy]) => worldToScreen(wx, wy)),
                rad = mathHypot(pts[0][0] - cx, pts[0][1] - cy) || 1,
                f = scale != null ? scale : mathMax(0, 1 - insetPx / rad);
            pts.forEach(([px, py], i) => {
                const X = cx + (px - cx) * f,
                    Y = cy + (py - cy) * f;
                if (i === 0) {
                    ctx.moveTo(X, Y);
                } else {
                    ctx.lineTo(X, Y);
                }
            });
            ctx.closePath();
        },
        
        V = pkg.view = {
            game:new pkg.Game(),
            canvas,
            ctx,
            cam,
            hover:null,
            dpr:1,
            W:1, // the canvas size in CSS pixels.
            H:1,
            placeMode:false, // choosing the cell to place a piece on, next to the selected piece
            menuOpen:false, // whether the selected piece's menu is open
            attachMode:false, // choosing which piece to attach the selected piece to
            swapMode:false, // choosing which piece the selected piece swaps with
            jumpMode:false, // choosing the cell the selected piece jumps to
            gotoMode:false, // choosing the cell the selected piece goes to (see App: Go to)
            shift:false, // whether Shift is held: a click moves in the other mode (clickMoves)
            rafPending:false,
            css,
            draw,
            panTo,
            stepPan,
            
            /*  The moves a click can make for piece p: in your mode; or, with Shift held (or
                shift true), in the other one (Free, or Fixed if you're in Free), and where that
                can't go, in yours. As legalMoves gives them. */
            clickMoves: (p, shift=V.shift) => {
                const game = V.game,
                    mine = game.legalMoves(p);
                if (!shift) return mine;
                const other = game.legalMoves(p, game.modeFor(p) === 'free' ? 'fixed' : 'free');
                return [...other, ...mine.filter(m => !other.some(o => o.x === m.x && o.y === m.y))];
            },
            
            /*  Where the camera is headed: the end of the pan under way, or where it is. */
            camTarget: () => pan.current ? [pan.current.toX, pan.current.toY] : [cam.x, cam.y],
            
            /*  Stops a pan where it is, e.g. when the player drags or zooms. */
            stopPan: () => {pan.current = null;},
            worldToScreen,
            screenToWorld,
            cellCenter,
            addCellPath,
            
            // Is the cell's centre on (or near) the screen?
            inView: (x, y, margin = cam.size) => {
                const [sx, sy] = cellCenter(x, y);
                return sx > -margin && sx < V.W + margin && sy > -margin && sy < V.H + margin;
            },
            
            cellAt: (sx, sy) => {
                const [wx, wy] = screenToWorld(sx, sy);
                return pkg.hex.cellAtWorld(wx, wy);
            },
            
            // A pointer event's position on the canvas.
            eventPos: e => {
                const r = canvas.getBoundingClientRect();
                return [e.clientX - r.left, e.clientY - r.top];
            },
            
            // Matches the canvas's backing store to its size on the page.
            resize: () => {
                const r = canvas.getBoundingClientRect();
                V.W = mathMax(1, r.width);
                V.H = mathMax(1, r.height);
                V.dpr = window.devicePixelRatio || 1;
                canvas.width = mathRound(V.W * V.dpr);
                canvas.height = mathRound(V.H * V.dpr);
                draw();
            },
            
            strokeCell: (x, y, color, width, insetPx=2, dash=null) => {
                ctx.beginPath();
                addCellPath(x, y, insetPx);
                ctx.strokeStyle = typeof color === 'string' && color.startsWith('--') ? css(color) : color;
                ctx.lineWidth = width;
                if (dash) ctx.setLineDash(dash);
                ctx.stroke();
                if (dash) ctx.setLineDash([]);
            },
            
            // Outline the region of cells within `range` steps of `c` (link range).
            strokeRegion: (c, range, color) => {
                const inR = new Set(), cells = [], q = [[c.x, c.y, 0]];
                inR.add(c.x + ',' + c.y);
                for (let i = 0; i < q.length; i++) {
                    const [x, y, d] = q[i]; cells.push([x, y]);
                    if (d >= range) continue;
                    for (const [dx, dy] of pkg.hex.dirs) {
                        const k = (x + dx) + ',' + (y + dy);
                        if (!inR.has(k)) { inR.add(k); q.push([x + dx, y + dy, d + 1]); }
                    }
                }
                ctx.beginPath();
                for (const [x, y] of cells) {
                    const cs = pkg.hex.corners(x, y);
                    for (const [dx, dy, a, b] of pkg.hex.edges) {
                        if (inR.has((x + dx) + ',' + (y + dy))) continue;
                        const [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
                    }
                }
                ctx.strokeStyle = css(color); ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
                ctx.stroke(); ctx.setLineDash([]);
            },
            
            sameCell: (a, b) => a && b && a.x === b.x && a.y === b.y,
            
            fillCell: (x, y, color) => {
                ctx.beginPath();
                addCellPath(x, y, 1);
                ctx.fillStyle = css(color);
                ctx.fill();
            }
        };
    
    canvas.className = 'hc-canvas';
})(hc);
