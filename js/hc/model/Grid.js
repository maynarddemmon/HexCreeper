/*  Hex grid geometry (pkg.hex) and chunks of cells (pkg.makeChunks). The game rules only
    use hex.dirs and hexDist(), so everything shape-specific lives here. */
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
        
        hexDist = (dq, dr) => (mathAbs(dq) + mathAbs(dr) + mathAbs(dq + dr)) / 2,
        
        // The cell holding fractional axial coordinates (q, r).
        cubeRound = (q, r) => {
            let rx = mathRound(q), rz = mathRound(r), ry = mathRound(-q - r);
            const dx = mathAbs(rx - q), dz = mathAbs(rz - r), dy = mathAbs(ry - (-q - r));
            if (dx > dy && dx > dz) rx = -ry - rz;
            else if (dz > dy) rz = -rx - ry;
            return {x:rx, y:rz};
        },
        
        cornerOff = [0, 1, 2, 3, 4, 5].map(i => {
            const a = (-90 + 60 * i) * PI_OVER_180;
            return [INV_SQRT3 * mathCos(a), INV_SQRT3 * mathSin(a)];
        }),
        
        // Cells within n steps of (cq, cr).
        disk = (cq, cr, n) => {
            const out = [];
            for (let dq = -n; dq <= n; dq++) {
                for (let dr = mathMax(-n, -dq - n); dr <= mathMin(n, -dq + n); dr++) {
                    out.push({x:cq + dq, y:cr + dr});
                }
            }
            return out;
        },
        
        // Neighbour order matches edge order: edge i joins corner i and i+1.
        DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
    
    /*  Hex grid geometry: axial (q, r) cells stored as (x, y), pointy-top, 6 neighbours,
        hex distance. World units: one cell is 1 unit across (flat-to-flat). */
    pkg.hex = {
        dirs:DIRS,
        keyDirs:KEY_DIRS,
        dist: (a, b) => hexDist(a.x - b.x, a.y - b.y),
        center: (q, r) => [q + r / 2, r * HALF_SQRT3],
        cellAtWorld: (wx, wy) => {
            const r = wy / HALF_SQRT3;
            return cubeRound(wx - r / 2, r);
        },
        disk,
        // The cells a straight line from cell a to cell b passes through, a and b
        // included. A line running exactly along an edge between two cells touches both:
        // nudge (1 or -1) picks which side it is counted on.
        line: (a, b, nudge) => {
            const n = hexDist(b.x - a.x, b.y - a.y),
                out = [];
            for (let i = 0; i <= n; i++) {
                const t = n ? i / n : 0;
                out.push(cubeRound(a.x + (b.x - a.x) * t + nudge * 1e-6, a.y + (b.y - a.y) * t + nudge * 2e-6));
            }
            return out;
        },
        corners: (q, r) => {
            const cx = q + r / 2,
                cy = r * HALF_SQRT3;
            return cornerOff.map(([ox, oy]) => [cx + ox, cy + oy]);
        },
        edges:DIRS.map(([dx, dy], i) => [dx, dy, i, (i + 1) % 6]),
        // A random cell on the ring of radius d around (cq, cr): start d steps toward SW,
        // then walk the six sides (d steps each) in a fixed rotation.
        ring: (cq, cr, d, rng=mathRandom) => {
            const rb = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]],
                idx = mathFloor(rng() * 6 * d),
                side = mathFloor(idx / d),
                step = idx % d;
            let q = cq + rb[4][0] * d,
                r = cr + rb[4][1] * d;
            for (let i = 0; i < side; i++) {
                q += rb[i][0] * d;
                r += rb[i][1] * d;
            }
            return {
                x:q + rb[side][0] * step,
                y:r + rb[side][1] * step
            };
        },
        *visibleCells(wx0, wy0, wx1, wy1) {
            const yLim = mathCeil(wy1 / HALF_SQRT3) + 1;
            for (let r = mathFloor(wy0 / HALF_SQRT3) - 1; r <= yLim; r++) {
                const halfR = r / 2,
                    xLim = mathCeil(wx1 - halfR) + 1;
                for (let q = mathFloor(wx0 - halfR) - 1; q <= xLim; q++) {
                    yield {x:q, y:r};
                }
            }
        }
    };
    
    /*  Chunks: hexagons of radius k (3k^2+3k+1 cells) that tile the plane, each with 6
        neighbours, laid out like cells: chunk (i, j)'s neighbours are as cell (i, j)'s.
        Chunk (0, 0) is centred on cell (0, 0). (A tile generator's quadrants: see
        ProximityTileGenerator.js.) */
    pkg.makeChunks = k => {
        // The chunk lattice: hexagons of radius k tile the plane with these basis vectors.
        const A = [2 * k + 1, -k],
            B = [k, k + 1],
            det = 3 * k * k + 3 * k + 1,
            center = (i, j) => [i * A[0] + j * B[0], i * A[1] + j * B[1]],
            of = (q, r) => {
                const fi = ((k + 1) * q - k * r) / det, fj = (k * q + (2 * k + 1) * r) / det;
                const i0 = mathRound(fi), j0 = mathRound(fj);
                let best = null,
                    bd = Infinity;
                for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
                    const [cq, cr] = center(i0 + di, j0 + dj);
                    const d = hexDist(q - cq, r - cr);
                    if (d < bd) { bd = d; best = [i0 + di, j0 + dj]; }
                }
                return best;
            };
        return {
            radius:k,
            of, // the chunk [i, j] cell (q, r) is in
            key: (q, r) => of(q, r).join(','), // and as an "i,j" key
            center: (i, j) => {
                const [x, y] = center(i, j);
                return {x, y};
            }, // the cell in the middle of chunk (i, j)
            neighbours: (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1], [i + 1, j - 1], [i - 1, j + 1]],
            cells: (i, j) => {
                const [cq, cr] = center(i, j);
                return disk(cq, cr, k);
            }
        };
    };
    
    // Grid distance (steps between cells) and straight-line distance squared.
    pkg.hexDist = (a, b) => hexDist(a.x - b.x, a.y - b.y);
    pkg.euclid2 = (a, b) => {
        const [ax, ay] = pkg.hex.center(a.x, a.y), [bx, by] = pkg.hex.center(b.x, b.y);
        return (ax - bx) ** 2 + (ay - by) ** 2;
    };
})(hc);
