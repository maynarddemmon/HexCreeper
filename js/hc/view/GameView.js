/*  The game area: a myt view that holds the canvas (see View.js and Render.js), handles
    the mouse (select, move, attack, drag to pan, scroll to zoom, place and heal modes),
    and overlays an info panel and a status line on the board. */
(pkg => {
    'use strict';

    const M = myt,
        {I18N:{get:i18n}, View, PaddedText, SpacedLayout, SizeToParent} = M,
        
        V = pkg.view,
        {
            canvas, game, cam, screenToWorld, cellAt, cellCenter, sameCell, draw, eventPos
        } = V,
        
        {
            LabeledValue,
            theme:{padding, spacing, cornerRadius, colorPanel, colorText, colorAccent, fontSizeMedium}
        } = pkg,
        
        MIN_SIZE = 12,
        MAX_SIZE = 140,
        
        INFO_WIDTH = 300,
        
        /*  The stats that don't fit in the header: core HP, turn, piece counts, the next wave
            and the selected piece. */
        InfoPanel = new JS.Class('InfoPanel', View, {
            initNode: function(parent, attrs) {
                const self = this;
                attrs.x ??= 12;
                attrs.y ??= 12;
                attrs.width ??= INFO_WIDTH;
                attrs.bgColor ??= colorPanel;
                attrs.roundedCorners ??= cornerRadius;
                attrs.boxShadow ??= [0, 1, 4, '#0002'];
                self.callSuper(parent, attrs);
                
                const row = (key, valueColor=colorText) => new LabeledValue(self, {
                    label:i18n(key), fontSize:fontSizeMedium, valueTextColor:valueColor,
                    width:INFO_WIDTH, whiteSpace:'nowrap'
                });
                self.hp = row('info-core-hp', colorAccent);
                const bar = self.hpBar = new View(self, {x:padding, width:INFO_WIDTH - 2*padding, height:6, bgColor:'var(--grid)', roundedCorners:3});
                self.hpFill = new View(bar, {height:6, bgColor:colorAccent, roundedCorners:3});
                self.selected = row('info-selected');
                
                new SpacedLayout(self, {axis:'y', inset:padding/2, spacing, outset:padding/2, collapseParent:true});
            },
            
            update: function() {
                const self = this,
                    core = game.playerCore,
                    hp = Math.max(0, core ? core.hp : 0),
                    max = core ? core.maxHp : 1,
                    sel = game.selected;
                self.hp.update(hp + ' / ' + max);
                self.hpFill.setWidth(self.hpBar.width * hp / max);
                if (sel) {
                    const carries = game.group(sel).length - 1;
                    self.selected.update(
                        i18n('info-selected-value', i18n(sel.id === game.playerCoreId ? 'info-core' : 'info-linked'), sel.rank, sel.hp, sel.maxHp) +
                        (carries > 0 ? i18n('info-selected-carries', carries) : '')
                    );
                } else {
                    self.selected.update(i18n('info-none'));
                }
            }
        });
    
    pkg.GameView = new JS.Class('GameView', View, {
        include: [SizeToParent],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.percentOfParentWidth ??= 100;
            attrs.overflow ??= 'hidden';
            
            self.callSuper(parent, attrs);
            
            self.getIDE().appendChild(canvas);
            
            self.infoPanel = new InfoPanel(self);
            self.statusTxt = new PaddedText(self, {
                align:'center', y:12, padding, visible:false,
                bgColor:colorPanel, textColor:colorText, roundedCorners:cornerRadius, fontSize:fontSizeMedium,
                boxShadow:[0, 1, 4, '#0002']
            });
            
            self.syncTo(self, '_onResize', 'width');
            self.syncTo(self, '_onResize', 'height');
            
            self._listen();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Updates the overlays, once per frame. */
        update: function() {
            this.infoPanel.update();
            let status = '';
            if (V.placeMode) {
                status = i18n(V.placeMode.stage === 'cell' ? 'status-place-cell' : 'status-place-link');
            } else if (V.healMode) {
                status = i18n('status-heal', game.healAmount());
            }
            const statusTxt = this.statusTxt;
            if (statusTxt.text !== status) {
                statusTxt.setText(status);
                statusTxt.sizeViewToDom();
            }
            statusTxt.setVisible(!!status);
        },
        
        /*  Called after the player acts: keeps the core comfortably on screen. */
        afterTurn: function() {
            this.followCore();
            draw();
        },
        
        followCore: function() {
            const c = game.playerCore;
            if (!c) return;
            const [sx, sy] = cellCenter(c.x, c.y),
                margin = cam.size * 3;
            if (sx < margin || sx > V.W - margin || sy < margin || sy > V.H - margin) this.centerOn(c);
        },
        
        centerOn: function(p) {
            [cam.x, cam.y] = pkg.GRID.center(p.x, p.y);
            draw();
        },
        
        /*  A click on a cell. Shift-click forces a move: if the selected piece can legally
            move to the clicked cell (e.g. onto a cell one of its own carried pieces is
            vacating), it moves instead of selecting the piece there. */
        handleClick: function(c, force=false) {
            if (game.over) return;
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
        },
        
        togglePlace: () => {
            if (game.over) return;
            V.healMode = false;
            if (V.placeMode) {
                V.placeMode = null;
            } else if (game.canAffordPlace()) {
                V.placeMode = {stage:'cell'};
            }
            draw();
        },
        
        toggleHeal: () => {
            if (game.over) return;
            V.placeMode = null;
            V.healMode = !V.healMode && game.canAffordHeal() && game.anyDamaged();
            draw();
        },
        
        cancelModes: () => {
            V.placeMode = null;
            V.healMode = false;
            draw();
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
