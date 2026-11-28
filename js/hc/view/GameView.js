/*  The game area: a myt view that holds the canvas (see View.js and Render.js), handles
    the mouse (select, move, attack, drag to pan, scroll to zoom, place, swap, attach, jump
    and go to modes; clicking the selected piece again opens its menu) */
(pkg => {
    'use strict';
    
    const V = pkg.view,
        {canvas, game, cam, screenToWorld, cellAt, sameCell, draw, eventPos} = V,
        
        MIN_SIZE = 12,
        MAX_SIZE = 140;
    
    pkg.GameView = new JS.Class('GameView', myt.View, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            this.callSuper(parent, attrs);
            this.getIDE().appendChild(canvas);
            this._listen();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Called after the player acts: keeps the core on screen. When it comes within
            FOLLOW_MARGIN % of the way in from an edge (of the way to the middle), the board
            pans (animated) by whole hexes until it's clear of it. A core already off screen,
            e.g. after the player has dragged away, is left alone. */
        afterTurn: function() {
            const c = game.getPlayerCore();
            if (c) {
                const [tx, ty] = V.camTarget(),
                    // Where the core will be on screen once any pan under way ends.
                    [wx, wy] = pkg.hex.center(c.x, c.y),
                    sx = (wx - tx) * cam.size + V.W / 2,
                    sy = (wy - ty) * cam.size + V.H / 2,
                    // One hex across, and one row of hexes down, in world units.
                    stepX = 1, stepY = Math.sqrt(3) / 2,
                    steps = (pos, size, step) => {
                        const margin = Math.min(size / 2 * pkg.cfg.FOLLOW_MARGIN / 100, size / 2 - 1);
                        if (pos < 0 || pos > size) return 0; // off screen: leave it
                        if (pos < margin) return -Math.ceil((margin - pos) / (step * cam.size));
                        if (pos > size - margin) {
                            return Math.ceil((pos - (size - margin)) / (step * cam.size));
                        }
                        return 0;
                    },
                    nx = steps(sx, V.W, stepX), ny = steps(sy, V.H, stepY);
                if (nx || ny) V.panTo(tx + nx * stepX, ty + ny * stepY);
            }
            
            draw();
        },
        
        /*  A click on a cell. Shift-click forces a move: if the selected piece can legally
            move to the clicked cell (e.g. onto a cell one of its own carried pieces is
            vacating), it moves instead of selecting the piece there. Alt-click (swap) on a
            piece the selected one can swap with swaps them (see swapAt). */
        handleClick: function(c, force=false, swap=false) {
            // Stops the selected piece going somewhere by itself, and that's all.
            if (pkg.app.interrupt()) return;
            // With a menu open, a click anywhere on the board just closes it.
            if (V.menuOpen || V.useChoice) {
                V.menuOpen = false;
                V.useChoice = null;
                draw();
                return;
            }
            if (!game.over) {
                if (V.placeMode) {
                    this._handlePlaceClick(c);
                    return;
                }
                if (V.swapMode) {
                    V.swapMode = false;
                    if (game.playerSwap(game.getSelected(), game.pieceAt(c.x, c.y))) {
                        this.afterTurn();
                    } else {
                        draw();
                    }
                    return;
                }
                if (V.gotoMode) {
                    V.gotoMode = false;
                    pkg.app.goTo(c);
                    return;
                }
                if (V.jumpMode) {
                    V.jumpMode = false;
                    if (game.playerJump(game.getSelected(), c.x, c.y)) {
                        this.afterTurn();
                    } else {
                        draw();
                    }
                    return;
                }
                if (V.useMode) {
                    // Use: the one thing the selected piece can do to the fixture there, or
                    // a choice of them (see App: actionMenu).
                    V.useMode = false;
                    const sel = game.getSelected(),
                        actions = game.canAfford(sel) ? game.fixtureActions(sel, game.fixtureAt(c.x, c.y)) : [];
                    if (actions.length === 1 && game.playerUse(sel, c.x, c.y, actions[0])) {
                        this.afterTurn();
                    } else {
                        if (actions.length > 1) V.useChoice = {x:c.x, y:c.y};
                        draw();
                    }
                    return;
                }
                if (V.attackMode) {
                    V.attackMode = false;
                    if (game.playerAttack(game.getSelected(), c.x, c.y)) {
                        this.afterTurn();
                    } else {
                        draw();
                    }
                    return;
                }
                if (V.attachMode) {
                    V.attachMode = false;
                    if (game.playerAttach(game.getSelected(), game.pieceAt(c.x, c.y))) {
                        this.afterTurn();
                    } else {
                        draw();
                    }
                    return;
                }
                // Alt (swap): a swap with the piece there, if it can.
                if (swap) {
                    const sel = game.getSelected(), q = V.swapAt(sel, c);
                    if (q && game.playerSwap(sel, q)) {
                        this.afterTurn();
                        return;
                    }
                }
                // Shift (force): a move in Free mode (see clickMoves), else as usual, even onto a
                // cell one of your pieces is on.
                const sel = game.getSelected(),
                    move = force && sel && V.clickMoves(sel, true).find(m => m.x === c.x && m.y === c.y);
                if (move && game.playerAct(sel, c.x, c.y, move.mode)) {
                    this.afterTurn();
                    return;
                }
                const clicked = game.pieceAt(c.x, c.y);
                if (clicked && clicked.owner === 'player') {
                    // The selected piece again: its menu.
                    if (clicked.id === game.selectedId) V.menuOpen = true;
                    game.selectedId = clicked.id;
                    draw();
                    return;
                }
                // A move, or a jump to a cell it can jump to (see jumpAt)
                if (sel && (pkg.app.stepInto(sel, c.x, c.y) || (V.jumpAt(sel, c) && game.playerJump(sel, c.x, c.y)))) {
                    this.afterTurn();
                }
            }
        },
        
        /*  Place mode: a click on a cell next to the selected piece places a piece there,
            linked to it; anywhere else cancels. @private */
        _handlePlaceClick: function(c) {
            const sel = game.getSelected();
            V.placeMode = false;
            if (sel && game.placeCells(sel).some(q => sameCell(q, c)) && game.playerPlace(c.x, c.y, sel)) {
                this.afterTurn();
            } else {
                draw();
            }
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
                if (!sameCell(V.hover, c) || V.shift !== e.shiftKey || V.alt !== e.altKey) {
                    V.hover = c;
                    V.shift = e.shiftKey;
                    V.alt = e.altKey;
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
                if (!wasDrag) self.handleClick(cellAt(...eventPos(e)), e.shiftKey, e.altKey);
            });
            
            // Shift or Alt down or up redraws what a click would do (see clickMoves and
            // swapAt); losing focus counts as up, as the key up goes elsewhere. (Capture
            // phase: myt's global key handling stops keys from bubbling up to the window.)
            const held = {Shift:'shift', Alt:'alt'},
                keyTo = (key, on) => {
                    if (held[key] && V[held[key]] !== on) {
                        V[held[key]] = on;
                        draw();
                    }
                };
            window.addEventListener('keydown', e => keyTo(e.key, true), true);
            window.addEventListener('keyup', e => keyTo(e.key, false), true);
            window.addEventListener('blur', () => {
                keyTo('Shift', false);
                keyTo('Alt', false);
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
