(pkg => {
    'use strict';

    const JSClass = JS.Class,
        M = myt,
        {I18N:{get:i18n}, Text, SpacedLayout} = M,

        {
            WideView, UnderlineBtn, ICON_CANCEL,
            theme:{
                padding, rowHeight,
                colorText, colorTextMuted,
                fontSizeSmall, fontSizeMedium, fontFamilyMono
            }
        } = pkg,

        PANEL_WIDTH = 480,
        ROW_HEIGHT = rowHeight - 6,
        INDENT = 16,           // each level deeper, in what holds it
        BTN_WIDTH = 48,        // Take or Drop
        WEIGHT_WIDTH = 80,
        WEIGHT_X = PANEL_WIDTH - padding - BTN_WIDTH - padding - WEIGHT_WIDTH,

        /*  A section's heading, as wide as what it's in, over a line: its name, and on the
            right a summary (what it holds against what it can). */
        InventoryHead = new JSClass('InventoryHead', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    text = attrs.text;
                delete attrs.text;
                attrs.height = ROW_HEIGHT;

                self.callSuper(parent, attrs);

                self.getIDS().borderBottom = '1px solid ' + colorText;
                new Text(self, {x:padding, y:3, text, fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'});
                self._summary = new Text(self, {
                    x:PANEL_WIDTH / 3, y:5, width:PANEL_WIDTH * 2 / 3 - padding, textAlign:'right',
                    fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                });
            },

            setSummary: function(v) {this._summary.setText(v);}
        }),

        /*  An item: what it is (indented as deep as it is in what holds it), what it weighs,
            and a button to take or drop it, with why it can't be as its tooltip. */
        ItemRow = new JSClass('ItemRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {row, action, problem, onAction} = attrs;
                delete attrs.row;
                delete attrs.action;
                delete attrs.problem;
                delete attrs.onAction;
                attrs.height = ROW_HEIGHT;

                self.callSuper(parent, attrs);

                const x = padding + row.depth * INDENT;
                new Text(self, {
                    x, y:3, width:WEIGHT_X - x - padding, text:row.label, fontSize:fontSizeMedium, textColor:colorText
                }).enableEllipsis();
                new Text(self, {
                    x:WEIGHT_X, y:5, width:WEIGHT_WIDTH, text:row.weight, textAlign:'right',
                    fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                });
                const btn = self.btn = new UnderlineBtn(self, {
                    x:PANEL_WIDTH - padding - BTN_WIDTH, valign:'middle', fontSize:fontSizeMedium,
                    text:i18n('btn-' + action), disabled:!!problem,
                    tooltip:problem || i18n('tip-' + action, row.label)
                }, [{doActivated: () => onAction(row.id)}]);
                btn.getIDE().setAttribute('aria-label', i18n('btn-' + action) + ' ' + row.label);
                btn.getIDE().dataset.item = row.id;
            }
        });

    /*  What one of your pieces carries and what's on the ground under it, each with what
        it holds against what it can, and what's in each thing below it, indented. Each
        thing it carries can be dropped, and each on the ground taken, for an action (see
        Items.js). */
    pkg.InventoryDialog = new JSClass('InventoryDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;

            self.callSuper(parent, attrs);

            self.getFooterView().ackBtn.setText(ICON_CANCEL + ' ' + i18n('btn-close'));

            const container = self._container = new WideView(self.getContentView()),
                section = key => {
                    const head = new InventoryHead(container, {text:i18n(key)}),
                        rows = new WideView(container);
                    new SpacedLayout(rows, {axis:'y', spacing:2, collapseParent:true});
                    return {head, rows};
                };
            self._carried = section('inv-carried');
            self._ground = section('inv-ground');
            new SpacedLayout(container, {axis:'y', inset:padding, spacing:2, outset:padding, collapseParent:true});
        },


        // Methods /////////////////////////////////////////////////////////////
        /*  Shows it. describe() gives what to show: {carried, ground}, each {summary, rows:
            [{id, label, weight, depth}]}. dropProblem(id) and takeProblem(id) say why an
            item can't be dropped or taken ('' if it can), and onDrop(id) and onTake(id) do
            it. */
        show: function(opts) {
            this.callSuper();
            this._opts = opts;
            this.setTitle(opts.title);
            this.refresh();
        },

        /*  Brings it up to date. */
        refresh: function() {
            const self = this,
                {describe, dropProblem, takeProblem, onDrop, onTake} = self._opts,
                {carried, ground} = describe(),
                fill = (section, {summary, rows}, action, problem, onAction) => {
                    section.head.setSummary(summary);
                    section.rows.destroyAllSubviews();
                    if (rows.length) {
                        for (const row of rows) {
                            new ItemRow(section.rows, {row, action, problem:problem(row.id), onAction});
                        }
                    } else {
                        new Text(section.rows, {
                            x:padding, y:3, height:ROW_HEIGHT, text:i18n('inv-nothing'),
                            fontSize:fontSizeMedium, textColor:colorTextMuted
                        });
                    }
                };
            fill(self._carried, carried, 'drop', dropProblem, onDrop);
            fill(self._ground, ground, 'take', takeProblem, onTake);
            self.setContentHeightToFit(self._container.height);
        }
    });
})(hc);
