/*  Grid geometry: square and hex grids behind one interface (pkg.GRID). The game
    rules only use GRID.dirs and cheb(), so everything shape-specific lives here. */
(pkg => {
    'use strict';
    
    const {
            PI,
            sqrt:mathSqrt, abs:mathAbs, round:mathRound, floor:mathFloor, ceil:mathCeil, 
            min:mathMin, max:mathMax,
            sin:mathSin, cos:mathCos,
            random:mathRandom
        } = Math,
        
        SQRT3 = mathSqrt(3),
        HALF_SQRT3 = SQRT3 / 2,
        INV_SQRT3 = 1 / SQRT3,
        PI_OVER_180 = PI / 180,
        
        {
            cfg:{GRIDCFG, QUAD},
            DIRS_8
        } = pkg;
    
    // ---------------------------------------------------------------------------
    // Grid geometry. Everything that depends on the cell shape lives here; the
    // game rules only use pkg.GRID.dirs (neighbour offsets) and pkg.GRID.dist.
    //   Square: (x, y) cells, 8 neighbours (king moves), Chebyshev distance,
    //           quadrants of QUAD.size x QUAD.size offset so (0,0) is a centre.
    //   Hex:    axial (q, r) cells stored as (x, y), pointy-top, 6 neighbours,
    //           hex distance; "quadrants" are hexagonal chunks of radius k
    //           (3k^2+3k+1 cells) that tile the plane, each with 6 neighbours.
    // World units: one cell is 1 unit across (square side / hex flat-to-flat).
    // ---------------------------------------------------------------------------
    const KEY_DIRS_SQUARE = {
            q: [-1, -1], w: [0, -1], e: [1, -1],
            a: [-1, 0],              d: [1, 0],
            z: [-1, 1],  x: [0, 1],  c: [1, 1],
            s: [0, 1],
            ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
            Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1],
            Numpad4: [-1, 0],                    Numpad6: [1, 0],
            Numpad1: [-1, 1],  Numpad2: [0, 1],  Numpad3: [1, 1],
        },
        
        // Pointy-top hexes: NW, NE, W, E, SW, SE
        KEY_DIRS_HEX = {
            q: [0, -1], e: [1, -1],
            a: [-1, 0], d: [1, 0],
            z: [-1, 1], c: [0, 1],
            ArrowLeft: [-1, 0], ArrowRight: [1, 0],
            Numpad7: [0, -1], Numpad9: [1, -1],
            Numpad4: [-1, 0], Numpad6: [1, 0],
            Numpad1: [-1, 1], Numpad3: [0, 1],
        };
    
    function makeSquareGrid(S) {
        const O = mathFloor(S / 2),
            chunkOf = (x, y) => [mathFloor((x + O) / S), mathFloor((y + O) / S)];
        return {
            kind:'square',
            dirs:DIRS_8,
            keyDirs:KEY_DIRS_SQUARE,
            chunkSize:S,
            chunkOffset:O,
            chunkNeighbourCount:8,
            labelOffset:[0.42, 0.46],
            dist: (a, b) => mathMax(mathAbs(a.x - b.x), mathAbs(a.y - b.y)),
            center: (x, y) => [x + 0.5, y + 0.5],
            cellAtWorld: (wx, wy) => ({x:mathFloor(wx), y:mathFloor(wy)}),
            corners: (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]],
            edges: [[0, -1, 0, 1], [1, 0, 1, 2], [0, 1, 2, 3], [-1, 0, 3, 0]], // [dx, dy, cornerA, cornerB]
            chunkOf,
            chunkKey(x, y) {
                const [i, j] = chunkOf(x, y);
                return i + ',' + j;
            },
            chunkNeighbours(i, j) {
                const out = [];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push([i + dx, j + dy]);
                return out;
            },
            chunkCells(i, j) {
                const out = [], ox = i * S - O, oy = j * S - O;
                for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) out.push({ x: ox + x, y: oy + y });
                return out;
            },
            // A random cell exactly d steps from (cx, cy).
            ring(cx, cy, d) {
                const side = mathFloor(mathRandom() * 4);
                const t = mathFloor(mathRandom() * (2 * d + 1)) - d;
                const [dx, dy] = [[t, -d], [d, t], [t, d], [-d, t]][side];
                return { x: cx + dx, y: cy + dy };
            },
            *visibleCells(wx0, wy0, wx1, wy1) {
                for (let y = mathFloor(wy0) - 1; y <= mathCeil(wy1); y++)
                    for (let x = mathFloor(wx0) - 1; x <= mathCeil(wx1); x++) yield { x, y };
            },
        };
    }
    
    function makeHexGrid(k) {
        // neighbour order matches edge order: edge i joins corner i and i+1
        const dirs = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
        const R = INV_SQRT3; // circumradius when flat-to-flat = 1
        const cornerOff = [0, 1, 2, 3, 4, 5].map(i => {
            const a = (-90 + 60 * i) * PI_OVER_180;
            return [R * mathCos(a), R * mathSin(a)];
        });
        const hexDist = (dq, dr) => (mathAbs(dq) + mathAbs(dr) + mathAbs(dq + dr)) / 2;
        // Chunk lattice: hexagons of radius k tile the plane with these basis vectors.
        const A = [2 * k + 1, -k], B = [k, k + 1], det = 3 * k * k + 3 * k + 1;
        const chunkCenter = (i, j) => [i * A[0] + j * B[0], i * A[1] + j * B[1]];
        const chunkOf = (q, r) => {
            const fi = ((k + 1) * q - k * r) / det, fj = (k * q + (2 * k + 1) * r) / det;
            const i0 = mathRound(fi), j0 = mathRound(fj);
            let best = null,
                bd = Infinity;
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
                const [cq, cr] = chunkCenter(i0 + di, j0 + dj);
                const d = hexDist(q - cq, r - cr);
                if (d < bd) { bd = d; best = [i0 + di, j0 + dj]; }
            }
            return best;
        };
        return {
            kind: 'hex', dirs, keyDirs: KEY_DIRS_HEX, chunkRadius: k,
            chunkNeighbourCount: 6, labelOffset: [0.3, 0.32],
            dist: (a, b) => hexDist(a.x - b.x, a.y - b.y),
            center: (q, r) => [q + r / 2, r * HALF_SQRT3],
            cellAtWorld(wx, wy) {
                const r = wy / HALF_SQRT3, q = wx - r / 2;
                let rx = mathRound(q), rz = mathRound(r), ry = mathRound(-q - r);
                const dx = mathAbs(rx - q), dz = mathAbs(rz - r), dy = mathAbs(ry - (-q - r));
                if (dx > dy && dx > dz) rx = -ry - rz;
                else if (dz > dy) rz = -rx - ry;
                return {x:rx, y:rz};
            },
            corners(q, r) { const cx = q + r / 2, cy = r * HALF_SQRT3; return cornerOff.map(([ox, oy]) => [cx + ox, cy + oy]); },
            edges: dirs.map(([dx, dy], i) => [dx, dy, i, (i + 1) % 6]),
            chunkOf,
            chunkKey(q, r) { const [i, j] = chunkOf(q, r); return i + ',' + j; },
            chunkNeighbours: (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1], [i + 1, j - 1], [i - 1, j + 1]],
            chunkCells(i, j) {
                const [cq, cr] = chunkCenter(i, j), out = [];
                for (let dq = -k; dq <= k; dq++)
                    for (let dr = mathMax(-k, -dq - k); dr <= mathMin(k, -dq + k); dr++) out.push({ x: cq + dq, y: cr + dr });
                return out;
            },
            ring(cq, cr, d) {
                // pick a random cell on the ring of radius d: start d steps toward SW,
                // then walk the six sides (d steps each) in a fixed rotation
                const rb = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
                const idx = mathFloor(mathRandom() * 6 * d), side = mathFloor(idx / d), step = idx % d;
                let q = cq + rb[4][0] * d, r = cr + rb[4][1] * d;
                for (let i = 0; i < side; i++) { q += rb[i][0] * d; r += rb[i][1] * d; }
                return { x: q + rb[side][0] * step, y: r + rb[side][1] * step };
            },
            *visibleCells(wx0, wy0, wx1, wy1) {
                const h = HALF_SQRT3;
                for (let r = mathFloor(wy0 / h) - 1; r <= mathCeil(wy1 / h) + 1; r++)
                    for (let q = mathFloor(wx0 - r / 2) - 1; q <= mathCeil(wx1 - r / 2) + 1; q++) yield { x: q, y: r };
            },
        };
    }
    
    pkg.GRID = makeSquareGrid(5); // replaced by Game.reset
    function makeGrid() {
        return GRIDCFG.hex ? makeHexGrid(GRIDCFG.hexRadius) : makeSquareGrid(QUAD.size);
    }
    
    
    // Grid distance (Chebyshev on squares, hex distance on hexes) and straight-line distance².
    function cheb(a, b) {return pkg.GRID.dist(a, b);}
    function euclid2(a, b) {
        const [ax, ay] = pkg.GRID.center(a.x, a.y), [bx, by] = pkg.GRID.center(b.x, b.y);
        return (ax - bx) ** 2 + (ay - by) ** 2;
    }
    
    Object.assign(pkg, {
        KEY_DIRS_SQUARE, KEY_DIRS_HEX, makeSquareGrid, makeHexGrid, makeGrid, 
        cheb, 
        euclid2
    });
})(hc);
