(pkg => {
    'use strict';
    
    const {cfg:{PIECE_R, OWNERS}} = pkg;
    
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
                    r = size * PIECE_R;
                
                // Moved this turn: inverted (light fill, coloured ring and number).
                const inv = opts.moved && !opts.ghost;
                ctx.globalAlpha = opts.ghost ? 0.3 : opts.spent ? 0.5 : 1;
                ctx.fillStyle = pkg.view.css(inv ? '--bg' : o.fill);
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
                ctx.lineWidth = inv ? Math.max(2, size * 0.065) : Math.max(1.5, size * 0.05);
                ctx.strokeStyle = pkg.view.css(inv ? o.fill : o.stroke);
                ctx.stroke();
                
                if (size >= 20) {
                    ctx.fillStyle = pkg.view.css(inv ? o.stroke : '--bg');
                    ctx.font = `700 ${Math.round(r * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(piece.rank), cx, cy + r * 0.06);
                } else {
                    ctx.fillStyle = pkg.view.css('--bg');
                    ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2); ctx.fill();
                }
                
                if (opts.root) {
                    ctx.strokeStyle = pkg.view.css(o.stroke);
                    ctx.lineWidth = Math.max(1, size * 0.02);
                    ctx.beginPath(); ctx.arc(cx, cy, r + size * 0.045, 0, Math.PI * 2); ctx.stroke();
                }
                
                ctx.globalAlpha = 1;
                if (opts.selected) {
                    ctx.strokeStyle = pkg.view.css(o.stroke);
                    ctx.lineWidth = Math.max(2, size * 0.05);
                    ctx.beginPath(); ctx.arc(cx, cy, size * 0.335, 0, Math.PI * 2); ctx.stroke();
                }
                
                if (opts.healTarget) {
                    ctx.strokeStyle = pkg.view.css('--heal');
                    ctx.lineWidth = Math.max(2, size * (piece.hp < piece.maxHp ? 0.07 : 0.035));
                    ctx.beginPath(); ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2); ctx.stroke();
                }
                
                if (opts.linkTarget) {
                    ctx.strokeStyle = pkg.view.css('--place-ink');
                    ctx.lineWidth = Math.max(2, size * 0.05);
                    ctx.beginPath(); ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2); ctx.stroke();
                }
            }
        }
    };
})(hc);
