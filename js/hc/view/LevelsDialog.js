(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {I18N:{get:i18n}, Text} = M,
        
        {
            WideView, UnderlineBtn,
            theme:{
                spacing, padding, rowHeight,
                colorTextMuted,
                fontSizeSmall, fontSizeLarge, fontFamilyMono
            }
        } = pkg,
        
        PANEL_WIDTH = 480,
        
        /*  One level: its number and name, as a button that plays it, and its description
            below. */
        LevelRow = new JSClass('LevelRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    level = self.level = attrs.level,
                    onPlay = attrs.onPlay;
                delete attrs.level;
                delete attrs.onPlay;
                
                self.callSuper(parent, attrs);
                
                const top = new WideView(self, {height:rowHeight});
                self._name = new UnderlineBtn(top, {
                    x:padding, valign:'middle', fontSize:fontSizeLarge, fontWeight:'bold',
                    tooltip:i18n('tip-play-level', level.name)
                }, [{doActivated: () => {onPlay(level.id);}}]);
                self._name.getIDE().setAttribute('aria-label', i18n('btn-play') + ' ' + level.name);
                self.setPlaying(false);
                if (level.description) {
                    new Text(self, {
                        x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal', text:level.description,
                        fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                    });
                }
                new M.SpacedLayout(self, {axis:'y', spacing:spacing, collapseParent:true});
            },
            
            /*  Marks the level being played. */
            setPlaying: function(playing) {
                const level = this.level;
                this._name.setText(
                    (level.number == null ? level.name : i18n('level-numbered', level.number, level.name)) +
                    (playing ? ' ' + i18n('level-playing') : '')
                );
            }
        });
    
    /*  Lists every level in data/init.json5; pressing a level's name plays it. The list is
        built the first time it's shown, once init.json5 has loaded. onPlay(levelId) is
        called when a level's name is pressed, after the dialog closes. */
    pkg.LevelsDialog = new JSClass('LevelsDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            self.onPlay = attrs.onPlay;
            delete attrs.onPlay;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;
            
            self.callSuper(parent, attrs);
            
            self.setTitle(i18n('dlg-levels-title'));
            self.getFooterView().ackBtn.setText(pkg.ICON_CANCEL + ' ' + i18n('btn-close'));
            
            self._container = new WideView(self.getContentView());
            self._rows = [];
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows the levels, with the one being played (if any) marked. */
        show: function(playingId) {
            const self = this;
            self.callSuper();
            pkg.levels.loadIndex(index => {
                if (!self._rows.length) self._build(index);
                for (const row of self._rows) row.setPlaying(row.level.id === playingId);
                self.setContentHeightToFit(self._container.height);
            });
        },
        
        _build: function(index) {
            const self = this,
                container = self._container;
            if (!index) {
                new Text(container, {x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal', text:i18n('levels-load-failed'), textColor:colorTextMuted});
            } else {
                for (const level of index.levels) {
                    self._rows.push(new LevelRow(container, {level, onPlay: id => {
                        self.hide();
                        self.onPlay?.(id);
                    }}));
                }
            }
            new M.SpacedLayout(container, {axis:'y', inset:padding, spacing:padding + spacing, outset:padding, collapseParent:true});
        }
    });
})(hc);
