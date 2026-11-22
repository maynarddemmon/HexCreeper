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
        
        /*  One map: its number and name, as a button that plays it, and its description
            below. */
        MapRow = new JSClass('MapRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    gameMap = self.gameMap = attrs.gameMap,
                    onPlay = attrs.onPlay;
                delete attrs.gameMap;
                delete attrs.onPlay;
                
                self.callSuper(parent, attrs);
                
                const top = new WideView(self, {height:rowHeight});
                self._name = new UnderlineBtn(top, {
                    x:padding, valign:'middle', fontSize:fontSizeLarge, fontWeight:'bold',
                    tooltip:i18n('tip-play-map', gameMap.name)
                }, [{doActivated: () => {onPlay(gameMap.id);}}]);
                self._name.getIDE().setAttribute('aria-label', i18n('btn-play') + ' ' + gameMap.name);
                self.setPlaying(false);
                if (gameMap.description) {
                    new Text(self, {
                        x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal', text:gameMap.description,
                        fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                    });
                }
                new M.SpacedLayout(self, {axis:'y', spacing:spacing, collapseParent:true});
            },
            
            /*  Marks the map being played. */
            setPlaying: function(playing) {
                const gameMap = this.gameMap;
                this._name.setText(
                    (gameMap.number == null ? gameMap.name : i18n('map-numbered', gameMap.number, gameMap.name)) +
                    (playing ? ' ' + i18n('map-playing') : '')
                );
            }
        });
    
    /*  Lists every map in data/init.json5; pressing a map's name plays it. The list is
        built the first time it's shown, once init.json5 has loaded. onPlay(mapId) is
        called when a map's name is pressed, after the dialog closes. */
    pkg.MapsDialog = new JSClass('MapsDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            self.onPlay = attrs.onPlay;
            delete attrs.onPlay;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;
            
            self.callSuper(parent, attrs);
            
            self.setTitle(i18n('dlg-maps-title'));
            self.getFooterView().ackBtn.setText(pkg.ICON_CANCEL + ' ' + i18n('btn-close'));
            
            self._container = new WideView(self.getContentView());
            self._rows = [];
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows the maps, with the one being played (if any) marked. */
        show: function(playingId) {
            const self = this;
            self.callSuper();
            pkg.maps.loadIndex(index => {
                if (!self._rows.length) self._build(index);
                for (const row of self._rows) row.setPlaying(row.gameMap.id === playingId);
                self.setContentHeightToFit(self._container.height);
            });
        },
        
        _build: function(index) {
            const self = this,
                container = self._container;
            if (!index) {
                new Text(container, {x:padding, width:PANEL_WIDTH - 2*padding, whiteSpace:'normal', text:i18n('maps-load-failed'), textColor:colorTextMuted});
            } else {
                for (const gameMap of index.maps) {
                    self._rows.push(new MapRow(container, {gameMap, onPlay: id => {
                        self.hide();
                        self.onPlay?.(id);
                    }}));
                }
            }
            new M.SpacedLayout(container, {axis:'y', inset:padding, spacing:padding + spacing, outset:padding, collapseParent:true});
        }
    });
})(hc);
