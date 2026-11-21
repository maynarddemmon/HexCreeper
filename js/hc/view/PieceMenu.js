(pkg => {
    'use strict';
    
    const M = myt,
        
        {
            Btn,
            theme:{spacing, cornerRadius, colorMenu, colorTextMuted, fontSizeMedium}
        } = pkg,
        
        MENU_WIDTH = 120;
    
    /*  A small menu that floats beside the selected piece, listing what can be done on or by
        it (opened by clicking the piece again). items: [{label(), tip(), enabled(), run()}];
        labels, tooltips and whether each is enabled are refreshed every frame, so an item
        that can't be used shows, disabled. Picking an item calls onPick, then the item's
        run. */
    pkg.PieceMenu = new JS.Class('PieceMenu', M.View, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                items = attrs.items,
                onPick = attrs.onPick;
            delete attrs.items;
            delete attrs.onPick;
            attrs.width = MENU_WIDTH;
            attrs.visible = false;
            
            self.callSuper(parent, attrs);
            
            self.getIDE().setAttribute('role', 'menu');
            self._buttons = items.map(item => {
                const btn = new Btn(self, {width:MENU_WIDTH, text:item.label(), fontSize:fontSizeMedium}, [{
                    doActivated: () => {
                        if (item.enabled()) {
                            onPick();
                            item.run();
                        }
                    },
                    setWidth: function(v) {
                        console.log(v);
                        this.callSuper(v);
                    }
                }]);
                btn.getIDE().setAttribute('role', 'menuitem');
                btn.item = item;
                return btn;
            });
            new M.SpacedLayout(self, {axis:'y', spacing, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Brings the labels, tooltips and enabled states up to date. */
        refresh: function() {
            for (const btn of this._buttons) {
                const {item} = btn;
                btn.setText(item.label());
                btn.setTooltip(item.tip());
                btn.setDisabled(!item.enabled());
            }
        },
        
        /*  Puts the menu beside a piece whose centre is at (sx, sy), size px across, to its
            right if there's room, else its left, kept inside the parent. */
        placeNear: function(sx, sy, size) {
            const parent = this.parent,
                gap = size * 0.6,
                w = this.width,
                h = this.height,
                x = sx + gap + w <= parent.width ? sx + gap : sx - gap - w;
            this.setX(Math.max(0, Math.min(parent.width - w, x)));
            this.setY(Math.max(0, Math.min(parent.height - h, sy - h / 2)));
        }
    });
})(hc);
