(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        M = myt,
        {I18N:{get:i18n}, Text, SpacedLayout} = M,
        
        {
            WideView, UnderlineBtn, STATS, ICON_CANCEL, ICON_CHECKED, CHARACTER_NAME_MAX, CHARACTER_DESCRIPTION_MAX,
            isIntBetween,
            theme:{
                spacing, padding, rowHeight, cornerRadius,
                colorText, colorTextMuted, colorSuccess, colorError, colorPanel,
                fontSizeMedium, fontSizeLarge
            }
        } = pkg,
        
        PANEL_WIDTH = 480,
        COLUMN_WIDTH = PANEL_WIDTH / 2,        // Stats on the left, Combat on the right
        LABEL_WIDTH = 110,                     // across the sheet
        STEP_SIZE = 24,                        // a + or − button
        VALUE_X = padding + LABEL_WIDTH,
        INPUT_WIDTH = PANEL_WIDTH - VALUE_X - padding,
        ROW_HEIGHT = rowHeight - 6,
        DESCRIPTION_HEIGHT = 3*ROW_HEIGHT,
        CLOSE_LABEL = ICON_CANCEL + ' ' + i18n('btn-close'),
        CONFIRM_LABEL = ICON_CHECKED + ' ' + i18n('btn-confirm'),
        INPUT_ATTRS = {
            x:VALUE_X, width:INPUT_WIDTH, fontSize:fontSizeMedium, bgColor:colorPanel, textColor:colorText,
            border:[1, 'solid', colorTextMuted], roundedCorners:cornerRadius/2
        },
        
        // A value, and if it would change, what to: the new one beside it in green.
        changed = (was, now) => String(was) === String(now) ? String(was) : was + ' <span style="color:' + colorSuccess + ';">' + now + '</span>',
        
        /*  A line of the sheet, as wide as what it's in: a label (labelWidth wide) and a
            value, and for a stat, buttons to put a point into it (+) or take one back (−). */
        SheetRow = new JSClass('SheetRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {stat, sheet, labelWidth = LABEL_WIDTH} = attrs,
                    width = parent.width,
                    valueX = padding + labelWidth;
                delete attrs.stat;
                delete attrs.sheet;
                delete attrs.labelWidth;
                attrs.height ??= ROW_HEIGHT;
                
                self.callSuper(parent, attrs);
                
                self._label = new Text(self, {x:padding, y:3, width:labelWidth, fontSize:fontSizeMedium, textColor:colorTextMuted});
                self._value = new Text(self, {x:valueX, y:3, width:width - valueX - padding - (stat ? 2*STEP_SIZE + 2*spacing : 0), fontSize:fontSizeMedium, textColor:colorText});
                if (stat) {
                    const label = i18n('stat-' + stat),
                        step = (icon, delta, x) => new pkg.IconBtn(self, {
                            x, y:0, width:STEP_SIZE, height:STEP_SIZE, icon, iconSize:14,
                            label:i18n(delta > 0 ? 'sheet-raise' : 'sheet-lower', label)
                        }, [{doActivated: () => sheet.step(stat, delta)}]);
                    self.minusBtn = step('minus', -1, width - padding - 2*STEP_SIZE - spacing);
                    self.plusBtn = step('plus', 1, width - padding - STEP_SIZE);
                }
            },
            
            /*  Shows label, and the value was, or if it would change, now beside it. */
            set: function(label, was, now = was) {
                this._label.setText(label);
                this._value.setText(changed(was, now));
            }
        }),
        
        /*  A section's heading, as wide as what it's in, over a line. */
        SheetHead = new JSClass('SheetHead', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    text = attrs.text;
                delete attrs.text;
                attrs.height = ROW_HEIGHT;
                
                self.callSuper(parent, attrs);
                
                self.getIDS().borderBottom = '1px solid ' + colorText;
                new Text(self, {x:padding, y:3, text, fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'});
            }
        }),
        
        /*  A line of the sheet with a label and a control (an input, a text area or a
            drop-down list), for creating a character. */
        InputRow = new JSClass('InputRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {label, make, height = ROW_HEIGHT + 4} = attrs;
                delete attrs.label;
                delete attrs.make;
                attrs.height = height;
                
                self.callSuper(parent, attrs);
                
                new Text(self, {x:padding, y:5, width:LABEL_WIDTH, text:label, fontSize:fontSizeMedium, textColor:colorTextMuted});
                const input = self.input = make(self, {...INPUT_ATTRS, y:2, height:height - 4});
                input.getIDE().setAttribute('aria-label', label);
                // (In the sheet's font, not the browser's for inputs.)
                input.getIDS().fontFamily = 'inherit';
            }
        });
    
    /*  The character sheet for one of your pieces: across the top, its name and its
        description (both can always be edited: a placed piece can be named), level, XP,
        status effects, needs and equipment;
        then, side by side, its stats, and what they make it in combat: HP, action points
        (its pool, recovery and initiative), accuracy and so on. It has three modes.
        
        Showing (show, without stat points): only that, with Close.
        
        Levelling (show, with stat points to spend: see Combat.js): the points left, and +
        and − on each stat to put a point in or take one back (never below what it was
        when the sheet opened, nor above its species' max). Confirm, once every point is
        in, spends them; Cancel puts them all back.
        
        Creating (create): your character for a new game: a name, a description, a
        species and a background (from the playable ones: one that fits none of the
        other's playable ones is disabled, and choosing one the other doesn't fit changes
        the other to the first that does), and the stats, from the species' typical ones
        with the background's adjustments (again whenever the species or background
        changes), + and − on each (lowering one
        gives a point back), within what creation allows (see Combat.characterProblem).
        Confirm, once it has a name and every point is in, makes it; Cancel doesn't.
        
        Levelling or creating, what would change shows beside what it is now, in green.
        
        Showing or levelling, Inventory (on the left of the footer) switches to its
        Inventory dialog, if show was given onInventory (see App). */
    pkg.CharacterSheet = new JSClass('CharacterSheet', pkg.ConfirmDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.leftItemCfgs = [{klass:UnderlineBtn, attrs:{
                name:'inventoryBtn', text:i18n('btn-inventory'), tooltip:i18n('tip-to-inventory'), fontSize:fontSizeLarge, valign:'middle'
            }, mixins:[{doActivated:() => self._onInventory?.()}]}];
            
            self.callSuper(parent, attrs);
            
            const container = self._container = new WideView(self.getContentView()),
                row = (parent, attrs) => new SheetRow(parent, {sheet:self, ...attrs}),
                head = (parent, key) => new SheetHead(parent, {text:i18n(key)}),
                select = method => (parent, attrs) => {
                    const s = new M.InputSelect(parent, attrs);
                    self.attachToDom(s, method, 'change');
                    return s;
                };
            
            // Its name (to type in: see _typed)
            self._nameInput = new InputRow(container, {label:i18n('sheet-name'), make:(parent, attrs) => {
                const input = new M.InputText(parent, {...attrs, maxLength:CHARACTER_NAME_MAX});
                input.getIDS().padding = '0 ' + padding/2 + 'px';
                self.attachToDom(input, '_typed', 'input');
                return input;
            }});
            self._descriptionInput = new InputRow(container, {label:i18n('sheet-description'), height:DESCRIPTION_HEIGHT, make:(parent, attrs) => {
                const input = new M.InputTextArea(parent, attrs);
                input.getIDE().maxLength = CHARACTER_DESCRIPTION_MAX;
                input.getIDS().padding = padding/2 + 'px';
                input.getIDS().resize = 'none';
                self.attachToDom(input, '_typedDescription', 'input');
                return input;
            }});
            // Creating: its species and background
            self._speciesInput = new InputRow(container, {label:i18n('sheet-species'), make:select('_choseSpecies')});
            self._backgroundInput = new InputRow(container, {label:i18n('sheet-background'), make:select('_choseBackground')});
            
            // Level, XP, status, equipment, thirst, hunger and fatigue
            self._infoRows = [0, 1, 2, 3, 4, 5, 6].map(() => row(container));
            
            // Stats on the left, combat on the right
            const columns = self._columns = new WideView(container),
                column = x => {
                    const v = new M.View(columns, {x, width:COLUMN_WIDTH});
                    new SpacedLayout(v, {axis:'y', spacing:2, collapseParent:true});
                    return v;
                },
                left = self._left = column(0),
                right = self._right = column(COLUMN_WIDTH);
            head(left, 'sheet-stats');
            self._pointsRow = row(left, {labelWidth:LABEL_WIDTH + 2*STEP_SIZE});
            self._statRows = STATS.map(stat => row(left, {stat, labelWidth:LABEL_WIDTH}));
            head(right, 'sheet-combat');
            self._combatRows = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => row(right, {labelWidth:LABEL_WIDTH}));
            
            new SpacedLayout(container, {axis:'y', inset:padding, spacing:2, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows, or levels, piece p (see above); or, with opts.create (a character to
            start from, or null for none), creates a character (see _create).
            describe(q) gives the lines for a piece q, as it is or would be:
            {info:[[label, value], ...], combat:[[label, value], ...]} (seven and nine of
            them). statMax(stat) is the most a stat can be (its species'). preview(adds) is
            p with the points of adds ({stat:n}) put in, and onConfirm(adds) spends them.
            onName(text) and onDescription(text) are called as its name and description are
            edited, and onInventory() when Inventory is clicked. */
        show: function(p, opts) {
            this.callSuper();
            if ('create' in opts) {
                this._create(opts);
            } else {
                this._show(p, opts);
            }
        },
        
        /** @private */
        _show: function(p, {title, describe, statMax, preview, onConfirm, onName, onDescription, onInventory}) {
            const self = this,
                levelling = p.statPoints.available > 0;
            self._onInventory = onInventory;
            self._setMode(levelling ? 'level' : 'show', title, {
                describe, onConfirm, onName, onDescription,
                base: () => p.stats,
                limits: stat => [0, statMax(stat) - p.stats[stat]],
                points: () => p.statPoints.available,
                piece: adds => Object.keys(adds).length ? preview(adds) : p
            });
            self._nameInput.input.setValue(p.name ?? '');
            self._descriptionInput.input.setValue(p.description ?? '');
            self.refresh();
        },
        
        /** @private Creates a character (see above), starting as character create
            ({name, description, species, background, stats}: its stats, if they're
            allowed, else its baseline). species and backgrounds are the
            playable ones ({id, name}), and fits(speciesId, backgroundId) whether a pair
            fits. baseline(speciesId, backgroundId) is the stats a pair starts from,
            range(speciesId, backgroundId, stat) the range a stat can be in ([min, max]), points the points to spend, preview(ch)
            a piece as ch would be, and describe as for show. onConfirm(ch) makes it;
            onCancel is called if it's not made. */
        _create: function({create:ch, title, species, backgrounds, fits, baseline, range, points, preview, describe, onConfirm, onCancel}) {
            const self = this,
                setOptions = (input, list, enabled) => {
                    const select = input.input;
                    select.setOptions(list.map(o => ({value:o.id, label:o.name})));
                    [...select.getIDE().options].forEach((o, i) => {o.disabled = !enabled(list[i].id);});
                };
            self._fits = fits;
            self._speciesList = species;
            self._backgroundList = backgrounds;
            self._baseline = () => baseline(self._speciesInput.input.getIDE().value, self._backgroundInput.input.getIDE().value);
            self._onCancel = onCancel;
            self._setMode('create', title, {
                describe,
                onConfirm: adds => onConfirm(self._character(adds)),
                base: () => self._baseline(),
                limits: stat => {
                    const [min, max] = range(self._speciesInput.input.getIDE().value, self._backgroundInput.input.getIDE().value, stat),
                        base = self._baseline()[stat];
                    return [min - base, max - base];
                },
                points: () => points,
                piece: adds => preview(self._character(adds))
            });
            setOptions(self._speciesInput, species, id => backgrounds.some(b => fits(id, b.id)));
            setOptions(self._backgroundInput, backgrounds, id => species.some(s => fits(s.id, id)));
            self._nameInput.input.setValue(ch?.name ?? '');
            self._descriptionInput.input.setValue(ch?.description ?? '');
            const sp = species.find(s => s.id === ch?.species && backgrounds.some(b => fits(s.id, b.id))) ?? species.find(s => backgrounds.some(b => fits(s.id, b.id)));
            self._speciesInput.input.getIDE().value = sp?.id ?? '';
            self._backgroundInput.input.getIDE().value = backgrounds.find(b => b.id === ch?.background && fits(sp?.id, b.id))?.id ?? backgrounds.find(b => fits(sp?.id, b.id))?.id ?? '';
            // Its stats, if they're its baseline with points that are allowed
            const base = sp ? self._baseline() : {},
                adds = Object.fromEntries(STATS.map(s => [s, (ch?.stats?.[s] ?? base[s]) - base[s]])),
                fine = STATS.every(s => {
                    const [lo, hi] = self._modeOpts.limits(s);
                    return isIntBetween(adds[s], lo, hi);
                }) && STATS.reduce((n, s) => n + adds[s], 0) <= points;
            self._adds = fine ? adds : {};
            self.refresh();
            self._nameInput.input.getIDE().focus();
        },
        
        /** @private */
        _setMode: function(mode, title, opts) {
            const self = this,
                editing = mode !== 'show',
                creating = mode === 'create',
                footer = self.getFooterView();
            self._mode = mode;
            self._modeOpts = opts;
            self._adds = {};
            self.setTitle(title);
            footer.inventoryBtn.setVisible(!creating && !!self._onInventory);
            footer.cancelBtn.setVisible(editing);
            footer.spacer.setVisible(editing);
            // (Close, just showing, in red, as other dialogs' Close and Cancel are.)
            footer.confirmBtn.setText(editing ? CONFIRM_LABEL : CLOSE_LABEL);
            footer.confirmBtn.setTextColor(editing ? colorSuccess : colorError);
            for (const r of [self._speciesInput, self._backgroundInput]) r.setVisible(creating);
            self._pointsRow.setVisible(editing);
            for (const r of self._statRows) {
                r.minusBtn.setVisible(editing);
                r.plusBtn.setVisible(editing);
            }
        },
        
        /** @private The character being created, with the points of adds put in. */
        _character: function(adds) {
            const self = this,
                speciesId = self._speciesInput.input.getIDE().value,
                base = self._baseline();
            return {
                name:self._nameInput.input.value ?? '',
                description:self._descriptionInput.input.value ?? '',
                species:speciesId,
                background:self._backgroundInput.input.getIDE().value,
                stats:Object.fromEntries(STATS.map(s => [s, base[s] + (adds[s] ?? 0)]))
            };
        },
        
        /** @private The species was chosen: if the background doesn't fit it, the first
            that does, and the stats as the species has them. */
        _choseSpecies: function(_event) {
            const self = this,
                species = self._speciesInput.input.getIDE().value,
                background = self._backgroundInput.input.getIDE();
            if (!self._fits(species, background.value)) {
                background.value = self._backgroundList.find(b => self._fits(species, b.id))?.id ?? '';
            }
            self._adds = {};
            self.refresh();
        },
        
        /** @private The background was chosen: if the species doesn't fit it, the first
            that does, and the stats as the species has them. */
        _choseBackground: function(_event) {
            const self = this,
                background = self._backgroundInput.input.getIDE().value,
                species = self._speciesInput.input.getIDE();
            if (!self._fits(species.value, background)) {
                species.value = self._speciesList.find(s => self._fits(s.id, background))?.id ?? '';
            }
            self._adds = {};
            self.refresh();
        },
        
        /** @private The name was typed in: for the character being created, or the piece
            shown (onName). */
        _typed: function(_event) {
            const self = this;
            if (self._mode === 'create') {
                self.refresh();
            } else {
                self._modeOpts.onName?.(self._nameInput.input.value ?? '');
            }
        },
        
        /** @private The description was typed in: for the character being created, or the
            piece shown (onDescription). */
        _typedDescription: function(_event) {
            const self = this;
            if (self._mode === 'create') {
                self.refresh();
            } else {
                self._modeOpts.onDescription?.(self._descriptionInput.input.value ?? '');
            }
        },
        
        /*  The points put in and not spent yet (in all: those taken out count against). */
        getAdded: function() {return Object.values(this._adds).reduce((n, v) => n + v, 0);},
        
        /*  Puts a point into stat (delta 1) or takes one back (-1), if there's one to. */
        step: function(stat, delta) {
            const self = this,
                n = (self._adds[stat] ?? 0) + delta,
                [lo, hi] = self._modeOpts.limits(stat);
            if (n >= lo && n <= hi && self.getAdded() + delta <= self._modeOpts.points()) {
                self._adds[stat] = n;
                self.refresh();
            }
        },
        
        /*  Brings every line up to date with the points put in. */
        refresh: function() {
            const self = this,
                opts = self._modeOpts,
                editing = self._mode !== 'show',
                was = opts.describe(opts.piece({})),
                now = opts.describe(opts.piece(self._adds)),
                base = opts.base(),
                left = opts.points() - self.getAdded(),
                fill = (rows, key) => rows.forEach((r, i) => r.set(was[key][i][0], was[key][i][1], now[key][i][1]));
            fill(self._infoRows, 'info');
            fill(self._combatRows, 'combat');
            self._pointsRow.set(i18n('sheet-points'), left);
            STATS.forEach((stat, i) => {
                const r = self._statRows[i],
                    added = self._adds[stat] ?? 0,
                    [lo, hi] = opts.limits(stat);
                r.set(i18n('stat-' + stat), base[stat], base[stat] + added);
                r.minusBtn.setDisabled(added <= lo);
                r.plusBtn.setDisabled(left <= 0 || added >= hi);
            });
            let ready = !editing || left === 0;
            if (self._mode === 'create') {
                ready = ready && !!(self._nameInput.input.value ?? '').trim() && !!self._speciesInput.input.getIDE().value && !!self._backgroundInput.input.getIDE().value;
            }
            self.getFooterView().confirmBtn.setDisabled(!ready);
            self._columns.setHeight(Math.max(self._left.height, self._right.height));
            self.setContentHeightToFit(self._container.height);
        },
        
        // (Not while typing in the description: Enter there is a new line.)
        getDefaultBtn: function() {
            const btn = this.getFooterView().confirmBtn;
            return btn.disabled || document.activeElement === this._descriptionInput.input.getIDE() ? null : btn;
        },
        
        doConfirm: function() {
            const self = this;
            if (!self.getFooterView().confirmBtn.disabled) {
                self.hide();
                if (self._mode !== 'show') self._modeOpts.onConfirm(self._adds);
            }
        },
        
        doCancel: function() {
            const self = this;
            self.hide();
            if (self._mode === 'create') self._onCancel?.();
        }
    });
})(hc);
