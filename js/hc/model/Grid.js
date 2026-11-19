/*  Hex grid geometry (pkg.GRID). The game rules only use GRID.dirs and hexDist(),
    so everything shape-specific lives here. */
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
            cfg:{QUAD}
        } = pkg,
        
        // Keys for the six directions: NW, NE, W, E, SW, SE
        KEY_DIRS = {
            q: [0, -1], e: [1, -1],
            a: [-1, 0], d: [1, 0],
            z: [-1, 1], c: [0, 1],
            ArrowLeft: [-1, 0], ArrowRight: [1, 0],
            Numpad7: [0, -1], Numpad9: [1, -1],
            Numpad4: [-1, 0], Numpad6: [1, 0],
            Numpad1: [-1, 1], Numpad3: [0, 1],
        },
        
        // Hex grid geometry: axial (q, r) cells stored as (x, y), pointy-top, 6
        // neighbours, hex distance. Quadrants are hexagonal chunks of radius k
        // (3k^2+3k+1 cells) that tile the plane, each with 6 neighbours.
        // World units: one cell is 1 unit across (flat-to-flat).
        makeGrid = pkg.makeGrid = k => {
            // neighbour order matches edge order: edge i joins corner i and i+1
            const dirs = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]],
                R = INV_SQRT3, // circumradius when flat-to-flat = 1
                cornerOff = [0, 1, 2, 3, 4, 5].map(i => {
                    const a = (-90 + 60 * i) * PI_OVER_180;
                    return [R * mathCos(a), R * mathSin(a)];
                }),
                hexDist = (dq, dr) => (mathAbs(dq) + mathAbs(dr) + mathAbs(dq + dr)) / 2,
                // The cell holding fractional axial coordinates (q, r).
                cubeRound = (q, r) => {
                    let rx = mathRound(q), rz = mathRound(r), ry = mathRound(-q - r);
                    const dx = mathAbs(rx - q), dz = mathAbs(rz - r), dy = mathAbs(ry - (-q - r));
                    if (dx > dy && dx > dz) rx = -ry - rz;
                    else if (dz > dy) rz = -rx - ry;
                    return {x:rx, y:rz};
                },
                // Cells within n steps of (cq, cr).
                disk = (cq, cr, n) => {
                    const out = [];
                    for (let dq = -n; dq <= n; dq++)
                        for (let dr = mathMax(-n, -dq - n); dr <= mathMin(n, -dq + n); dr++) out.push({ x: cq + dq, y: cr + dr });
                    return out;
                },
                // Chunk lattice: hexagons of radius k tile the plane with these basis vectors.
                A = [2 * k + 1, -k], B = [k, k + 1], det = 3 * k * k + 3 * k + 1,
                chunkCenter = (i, j) => [i * A[0] + j * B[0], i * A[1] + j * B[1]],
                chunkOf = (q, r) => {
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
                dirs,
                keyDirs:KEY_DIRS,
                chunkRadius:k,
                dist: (a, b) => hexDist(a.x - b.x, a.y - b.y),
                center: (q, r) => [q + r / 2, r * HALF_SQRT3],
                cellAtWorld(wx, wy) {
                    const r = wy / HALF_SQRT3;
                    return cubeRound(wx - r / 2, r);
                },
                disk,
                // The cells a straight line from cell a to cell b passes through, a and b
                // included. A line running exactly along an edge between two cells touches
                // both: nudge (1 or -1) picks which side it is counted on.
                line(a, b, nudge) {
                    const n = hexDist(b.x - a.x, b.y - a.y), out = [];
                    for (let i = 0; i <= n; i++) {
                        const t = n ? i / n : 0;
                        out.push(cubeRound(a.x + (b.x - a.x) * t + nudge * 1e-6, a.y + (b.y - a.y) * t + nudge * 2e-6));
                    }
                    return out;
                },
                corners(q, r) {
                    const cx = q + r / 2,
                        cy = r * HALF_SQRT3;
                    return cornerOff.map(([ox, oy]) => [cx + ox, cy + oy]);
                },
                edges: dirs.map(([dx, dy], i) => [dx, dy, i, (i + 1) % 6]),
                chunkOf,
                chunkKey(q, r) {
                    const [i, j] = chunkOf(q, r);
                    return i + ',' + j;
                },
                chunkNeighbours: (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1], [i + 1, j - 1], [i - 1, j + 1]],
                chunkCells(i, j) {
                    const [cq, cr] = chunkCenter(i, j);
                    return disk(cq, cr, k);
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
        };
    
    pkg.GRID = makeGrid(QUAD.radius); // replaced by Game.reset
    
    
    // Grid distance (steps between cells) and straight-line distance².
    pkg.hexDist = (a, b) => pkg.GRID.dist(a, b);
    pkg.euclid2 = (a, b) => {
        const [ax, ay] = pkg.GRID.center(a.x, a.y), [bx, by] = pkg.GRID.center(b.x, b.y);
        return (ax - bx) ** 2 + (ay - by) ** 2;
    };
})(hc);
