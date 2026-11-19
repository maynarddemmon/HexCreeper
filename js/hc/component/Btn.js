(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        
        {theme:{btnHeight, colorBtn}} = pkg,
        
        Btn = pkg.Btn = new JSClass('Btn', M.PaddedText, {
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
                
                attrs.paddingLeft ??= 8;
                attrs.paddingRight ??= 8;
                
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
            attrs.paddingLeft ??= 0;
            attrs.paddingRight ??= 0;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.SquareBtn = new JSClass('SquareBtn', Btn, {
        initNode: function(parent, attrs) {
            attrs.width ??= btnHeight;
            attrs.paddingLeft ??= 0;
            attrs.paddingRight ??= 0;
            attrs.lineHeight ??= '0px';
            
            this.callSuper(parent, attrs);
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
