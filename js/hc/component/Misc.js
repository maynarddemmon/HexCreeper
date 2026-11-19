(pkg => {
    'use strict';
    
    const {Class:JSClass} = JS,
        
        M = myt,
        {View, Text, ResizeLayout, SizeToParent} = M,
        
        {
            theme:{
                spacing, padding, layoutSpacing, rowHeight,
                colorPanel, colorPanelHeader, colorText, colorTextMuted, colorBtn,
                fontSizeLarge, fontSizeVeryLarge, fontFamilyMono
            }
        } = pkg,
        
        WideView = pkg.WideView = new JSClass('WideView', View, {
            include: [SizeToParent],
            
            initNode: function(parent, attrs) {
                attrs.percentOfParentWidth ??= 100;
                this.callSuper(parent, attrs);
            }
        });
    
    pkg.Spacer = new JSClass('Spacer', View, {
        initNode: function(parent, attrs) {
            attrs.layoutHint ??= 1;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.Panel = new JSClass('Panel', View, {
        initNode: function(parent, attrs) {
            attrs.defaultPlacement = '_contentView';
            
            const title = attrs.title ?? '';
            delete attrs.title;
            
            this.callSuper(parent, attrs);
            
            const headerView = this._headerView = new WideView(this, {
                ignorePlacement:true, height:rowHeight, bgColor:colorPanelHeader
            });
            (this._titleView = new Text(headerView, {
                text:title, tooltip:title, textColor:colorText, fontSize:fontSizeVeryLarge, y:2, layoutHint:1
            })).enableEllipsis();
            new ResizeLayout(headerView, {inset:padding, spacing:spacing, outset:padding/2});
            
            const y = headerView.y + headerView.height + layoutSpacing;
            this._contentView = new WideView(this, {
                ignorePlacement:true, overflow:'auto', y, percentOfParentHeight:100, percentOfParentHeightOffset:-y,
                bgColor:colorPanel, textColor:colorText
            });
        },
        
        setTitle: function(v, tooltip) {
            const titleView = this.getTitleView();
            titleView.setText(v);
            titleView.setTooltip(tooltip ?? pkg.stripMarkup(v));
        },
        
        getHeaderView: function() {return this._headerView;},
        getTitleView: function() {return this._titleView;},
        getContentView: function() {return this._contentView;}
    });
    
    /*  Shows "label : value", with the value in its own color and font. */
    pkg.LabeledValue = new JSClass('LabeledValue', M.PaddedText, {
        initNode: function(parent, attrs) {
            attrs.paddingLeft ??= padding;
            attrs.paddingRight ??= spacing;
            attrs.textColor ??= colorTextMuted;
            attrs.valueTextColor ??= colorBtn;
            attrs.valueFontFamily ??= fontFamilyMono;
            attrs.fontSize ??= fontSizeLarge;
            attrs.y ??= 1;
            
            this.callSuper(parent, attrs);
            this.update();
        },
        
        setLabel: function(v) {
            this.set('label', v, true);
            if (this.inited) this.updateText();
        },
        
        setValue: function(v) {
            this.set('value', v, true);
            if (this.inited) this.updateText();
        },
        
        setValueTextColor: function(v) {
            this.set('valueTextColor', v, true);
            if (this.inited) this.updateText();
        },
        
        setValueFontFamily: function(v) {
            this.set('valueFontFamily', v, true);
            if (this.inited) this.updateText();
        },
        
        update: function(v) {
            this.setValue(v ?? '-');
        },
        
        updateText: function() {
            this.setText(this.label + ' : ' + pkg.wrapInStyledSpan(this.value, this.valueTextColor, this.valueFontFamily));
        }
    });
})(hc);
