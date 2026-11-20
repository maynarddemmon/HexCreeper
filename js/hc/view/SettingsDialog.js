(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        M = myt,
        {I18N:{get:i18n}, PlainText, SpacedLayout, global:{keys:globalKeys}} = M,
        
        {
            WideView, UnderlineBtn, settings,
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
        NumberRow = new JSClass('NumberRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    def = self.def = attrs.def;
                delete attrs.def;
                attrs.height ??= rowHeight;
                
                self.callSuper(parent, attrs);
                
                new PlainText(self, {
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
        }),
        
        /*  A checkbox for one boolean setting. The value is set as soon as it's toggled. */
        BooleanRow = new JSClass('BooleanRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    def = self.def = attrs.def;
                delete attrs.def;
                attrs.height ??= rowHeight;
                
                self.callSuper(parent, attrs);
                
                self.checkbox = new M.Checkbox(self, {
                    x:padding, y:5, label:def.label, fontSize:fontSizeMedium, textColor:colorText,
                    value:settings.get(def.id)
                }, [{
                    setValue: function(v) {
                        this.callSuper(v);
                        if (this.inited && settings.get(def.id) !== this.value) settings.set(def.id, this.value);
                    }
                }]);
            },
            
            refresh: function() {
                this.checkbox.setValue(settings.get(this.def.id));
            }
        });
    
    /*  Every setting, by group, built from the setting definitions; refresh shows only those
        the level shows. Changes apply as soon as they're made. Used by the SettingsDialog and
        the LevelBrief. */
    pkg.SettingsList = new JSClass('SettingsList', WideView, {
        initNode: function(parent, attrs) {
            const self = this,
                rows = self._rows = [],
                headers = self._headers = [];
            
            self.callSuper(parent, attrs);
            
            for (const group of settings.getGroups()) {
                const header = new WideView(self, {height:rowHeight + padding});
                new PlainText(header, {x:padding, y:padding, text:group.label, fontSize:fontSizeLarge, textColor:colorText, fontWeight:'bold'});
                header.rows = group.definitions.map(def => new (def.type === 'boolean' ? BooleanRow : NumberRow)(self, {def}));
                headers.push(header);
                rows.push(...header.rows);
            }
            new SpacedLayout(self, {axis:'y', spacing, collapseParent:true});
        },
        
        /*  Shows the settings the level being played shows, with their values. Returns
            whether there are any. */
        refresh: function() {
            for (const row of this._rows) {
                row.setVisible(settings.isShown(row.def.id));
                row.refresh();
            }
            for (const header of this._headers) header.setVisible(header.rows.some(row => row.visible));
            return this._rows.some(row => row.visible);
        }
    });
    
    /*  Edits hc.settings: a note, then the SettingsList. The footer puts the level's values
        back. */
    pkg.SettingsDialog = new JSClass('SettingsDialog', pkg.AckDialog, {
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
            
            self.setTitle(i18n('tip-settings'));
            self.getFooterView().ackBtn.setText(pkg.ICON_CANCEL + ' ' + i18n('btn-close'));
            
            const container = self._container = new WideView(self.getContentView());
            
            self._note = new PlainText(container, {
                x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal',
                text:i18n('settings-note'),
                fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
            });
            
            self._list = new pkg.SettingsList(container);
            
            new SpacedLayout(container, {axis:'y', inset:padding, spacing, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        show: function() {
            const self = this;
            self.callSuper();
            
            // Settings could have changed elsewhere since the dialog was built.
            self.refresh();
            self.setContentHeightToFit(self._container.height);
        },
        
        /*  Shows the settings the level being played shows, with their values. */
        refresh: function() {
            const any = this._list.refresh();
            this._note.setText(i18n(any ? 'settings-note' : 'settings-none'));
            this.getFooterView().resetBtn.setVisible(any);
        },
        
        resetToDefaults: function() {
            settings.resetToDefaults();
            this.refresh();
        }
    });
})(hc);
