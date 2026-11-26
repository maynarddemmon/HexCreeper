(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        M = myt,
        {I18N:{get:i18n}, Text, SpacedLayout} = M,
        
        {
            WideView, STATS,
            theme:{
                spacing, padding, rowHeight,
                colorText, colorTextMuted, colorSuccess, colorError,
                fontSizeMedium
            }
        } = pkg,
        
        PANEL_WIDTH = 440,
        LABEL_WIDTH = 150,
        STEP_SIZE = 24,                        // a + or − button
        VALUE_X = padding + LABEL_WIDTH,
        VALUE_WIDTH = PANEL_WIDTH - VALUE_X - 2*STEP_SIZE - spacing - 2*padding,
        ROW_HEIGHT = rowHeight - 6,
        CLOSE_LABEL = pkg.ICON_CANCEL + ' ' + i18n('btn-close'),
        CONFIRM_LABEL = pkg.ICON_CHECKED + ' ' + i18n('btn-confirm'),
        
        // A value, and if it would change, what to: the new one beside it in green (or under
        // it, with under).
        changed = (was, now, under) => String(was) === String(now) ? String(was) : was + (under ? '<br>' : ' ') + '<span style="color:' + colorSuccess + ';">' + now + '</span>',
        
        /*  A line of the sheet: a label and a value, and for a stat, buttons to put a point
            into it (+) or take one back (−). */
        SheetRow = new JSClass('SheetRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    stat = attrs.stat,
                    sheet = attrs.sheet;
                delete attrs.stat;
                delete attrs.sheet;
                attrs.height ??= ROW_HEIGHT;
                
                self.callSuper(parent, attrs);
                
                self._label = new Text(self, {x:padding, y:3, width:LABEL_WIDTH, fontSize:fontSizeMedium, textColor:colorTextMuted});
                self._value = new Text(self, {x:VALUE_X, y:3, width:VALUE_WIDTH, fontSize:fontSizeMedium, textColor:colorText});
                if (stat) {
                    const label = i18n('stat-' + stat),
                        step = (icon, delta, x) => new pkg.IconBtn(self, {
                            x, y:0, width:STEP_SIZE, height:STEP_SIZE, icon, iconSize:14,
                            label:i18n(delta > 0 ? 'sheet-raise' : 'sheet-lower', label)
                        }, [{doActivated: () => sheet.step(stat, delta)}]);
                    self.minusBtn = step('minus', -1, PANEL_WIDTH - padding - 2*STEP_SIZE - spacing);
                    self.plusBtn = step('plus', 1, PANEL_WIDTH - padding - STEP_SIZE);
                }
            },
            
            /*  Shows label, and the value was, or if it would change, now beside it (or under
                it, if that's too wide), the row growing to fit. */
            set: function(label, was, now) {
                const self = this,
                    value = self._value;
                self._label.setText(label);
                value.setText(changed(was, now));
                if (value.getIDE().scrollWidth > VALUE_WIDTH) value.setText(changed(was, now, true));
                value.sizeViewToDom();
                self.setHeight(Math.max(ROW_HEIGHT, value.y + value.height + 3));
            }
        });
    
    /*  The character sheet for one of your pieces: its level, XP, HP, action points, status
        effects, stats, and what they make it in combat. With stat points to spend (see
        Combat.js) it's for levelling: the points left, and + and − on each stat to put a
        point in or take one back (never below what it was when the sheet opened). What
        would change shows beside what it is now, in green. Confirm, once every point is
        in, spends them; Cancel puts them all back. Without points it only shows, with
        Close. */
    pkg.CharacterSheet = new JSClass('CharacterSheet', pkg.ConfirmDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            
            self.callSuper(parent, attrs);
            
            const container = self._container = new WideView(self.getContentView()),
                row = attrs => new SheetRow(container, {sheet:self, ...attrs}),
                head = key => new Text(container, {x:padding, text:i18n(key), fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'});
            self._infoRows = [0, 1, 2, 3].map(() => row());
            self._statsHead = head('sheet-stats');
            self._pointsRow = row();
            self._statRows = STATS.map(stat => row({stat}));
            head('sheet-combat');
            self._combatRows = [0, 1, 2, 3, 4].map(() => row());
            
            new SpacedLayout(container, {axis:'y', inset:padding, spacing:2, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  p is the piece. describe(q) gives the lines for a piece q, as it is or would be:
            {info:[[label, value], ...], combat:[[label, value], ...]} (four and five of
            them). preview(adds) is p with the points of adds ({stat:n}) put in, and
            onConfirm(adds) spends them. */
        show: function(p, {title, describe, preview, onConfirm}) {
            const self = this;
            self.callSuper();
            
            self._piece = p;
            self._describe = describe;
            self._preview = preview;
            self._onConfirm = onConfirm;
            self._adds = {};
            self._levelling = p.statPoints.available > 0;
            
            self.setTitle(title);
            const footer = self.getFooterView();
            footer.cancelBtn.setVisible(self._levelling);
            // (Close, without points, in red, as other dialogs' Close and Cancel are.)
            footer.confirmBtn.setText(self._levelling ? CONFIRM_LABEL : CLOSE_LABEL);
            footer.confirmBtn.setTextColor(self._levelling ? colorSuccess : colorError);
            self._pointsRow.setVisible(self._levelling);
            for (const r of self._statRows) {
                r.minusBtn.setVisible(self._levelling);
                r.plusBtn.setVisible(self._levelling);
            }
            self.refresh();
        },
        
        /*  The points put in and not spent yet. */
        getAdded: function() {return Object.values(this._adds).reduce((n, v) => n + v, 0);},
        
        /*  Puts a point into stat (delta 1) or takes one back (-1), if there's one to. */
        step: function(stat, delta) {
            const self = this,
                n = (self._adds[stat] ?? 0) + delta;
            if (n >= 0 && self.getAdded() + delta <= self._piece.statPoints.available) {
                self._adds[stat] = n;
                self.refresh();
            }
        },
        
        /*  Brings every line up to date with the points put in. */
        refresh: function() {
            const self = this,
                p = self._piece,
                was = self._describe(p),
                now = self._describe(self._preview(self._adds)),
                left = p.statPoints.available - self.getAdded(),
                fill = (rows, key) => rows.forEach((r, i) => r.set(was[key][i][0], was[key][i][1], now[key][i][1]));
            fill(self._infoRows, 'info');
            fill(self._combatRows, 'combat');
            self._pointsRow.set(i18n('sheet-points'), left, left);
            STATS.forEach((stat, i) => {
                const r = self._statRows[i],
                    added = self._adds[stat] ?? 0;
                r.set(i18n('stat-' + stat), p.stats[stat], p.stats[stat] + added);
                r.minusBtn.setDisabled(added === 0);
                r.plusBtn.setDisabled(left === 0);
            });
            self.getFooterView().confirmBtn.setDisabled(self._levelling && left > 0);
            self.setContentHeightToFit(self._container.height);
        },
        
        getDefaultBtn: function() {
            const btn = this.getFooterView().confirmBtn;
            return btn.disabled ? null : btn;
        },
        
        doConfirm: function() {
            const self = this;
            if (!self.getFooterView().confirmBtn.disabled) {
                self.hide();
                if (self._levelling) self._onConfirm(self._adds);
            }
        },
        
        doCancel: function() {
            this.hide();
        }
    });
})(hc);
