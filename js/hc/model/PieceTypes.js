(pkg => {
    'use strict';
    
    const {cfg:{PIECE_R, CORE_BORDER, RING_GAP, OWNERS}} = pkg;
    
    /*  Piece types: per-owner stats, movement (steps) and how each is drawn.
        
        stats: default hp / scoreValue for pieces of this type, per owner.
        steps(piece): the offsets this type can move by in one action. The Game
        turns these into legal moves (group movement, link range, attacks). */
    pkg.PIECE_TYPES = {
        core: {
            name:'Core',
            
            stats:{
                player:{hp:10, scoreValue:1},
                enemy: {hp:1,  scoreValue:1},
            },
            
            steps() {
                return pkg.GRID.dirs;
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
                        ctx.beginPath(); ctx.arc(cx, cy, r + size * RING_GAP + width / 2, 0, Math.PI * 2); ctx.stroke();
                    };
                
                // Moved this turn: inverted (light fill, coloured ring and number).
                const inv = opts.moved && !opts.ghost;
                ctx.globalAlpha = opts.ghost ? 0.3 : opts.spent ? 0.5 : 1;
                ctx.fillStyle = pkg.view.css(inv ? '--bg' : o.fill);
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
                
                // The border: thick on your core, thin on everything else, and a little thicker
                // when inverted so the ring still reads. It's drawn inside the edge.
                const border = opts.root ? Math.max(3, size * CORE_BORDER) : Math.max(1, size * (inv ? 0.045 : 0.03));
                ctx.lineWidth = border;
                ctx.strokeStyle = pkg.view.css(inv ? o.fill : o.stroke);
                ctx.beginPath(); ctx.arc(cx, cy, r - border / 2, 0, Math.PI * 2); ctx.stroke();
                
                // The rank is the same size on every piece, the core included.
                if (size >= 20) {
                    ctx.fillStyle = pkg.view.css(inv ? o.stroke : '--bg');
                    ctx.font = `700 ${Math.round(size * PIECE_R * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(piece.rank), cx, cy + size * PIECE_R * 0.06);
                } else {
                    ctx.fillStyle = pkg.view.css('--bg');
                    ctx.beginPath(); ctx.arc(cx, cy, size * PIECE_R * 0.3, 0, Math.PI * 2); ctx.fill();
                }
                
                ctx.globalAlpha = 1;
                if (opts.selected) ring(o.stroke, Math.max(2, size * 0.045));
                if (opts.healTarget) ring('--heal', Math.max(2, size * (piece.hp < piece.maxHp ? 0.07 : 0.035)));
                if (opts.linkTarget) ring('--place-ink', Math.max(2, size * 0.05));
            }
        }
    };
})(hc);
