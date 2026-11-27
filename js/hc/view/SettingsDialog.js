(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        M = myt,
        {I18N:{get:i18n}, PlainText, SpacedLayout, global:{keys:globalKeys}} = M,
        
        {
            WideView, settings, ICON_CANCEL,
            theme:{
                spacing, padding, cornerRadius, rowHeight,
                colorText, colorTextMuted, colorPanel,
                fontSizeSmall, fontSizeMedium, fontSizeLarge, fontFamilyMono
            }
        } = pkg,
        
        PANEL_WIDTH = 480,
        INPUT_WIDTH = 64,
        SELECT_WIDTH = 160,
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
                if (M.KeyObservable.getCodeFromEvent(event) === globalKeys.CODE_ENTER) {
                    this._commit();
                }
            }
        }),
        
        /*  A label and a drop-down list for one choice setting. The value is set as soon as
            another is chosen. The options are filled in when it's refreshed, since some
            (the solid subtypes) are only known once the data has loaded. */
        ChoiceRow = new JSClass('ChoiceRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    def = self.def = attrs.def;
                delete attrs.def;
                attrs.height ??= rowHeight;
                
                self.callSuper(parent, attrs);
                
                new PlainText(self, {
                    x:padding, y:5, width:PANEL_WIDTH - SELECT_WIDTH - 4*padding, text:def.label, fontSize:fontSizeMedium, textColor:colorText
                }).enableEllipsis();
                
                const select = self.select = new M.InputSelect(self, {
                    x:PANEL_WIDTH - SELECT_WIDTH - 2*padding, y:2, width:SELECT_WIDTH, height:rowHeight - 4,
                    fontSize:fontSizeMedium, bgColor:colorPanel, textColor:colorText,
                    border:[1, 'solid', colorTextMuted], roundedCorners:cornerRadius/2
                });
                select.getIDE().dataset.setting = def.id;
                select.getIDE().setAttribute('aria-label', def.label);
                
                self.attachToDom(select, '_commit', 'change');
                self.refresh();
            },
            
            refresh: function() {
                const select = this.select,
                    options = this.def.options();
                if (select.getOptions().map(o => o.value).join('|') !== options.map(o => o.value).join('|')) {
                    select.setOptions(options);
                }
                select.getIDE().value = settings.get(this.def.id);
            },
            
            /** @private */
            _commit: function(_event) {
                settings.set(this.def.id, this.select.getIDE().value);
                this.refresh();
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
                        if (this.inited && settings.get(def.id) !== this.value) {
                            settings.set(def.id, this.value);
                        }
                    }
                }]);
            },
            
            refresh: function() {
                this.checkbox.setValue(settings.get(this.def.id));
            }
        });
    
    /*  Every preference, by group, built from their definitions (hc.settings). Changes
        apply as soon as they're made. */
    pkg.SettingsList = new JSClass('SettingsList', WideView, {
        initNode: function(parent, attrs) {
            const self = this,
                rows = self._rows = [];
            
            self.callSuper(parent, attrs);
            
            for (const group of settings.getGroups()) {
                const header = new WideView(self, {height:rowHeight + padding});
                new PlainText(header, {x:padding, y:padding, text:group.label, fontSize:fontSizeLarge, textColor:colorText, fontWeight:'bold'});
                rows.push(...group.definitions.map(def => new ({boolean:BooleanRow, choice:ChoiceRow}[def.type] ?? NumberRow)(self, {def})));
            }
            new SpacedLayout(self, {axis:'y', spacing, collapseParent:true});
        },
        
        /*  Shows each preference's value. */
        refresh: function() {
            for (const row of this._rows) row.refresh();
        }
    });
    
    /*  Edits the preferences (hc.settings): a note, then the SettingsList. */
    pkg.SettingsDialog = new JSClass('SettingsDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;
            
            self.callSuper(parent, attrs);
            
            self.setTitle(i18n('tip-settings'));
            self.getFooterView().ackBtn.setText(ICON_CANCEL + ' ' + i18n('btn-close'));
            
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
            
            // Preferences could have changed elsewhere since the dialog was built.
            self._list.refresh();
            self.setContentHeightToFit(self._container.height);
        }
    });
})(hc);
