/*  The game area: a myt view that holds the canvas (see View.js and Render.js), handles
    the mouse (select, move, attack, drag to pan, scroll to zoom, place and heal modes) */
(pkg => {
    'use strict';
    
    const V = pkg.view,
        {canvas, game, cam, screenToWorld, cellAt, sameCell, draw, eventPos} = V,
        {EDGE_MARGIN} = pkg.cfg,
        
        MIN_SIZE = 12,
        MAX_SIZE = 140;
    
    pkg.GameView = new JS.Class('GameView', myt.View, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            self.getIDE().appendChild(canvas);
            
            self.syncTo(self, '_onResize', 'width');
            self.syncTo(self, '_onResize', 'height');
            
            self._listen();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Called after the player acts: keeps the core on screen. When it comes within
            EDGE_MARGIN px of an edge, the board pans (animated) by whole hexes until it's
            clear of it. A core already off screen, e.g. after the player has dragged away,
            is left alone. */
        afterTurn: function() {
            const c = game.playerCore;
            if (c) {
                const [tx, ty] = V.camTarget(),
                    // Where the core will be on screen once any pan under way ends.
                    [wx, wy] = pkg.GRID.center(c.x, c.y),
                    sx = (wx - tx) * cam.size + V.W / 2,
                    sy = (wy - ty) * cam.size + V.H / 2,
                    margin = Math.min(EDGE_MARGIN, V.W / 2 - 1, V.H / 2 - 1),
                    // One hex across, and one row of hexes down, in world units.
                    stepX = 1, stepY = Math.sqrt(3) / 2,
                    steps = (pos, size, step) => {
                        if (pos < 0 || pos > size) return 0; // off screen: leave it
                        if (pos < margin) return -Math.ceil((margin - pos) / (step * cam.size));
                        if (pos > size - margin) return Math.ceil((pos - (size - margin)) / (step * cam.size));
                        return 0;
                    },
                    nx = steps(sx, V.W, stepX), ny = steps(sy, V.H, stepY);
                if (nx || ny) V.panTo(tx + nx * stepX, ty + ny * stepY);
            }
            
            draw();
        },
        
        /*  A click on a cell. Shift-click forces a move: if the selected piece can legally
            move to the clicked cell (e.g. onto a cell one of its own carried pieces is
            vacating), it moves instead of selecting the piece there. */
        handleClick: function(c, force=false) {
            if (!game.over) {
                if (V.placeMode) {
                    this._handlePlaceClick(c);
                    return;
                }
                if (V.healMode) {
                    const t = game.pieceAt(c.x, c.y);
                    V.healMode = false;
                    if (t && t.owner === 'player') game.playerHeal(t);
                    draw();
                    return;
                }
                const sel = game.selected;
                if (force && sel && game.playerAct(sel, c.x, c.y)) {
                    this.afterTurn();
                    return;
                }
                const clicked = game.pieceAt(c.x, c.y);
                if (clicked && clicked.owner === 'player') {
                    game.selectedId = clicked.id;
                    draw();
                    return;
                }
                if (sel && game.playerAct(sel, c.x, c.y)) this.afterTurn();
            }
        },
        
        /** @private */
        _onResize: function(_event) {
            V.resize();
        },
        
        /** @private */
        _handlePlaceClick: function(c) {
            const isFree = game.placeCells().some(q => sameCell(q, c));
            if (V.placeMode.stage === 'cell') {
                V.placeMode = isFree ? {stage:'link', x:c.x, y:c.y} : null;
            } else {
                const cand = game.pieceAt(c.x, c.y);
                if (cand && game.linkCandidates(V.placeMode.x, V.placeMode.y).some(p => p.id === cand.id)) {
                    const {x, y} = V.placeMode;
                    V.placeMode = null;
                    if (game.playerPlace(x, y, cand)) {
                        this.afterTurn();
                        return;
                    }
                } else if (isFree) {
                    V.placeMode = {stage:'link', x:c.x, y:c.y}; // Pick a different cell.
                } else {
                    V.placeMode = {stage:'cell'}; // Back to choosing a cell.
                }
            }
            draw();
        },
        
        /*  Mouse handling on the canvas: click, drag to pan and scroll to zoom.
            @private */
        _listen: function() {
            const self = this;
            let drag = null;
            
            canvas.addEventListener('pointerdown', e => {
                canvas.setPointerCapture(e.pointerId);
                V.stopPan();
                drag = {sx:e.clientX, sy:e.clientY, camX:cam.x, camY:cam.y, moved:false};
            });
            
            canvas.addEventListener('pointermove', e => {
                const c = cellAt(...eventPos(e));
                if (!sameCell(V.hover, c)) {
                    V.hover = c;
                    draw();
                }
                if (!drag) return;
                const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
                if (!drag.moved && Math.hypot(dx, dy) > 4) {
                    drag.moved = true;
                    canvas.classList.add('dragging');
                }
                if (drag.moved) {
                    cam.x = drag.camX - dx / cam.size;
                    cam.y = drag.camY - dy / cam.size;
                    draw();
                }
            });
            
            canvas.addEventListener('pointerup', e => {
                const wasDrag = drag?.moved;
                drag = null;
                canvas.classList.remove('dragging');
                if (!wasDrag) self.handleClick(cellAt(...eventPos(e)), e.shiftKey);
            });
            
            canvas.addEventListener('pointerleave', () => {
                V.hover = null;
                draw();
            });
            
            canvas.addEventListener('wheel', e => {
                e.preventDefault();
                V.stopPan();
                const [px, py] = eventPos(e),
                    [wx, wy] = screenToWorld(px, py),
                    factor = Math.exp(-e.deltaY * 0.0015);
                cam.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, cam.size * factor));
                cam.x = wx - (px - V.W / 2) / cam.size;
                cam.y = wy - (py - V.H / 2) / cam.size;
                draw();
            }, {passive:false});
        }
    });
})(hc);
