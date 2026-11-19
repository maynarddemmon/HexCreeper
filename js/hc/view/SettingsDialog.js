(pkg => {
    'use strict';
    
    const M = myt,
        {I18N:{get:i18n}, Text, global:{keys:globalKeys}} = M,
        
        {
            WideView, ToggleBtn, UnderlineBtn, settings,
            theme:{
                spacing, padding, cornerRadius, rowHeight,
                colorText, colorTextMuted, colorPanel,
                fontSizeSmall, fontSizeMedium, fontSizeLarge, fontFamilyMono
            }
        } = pkg,
        
        PANEL_WIDTH = 480,
        INPUT_WIDTH = 64,
        LABEL_WIDTH = PANEL_WIDTH - INPUT_WIDTH - 4*padding,
        
        /*  A label and a number field for one setting. The value is set when the field
            changes or Enter is pressed, and the field then shows what was set. */
        NumberRow = new JS.Class('NumberRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    def = self.def = attrs.def;
                delete attrs.def;
                attrs.height ??= rowHeight;
                
                self.callSuper(parent, attrs);
                
                new Text(self, {
                    x:padding, y:5, width:LABEL_WIDTH, text:def.label, fontSize:fontSizeMedium, textColor:colorText
                }).enableEllipsis();
                
                const input = self.input = new M.InputText(self, {
                    x:PANEL_WIDTH - INPUT_WIDTH - 2*padding, y:2, width:INPUT_WIDTH, height:rowHeight - 4,
                    fontFamily:fontFamilyMono, fontSize:fontSizeMedium, textAlign:'right',
                    bgColor:colorPanel, textColor:colorText,
                    border:[1, 'solid', colorTextMuted], roundedCorners:cornerRadius/2,
                    allowedChars:'0123456789'
                });
                input.getIDS().padding = '0 ' + padding/2 + 'px';
                input.getIDE().dataset.setting = def.id;
                input.getIDE().setAttribute('aria-label', def.label);
                
                self.attachToDom(input, '_commit', 'change');
                self.attachToDom(input, '_keyDown', 'keydown');
                self.refresh();
            },
            
            refresh: function() {
                this.input.setValue(String(settings.get(this.def.id)));
            },
            
            /** @private */
            _commit: function(_event) {
                settings.set(this.def.id, this.input.value);
                this.refresh();
            },
            
            /** @private */
            _keyDown: function(event) {
                if (M.KeyObservable.getCodeFromEvent(event) === globalKeys.CODE_ENTER) this._commit();
            }
        });
    
    /*  Edits hc.settings. Built from the setting definitions, and changes apply as soon as they 
        are made. The grid choice comes first, then each group of numbers. The footer resets everything 
        but the grid. */
    pkg.SettingsDialog = new JS.Class('SettingsDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;
            attrs.leftItemCfgs = [{klass:UnderlineBtn, attrs:{
                name:'resetBtn', text:i18n('btn-reset-defaults'), fontSize:fontSizeMedium, valign:'middle'
            }, mixins:[{doActivated: () => {self.resetToDefaults();}}]}];
            
            self.callSuper(parent, attrs);
            
            self.setTitle(pkg.ICON_SETTINGS + ' ' + i18n('tip-settings'));
            self.getFooterView().ackBtn.setText(pkg.ICON_CANCEL + ' ' + i18n('btn-close'));
            
            const container = self._container = new WideView(self.getContentView()),
                rows = self._rows = [];
            
            // Grid //
            const gridDef = settings.getDefinition(pkg.SETTING_GRID),
                gridRow = new WideView(container, {height:rowHeight + 2*spacing});
            new Text(gridRow, {x:padding, y:5, text:gridDef.label, fontSize:fontSizeLarge, textColor:colorText});
            const gridBtns = self._gridBtns = {};
            let x = PANEL_WIDTH - 2*padding;
            for (const option of gridDef.options.slice().reverse()) {
                const btn = gridBtns[option] = new ToggleBtn(gridRow, {
                    y:2, text:i18n('grid-' + option), fontSize:fontSizeMedium, buttonType:'choice'
                }, [{
                    doActivated: () => {if (settings.get(pkg.SETTING_GRID) !== option) settings.set(pkg.SETTING_GRID, option);}
                }]);
                x -= btn.width;
                btn.setX(x);
                x -= spacing;
            }
            new Text(container, {
                x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal',
                text:i18n('setting-grid-desc') + ' ' + i18n('settings-note'),
                fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
            });
            
            // Number settings, by group //
            for (const group of settings.getGroups()) {
                const header = new WideView(container, {height:rowHeight + padding});
                new Text(header, {x:padding, y:padding, text:group.label, fontSize:fontSizeLarge, textColor:colorText, fontWeight:'bold'});
                for (const def of group.definitions) rows.push(new NumberRow(container, {def}));
            }
        
            new M.SpacedLayout(container, {axis:'y', inset:padding, spacing, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        show: function() {
            const self = this;
            self.callSuper();
            
            // Settings could have changed elsewhere since the dialog was built.
            self.refresh();
            self.setContentHeightToFit(self._container.height);
        },
        
        refresh: function() {
            for (const row of this._rows) row.refresh();
            const grid = settings.get(pkg.SETTING_GRID);
            for (const option in this._gridBtns) this._gridBtns[option].setOn(option === grid);
        },
        
        resetToDefaults: function() {
            settings.resetToDefaults();
            this.refresh();
        }
    });
})(hc);
