(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        
        {theme:{btnHeight, colorBtn}} = pkg,
        
        ICON_DIR = './img/icons/',
        
        Btn = pkg.Btn = new JSClass('Btn', M.PlainText, {
            include: [M.Button],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            initNode: function(parent, attrs) {
                // Do disabled late since domClass will step on it.
                this.appendToLateAttrs('disabled');
                
                attrs.userUnselectable ??= true;
                attrs.tagName ??= 'button';
                attrs.focusable ??= true;
                attrs.focusIndicator ??= false;
                attrs.height ??= btnHeight;
                // Enter only: Space is the game's (End Turn), even in a dialog or menu (see
                // InventoryDialog and the piece menu).
                attrs.activationKeys ??= [M.global.keys.CODE_ENTER];
                
                const buttonType = attrs.buttonType || '';
                delete attrs.buttonType;
                
                this.callSuper(parent, attrs);
                this.addDomClass('hc-Btn', buttonType);
                
                this.sizeViewToDom();
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setButtonType: function(v) {
                this.setDomClass('hc-Btn ' + (v || ''));
                if (this.disabled) this.addDomClass('disabled');
            },
            
            /** @overrides */
            setDisabled: function(v) {
                if (this.disabled !== v) {
                    this.callSuper(v);
                    
                    this.removeDomClass('disabled');
                    if (this.disabled) this.addDomClass('disabled');
                }
            },
            
            /*  Sets the text and resizes to fit it, for buttons whose label changes. */
            setTextAndFit: function(v) {
                if (this.text !== v) {
                    this.setText(v);
                    this.sizeViewToDom();
                }
            }
        });

    pkg.UnderlineBtn = new JSClass('UnderlineBtn', Btn, {
        initNode: function(parent, attrs) {
            attrs.buttonType ??= 'underline';
            attrs.textColor ??= colorBtn;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.SquareBtn = new JSClass('SquareBtn', Btn, {
        initNode: function(parent, attrs) {
            attrs.width ??= btnHeight;
            attrs.lineHeight ??= '0px';
            
            this.callSuper(parent, attrs);
        }
    });
    
    /*  A square button showing an icon: an SVG from img/icons/ (Lucide) by name, or
        another image by iconUrl. The icon is drawn in the button's text colour, as a mask,
        so it follows hover and disabled styles like text does. label names the button for
        screen readers (and tests), since it has no text. */
    pkg.IconBtn = new JSClass('IconBtn', pkg.SquareBtn, {
        initNode: function(parent, attrs) {
            const iconUrl = attrs.iconUrl ?? ICON_DIR + attrs.icon + '.svg',
                iconSize = attrs.iconSize ?? 18,
                label = attrs.label;
            delete attrs.icon;
            delete attrs.iconUrl;
            delete attrs.iconSize;
            delete attrs.label;
            attrs.buttonType ??= 'underline';
            attrs.text = '';
            
            this.callSuper(parent, attrs);
            
            const iconIDS = new M.View(this, {width:iconSize, height:iconSize, align:'center', valign:'middle'}).getIDS();
            iconIDS.pointerEvents = 'none';
            iconIDS.backgroundColor = 'currentColor';
            iconIDS.mask = iconIDS.webkitMask = 'url(' + iconUrl + ') center / contain no-repeat';
            if (label) this.getIDE().setAttribute('aria-label', label);
        }
    });
    
    /*  A button that shows whether its mode is on. */
    pkg.ToggleBtn = new JSClass('ToggleBtn', Btn, {
        setOn: function(v) {
            if (this.on !== v) {
                this.on = v;
                this[v ? 'addDomClass' : 'removeDomClass']('on');
            }
        }
    });
})(hc);
