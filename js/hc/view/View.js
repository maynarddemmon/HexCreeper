/*  Shared view state (pkg.view): the canvas and camera, the game being shown, the
    current input mode, and helpers for drawing cells in either grid shape. */
(pkg => {
    'use strict';
    
    const V = pkg.view = {};
    
    // ---------------------------------------------------------------------------
    // Rendering & camera
    // ---------------------------------------------------------------------------
    // The canvas is made here and placed into the page by GameView.
    const canvas = document.createElement('canvas');
    canvas.className = 'hc-canvas';
    const ctx = canvas.getContext('2d'),
        game = new pkg.Game(),
        
        cam = {x:0.5, y:0.5, size:56}, // world coords at screen center; px per cell
        MIN_SIZE = 12,
        MAX_SIZE = 140,
        FX_MS = 650;
    
    V.hover = null;
    V.dpr = 1;
    V.W = 1;   // the canvas size in CSS pixels; see resize
    V.H = 1;
    
    // Place mode: null, {stage:"square"}, or {stage:"link", x, y}
    V.placeMode = null;
    V.healMode = false; // choosing which piece a paid heal starts from
    
    const cssCache = {};
    function css(name) {
        if (!(name in cssCache)) cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return cssCache[name];
    }

    // Matches the canvas's backing store to its size on the page.
    function resize() {
        const r = canvas.getBoundingClientRect();
        V.W = Math.max(1, r.width);
        V.H = Math.max(1, r.height);
        V.dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(V.W * V.dpr);
        canvas.height = Math.round(V.H * V.dpr);
        draw();
    }
    
    // A pointer event's position on the canvas.
    function eventPos(e) {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    function worldToScreen(wx, wy) {
        return [(wx - cam.x) * cam.size + V.W / 2, (wy - cam.y) * cam.size + V.H / 2];
    }
    function screenToWorld(sx, sy) {
        return [(sx - V.W / 2) / cam.size + cam.x, (sy - V.H / 2) / cam.size + cam.y];
    }
    function cellAt(sx, sy) {
        const [wx, wy] = screenToWorld(sx, sy);
        return pkg.GRID.cellAtWorld(wx, wy);
    }
    // Screen position of a cell's centre.
    function cellCenter(x, y) { const [wx, wy] = pkg.GRID.center(x, y); return worldToScreen(wx, wy); }
    // Is the cell's centre on (or near) the screen?
    function inView(x, y, margin = cam.size) {
        const [sx, sy] = cellCenter(x, y);
        return sx > -margin && sx < V.W + margin && sy > -margin && sy < V.H + margin;
    }
    // Append a cell's outline to the current path, shrunk toward its centre by
    // `insetPx` pixels (or scaled by `scale` if given).
    function addCellPath(x, y, insetPx = 0, scale = null) {
        const [cx, cy] = cellCenter(x, y);
        const pts = pkg.GRID.corners(x, y).map(([wx, wy]) => worldToScreen(wx, wy));
        const rad = Math.hypot(pts[0][0] - cx, pts[0][1] - cy) || 1;
        const f = scale != null ? scale : Math.max(0, 1 - insetPx / rad);
        pts.forEach(([px, py], i) => {
            const X = cx + (px - cx) * f, Y = cy + (py - cy) * f;
            if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        });
        ctx.closePath();
    }
    function strokeCell(x, y, color, width, insetPx = 2, dash = null) {
        ctx.beginPath(); addCellPath(x, y, insetPx);
        ctx.strokeStyle = typeof color === 'string' && color.startsWith('--') ? css(color) : color;
        ctx.lineWidth = width;
        if (dash) ctx.setLineDash(dash);
        ctx.stroke();
        if (dash) ctx.setLineDash([]);
    }
    // Outline the region of cells within `range` steps of `c` (link range).
    function strokeRegion(c, range, color) {
        const inR = new Set(), cells = [], q = [[c.x, c.y, 0]];
        inR.add(c.x + ',' + c.y);
        for (let i = 0; i < q.length; i++) {
            const [x, y, d] = q[i]; cells.push([x, y]);
            if (d >= range) continue;
            for (const [dx, dy] of pkg.GRID.dirs) {
                const k = (x + dx) + ',' + (y + dy);
                if (!inR.has(k)) { inR.add(k); q.push([x + dx, y + dy, d + 1]); }
            }
        }
        ctx.beginPath();
        for (const [x, y] of cells) {
            const cs = pkg.GRID.corners(x, y);
            for (const [dx, dy, a, b] of pkg.GRID.edges) {
                if (inR.has((x + dx) + ',' + (y + dy))) continue;
                const [ax, ay] = worldToScreen(...cs[a]), [bx, by] = worldToScreen(...cs[b]);
                ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
            }
        }
        ctx.strokeStyle = css(color); ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
        ctx.stroke(); ctx.setLineDash([]);
    }
    const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y;

    V.rafPending = false;
    function draw() {
        if (V.rafPending) return;
        V.rafPending = true;
        requestAnimationFrame(now => V.render(now));
    }

    function fillCell(x, y, color) {
        ctx.beginPath(); addCellPath(x, y, 1);
        ctx.fillStyle = css(color);
        ctx.fill();
    }
    
    Object.assign(V, {eventPos, canvas, ctx, game, cam, MIN_SIZE, MAX_SIZE, FX_MS, css, resize, worldToScreen, screenToWorld, cellAt, cellCenter, inView, addCellPath, strokeCell, strokeRegion, sameCell, draw, fillCell});
})(hc);
