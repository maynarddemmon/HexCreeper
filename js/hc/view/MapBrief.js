(pkg => {
    'use strict';
    
    const M = myt,
        {I18N:{get:i18n}, Text, global:{keys:globalKeys}} = M,
        
        {
            WideView,
            theme:{
                padding, cornerRadius, rowHeight,
                colorText, colorTextMuted, colorError, colorPanel,
                fontSizeSmall, fontSizeMedium, fontSizeLarge, fontFamilyMono
            }
        } = pkg,
        
        PANEL_WIDTH = 480,
        SEED_WIDTH = 120,
        
        /*  A seed as typed: a whole number from 0 up, or null. */
        parseSeed = txt => {
            const s = String(txt).trim();
            return /^\d{1,9}$/.test(s) ? Number(s) : null;
        };
    
    /*  Shown before a map starts: its description, its goals and penalties, the settings
        it shows (so they can be set first) and the seed its map is made from, filled in with the map's seed or a
        random one. Start calls onStart(seed). Cancel (or closing it) calls onCancel. When
        a game is under way, a note says starting will end it. */
    pkg.MapBrief = new JS.Class('MapBrief', pkg.ConfirmDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            
            self.callSuper(parent, attrs);
            
            const footer = self.getFooterView();
            footer.confirmBtn.setText(pkg.ICON_CHECKED + ' ' + i18n('btn-start'));
            
            const container = self._container = new WideView(self.getContentView()),
                textAttrs = {x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal'};
            
            self._description = new Text(container, {...textAttrs, fontSize:fontSizeMedium, textColor:colorText});
            self._warning = new Text(container, {...textAttrs, text:i18n('brief-abandons'), fontSize:fontSizeSmall, textColor:colorError, fontFamily:fontFamilyMono});
            
            // Goals and penalties: a name and description for each, made in show. //
            self._goalsHeader = new Text(container, {...textAttrs, fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono});
            self._goals = new WideView(container);
            new M.SpacedLayout(self._goals, {axis:'y', spacing:padding/2, collapseParent:true});
            
            // The seed //
            const seedRow = new WideView(container, {height:rowHeight + padding});
            new Text(seedRow, {x:padding, y:padding + 5, text:i18n('brief-seed'), fontSize:fontSizeLarge, textColor:colorText, fontWeight:'bold'});
            const input = self._seedInput = new M.InputText(seedRow, {
                x:PANEL_WIDTH - padding - SEED_WIDTH, y:padding + 2, width:SEED_WIDTH, height:rowHeight - 4,
                fontFamily:fontFamilyMono, fontSize:fontSizeMedium, textAlign:'right',
                bgColor:colorPanel, textColor:colorText,
                border:[1, 'solid', colorTextMuted], roundedCorners:cornerRadius/2,
                allowedChars:'0123456789', maxLength:9
            });
            input.getIDS().padding = '0 ' + padding/2 + 'px';
            input.getIDE().dataset.seed = '';
            input.getIDE().setAttribute('aria-label', i18n('brief-seed'));
            self.attachToDom(input, '_keyDown', 'keydown');
            new Text(container, {...textAttrs, text:i18n('brief-seed-note'), fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono});
            
            new M.SpacedLayout(container, {axis:'y', inset:padding, spacing:padding, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  gameMap is a loaded map. */
        show: function(gameMap, {seed, underway, onStart, onCancel}) {
            const self = this;
            self.callSuper();
            
            self._onStart = onStart;
            self._onCancel = onCancel;
            
            self.setTitle(gameMap.number == null ? gameMap.name : i18n('map-numbered', gameMap.number, gameMap.name));
            self._description.setText(gameMap.description ?? '');
            self._description.setVisible(!!gameMap.description);
            self._warning.setVisible(!!underway);
            
            const objectives = gameMap.objectives ?? [],
                textAttrs = {x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal'};
            self._goalsHeader.setText(i18n(objectives.length ? 'brief-goals' : 'brief-no-goals'));
            for (const view of [...self._goals.getSubviews()]) view.destroy();
            for (const o of objectives) {
                let label = o.kind === 'goal' ? o.name : i18n('objective-penalty', o.name);
                if (!o.required) label = i18n('objective-optional', label);
                new Text(self._goals, {...textAttrs, text:label, fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'});
                if (o.description) new Text(self._goals, {...textAttrs, text:o.description, fontSize:fontSizeSmall, textColor:colorTextMuted});
            }
            self._goals.setVisible(objectives.length > 0);
            
            self._seedInput.setValue(String(seed));
            
            self.setContentHeightToFit(self._container.height);
        },
        
        /*  The seed typed, or a new random one if it isn't a seed. */
        getSeed: function() {
            return parseSeed(this._seedInput.value) ?? pkg.randomSeed();
        },
        
        /** @private */
        _keyDown: function(event) {
            if (M.KeyObservable.getCodeFromEvent(event) === globalKeys.CODE_ENTER) this.doConfirm();
        },
        
        doConfirm: function() {
            const seed = this.getSeed();
            this.hide();
            this._onStart?.(seed);
        },
        
        doCancel: function() {
            this.hide();
            this._onCancel?.();
        }
    });
})(hc);
