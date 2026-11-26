(pkg => {
    'use strict';
    
    const {cfg:{PIECE_R, CORE_BORDER, RING_GAP, OWNERS}} = pkg,
        
        {PI, sin:mathSin, cos:mathCos, max:mathMax} = Math,
        TWO_PI = 2*PI,
        
        /*  Draws a piece's rank as a symbol inside a circle of radius R (the inside of its
            border), centred on (cx, cy), in the current fill and stroke styles:
                1: nothing          2: a vertical line   3: a triangle, point up
                4: a cross          5: a solid star      6: an asterisk (3 lines)
                7: a 7 point star   8: 4 lines           9 and up: a star with that many points
            Lines run edge to edge; ranks 2, 4, 6 and 8 are 1 to 4 lines through the centre,
            starting with the vertical. */
        drawRankSymbol = (ctx, cx, cy, R, rank) => {
            if (rank <= 1) return;
            const at = (radius, angle) => [cx + radius * mathSin(angle), cy - radius * mathCos(angle)];
            ctx.beginPath();
            if (rank % 2 === 0 && rank <= 8) {
                const lines = rank / 2;
                for (let i = 0; i < lines; i++) {
                    const a = i * PI / lines;
                    ctx.moveTo(...at(R, a));
                    ctx.lineTo(...at(R, a + PI));
                }
                ctx.stroke();
            } else if (rank === 3) {
                for (let i = 0; i < 3; i++) ctx.lineTo(...at(R * 0.8, i * TWO_PI / 3));
                ctx.closePath();
                ctx.stroke();
            } else {
                const outer = R * 0.85, inner = outer * (rank === 5 ? 0.4 : 0.55);
                for (let i = 0; i < 2 * rank; i++) ctx.lineTo(...at(i % 2 ? inner : outer, i * PI / rank));
                ctx.closePath();
                ctx.fill();
            }
        };
    
    /*  Piece types: movement (steps) and how each is drawn.
        
        steps(piece): the offsets this type can move by in one action. The Game
        turns these into legal moves (group movement, link range, attacks). */
    pkg.PIECE_TYPES = {
        core: {
            name:'Core',
            
            steps() {
                return pkg.hex.dirs;
            },
            
            draw(ctx, cx, cy, size, piece, opts) {
                const o = opts.hl ? {fill:'--sel-fill', stroke:'--sel-stroke'} : OWNERS[piece.owner],
                    // Your core (opts.root) is bigger by its thick border, so inside the border
                    // it's the same size as the other pieces.
                    r = size * (PIECE_R + (opts.root ? CORE_BORDER : 0)),
                    // A ring around the piece, with a gap from its edge.
                    ring = (color, width) => {
                        ctx.strokeStyle = pkg.view.css(color);
                        ctx.lineWidth = width;
                        ctx.beginPath(); ctx.arc(cx, cy, r + size * RING_GAP + width / 2, 0, TWO_PI); ctx.stroke();
                    };
                
                // Without the action points to act (opts.spent): inverted (light fill,
                // coloured ring and level symbol).
                const inv = opts.spent && !opts.ghost;
                ctx.globalAlpha = opts.ghost ? 0.3 : 1;
                ctx.fillStyle = pkg.view.css(inv ? '--bg' : o.fill);
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.fill();
                
                // The border: thick on your core, thin on everything else, and a little thicker
                // when inverted so the ring still reads. It's drawn inside the edge.
                const border = opts.root ? mathMax(3, size * CORE_BORDER) : mathMax(1, size * (inv ? 0.045 : 0.03));
                ctx.lineWidth = border;
                ctx.strokeStyle = pkg.view.css(inv ? o.fill : o.stroke);
                ctx.beginPath(); ctx.arc(cx, cy, r - border / 2, 0, TWO_PI); ctx.stroke();
                
                // The level, as a symbol filling the inside of the border (see drawRankSymbol).
                ctx.fillStyle = ctx.strokeStyle = pkg.view.css(inv ? o.stroke : '--bg');
                ctx.lineWidth = mathMax(1, size * 0.035);
                ctx.lineJoin = 'round';
                drawRankSymbol(ctx, cx, cy, r - border, piece.level);
                ctx.lineJoin = 'miter';
                
                ctx.globalAlpha = 1;
                if (opts.selected) ring(o.stroke, mathMax(2, size * 0.045));
                if (opts.linkTarget) ring('--place-ink', mathMax(2, size * 0.05));
            }
        }
    };
})(hc);
