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
                fontSizeSmall, fontSizeMedium, fontSizeLarge, fontFamilyMono
            }
        } = pkg,

        PANEL_WIDTH = 640,
        ROW_HEIGHT = rowHeight - 6,
        INDENT = 16,           // each level deeper, in what holds it
        TOGGLE_WIDTH = 16,     // a container's ▸ / ▾
        BTN_WIDTH = 64,        // each action
        SLOTS = 3,             // the actions a row can have: take or drop, take all, transfer
        WEIGHT_WIDTH = 72,
        ACTIONS_X = PANEL_WIDTH - padding - SLOTS * BTN_WIDTH,
        WEIGHT_X = ACTIONS_X - padding - WEIGHT_WIDTH,

        /*  An action's button, in slot (0 to SLOTS - 1) of view: action names it (its label
            is "btn-" + action), with tip as its tooltip, or problem if it can't be done
            (then it's disabled). Its element has data-action, and data-item or
            data-holder (what it's for). */
        actionBtn = (view, slot, action, tip, problem, onClick, data) => {
            const btn = new UnderlineBtn(view, {
                x:ACTIONS_X + slot * BTN_WIDTH, width:BTN_WIDTH, valign:'middle', fontSize:fontSizeMedium,
                text:i18n('btn-' + action), disabled:!!problem, tooltip:problem || tip
            }, [{doActivated:onClick}]);
            Object.assign(btn.getIDE().dataset, {action, ...data});
            return btn;
        },
        
        /*  The ▸ / ▾ at x in view that shows or hides what's in a container (what, in
            words), as it's expanded or not; onToggle on a click. data as actionBtn's. */
        toggleBtn = (view, x, what, expanded, onToggle, data) => {
            const btn = new UnderlineBtn(view, {
                x, width:TOGGLE_WIDTH, valign:'middle', fontSize:fontSizeMedium, text:expanded ? '▾' : '▸',
                tooltip:i18n(expanded ? 'tip-collapse' : 'tip-expand', what)
            }, [{doActivated:onToggle}]);
            Object.assign(btn.getIDE().dataset, {action:'toggle', ...data});
            btn.getIDE().setAttribute('aria-expanded', String(expanded));
            return btn;
        },

        /*  A section's heading, as wide as what it's in, over a line: a ▸ / ▾ (if expanded
            isn't null: see toggleBtn), its name, a summary (what it holds against what it
            can), and maybe an action. */
        InventoryHead = new JSClass('InventoryHead', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {text, summary, expanded, onToggle, data} = attrs;
                delete attrs.text;
                delete attrs.summary;
                delete attrs.expanded;
                delete attrs.onToggle;
                delete attrs.data;
                attrs.height = ROW_HEIGHT;
                
                self.callSuper(parent, attrs);
                
                self.getIDS().borderBottom = '1px solid ' + colorText;
                if (expanded != null) toggleBtn(self, padding, text, expanded, onToggle, data);
                new Text(self, {
                    x:padding + (expanded != null ? TOGGLE_WIDTH : 0), y:3, text,
                    fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'
                });
                new Text(self, {
                    x:PANEL_WIDTH / 3, y:5, width:ACTIONS_X - padding - PANEL_WIDTH / 3, textAlign:'right', text:summary,
                    fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                });
            }
        }),

        /*  An item: a ▸ / ▾ to show or hide what's in it (if it holds things), what it is
            (indented as deep as it is in what holds it), what it weighs, and its actions'
            buttons. */
        ItemRow = new JSClass('ItemRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {row, expanded, onToggle} = attrs;
                delete attrs.row;
                delete attrs.expanded;
                delete attrs.onToggle;
                attrs.height = ROW_HEIGHT;

                self.callSuper(parent, attrs);

                const x = padding + row.depth * INDENT;
                if (row.container) toggleBtn(self, x, row.label, expanded, () => onToggle(row.id), {item:row.id});
                new Text(self, {
                    x:x + TOGGLE_WIDTH, y:3, width:WEIGHT_X - x - TOGGLE_WIDTH - padding, text:row.label,
                    fontSize:fontSizeMedium, textColor:colorText
                }).enableEllipsis();
                new Text(self, {
                    x:WEIGHT_X, y:5, width:WEIGHT_WIDTH, text:row.weight, textAlign:'right',
                    fontSize:fontSizeSmall, textColor:colorTextMuted, fontFamily:fontFamilyMono
                });
            }
        });

    /*  What one of your pieces carries, what's on the ground under it, and what's in the
        containers (fixtures: chests, tables) on its cell or next to it, each with what it
        holds against what it can. What's in each thing is below it, indented, shown with
        its ▸ (and hidden again with its ▾). Each thing can be taken (into what the piece
        carries: Take), dropped (onto the ground: Drop), or put in another holder
        (Transfer: then each place it could go has a Here button), and all that's in a
        holder taken at once (Take all), each for action points (see Items.js). It stays
        open when the turn ends. */
    pkg.InventoryDialog = new JSClass('InventoryDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'fit';
            attrs.tallWidth = PANEL_WIDTH;
            attrs.cancelable = true;
            attrs.leftItemCfgs = [{klass:UnderlineBtn, attrs:{
                name:'sheetBtn', text:i18n('btn-sheet'), tooltip:i18n('tip-to-sheet'), fontSize:fontSizeLarge, valign:'middle'
            }, mixins:[{doActivated:() => self._opts?.onSheet?.()}]}];

            self.callSuper(parent, attrs);

            self.getFooterView().ackBtn.setText(ICON_CANCEL + ' ' + i18n('btn-close'));

            const container = self._container = new WideView(self.getContentView());
            new SpacedLayout(container, {axis:'y', inset:padding, spacing:2, outset:padding, collapseParent:true});
        },


        // Methods /////////////////////////////////////////////////////////////
        /*  Shows it. opts:
                title
                describe()  what to show: [{ref, title, summary, open, expanded, takeAll,
                    rows}], a section for each holder (ref: what names it: see
                    Items.reachHolder; open: whether what's in it can be got at; expanded:
                    whether what's in it shows, or null if it always does; takeAll: why it
                    can't all be taken, '' if it can, or null for no Take all), its rows
                    [{id, label, weight, depth, container, expanded, equipped, actions}]
                    (actions: {take, drop, takeAll, transfer, equip}, each why it can't be
                    done, '' if it can, if it's offered: equip is Equip, or Unequip for
                    what's equipped)
                onSheet()   switches to the piece's character sheet (Character, on the
                    left of the footer)
                onToggle(ref)  shows or hides what's in the holder ref names (see
                    Items.toggleExpanded)
                tips        {take, drop, takeAll, transfer, equip, unequip}: each action's tooltip, of
                    what it's for in words (and for equip and unequip, its id)
                hereProblem(id, ref)  why item id can't go in the holder ref names
                onAction(action, id, ref)  does an action (take, drop, transfer, equip,
                    unequip or takeAll): to item id (to holder ref, for transfer), or for
                    takeAll, to holder ref */
        show: function(opts) {
            this.callSuper();
            this._opts = opts;
            this._moving = null;
            this.setTitle(opts.title);
            this.refresh();
        },

        /*  Brings it up to date. */
        refresh: function() {
            const self = this,
                {describe, tips, hereProblem, onAction, onToggle} = self._opts,
                moving = self._moving,
                container = self._container,
                toggle = ref => {
                    onToggle(ref);
                    self.refresh();
                },
                act = (action, id, ref) => () => {
                    self._moving = null;
                    onAction(action, id, ref);
                },
                // In a Transfer, a Here button for the holder ref names
                here = (view, ref, data) => actionBtn(
                    view, SLOTS - 1, 'here', i18n('tip-here', moving.label), hereProblem(moving.id, ref),
                    act('transfer', moving.id, ref), data
                ),
                note = key => new Text(container, {
                    x:padding, height:ROW_HEIGHT, text:i18n(key), fontSize:fontSizeMedium, textColor:colorTextMuted
                });
            container.destroyAllSubviews();
            if (moving) {
                const banner = new WideView(container, {height:ROW_HEIGHT});
                new Text(banner, {
                    x:padding, y:3, width:ACTIONS_X - 2 * padding, text:i18n('inv-moving', moving.label),
                    fontSize:fontSizeMedium, textColor:colorText, fontWeight:'bold'
                }).enableEllipsis();
                actionBtn(banner, SLOTS - 1, 'cancel', i18n('tip-cancel-transfer'), '', () => {
                    self._moving = null;
                    self.refresh();
                }, {});
            }
            for (const section of describe()) {
                const data = {holder:section.ref},
                    head = new InventoryHead(container, {
                        text:section.title, summary:section.summary, expanded:section.expanded,
                        onToggle:() => toggle(section.ref), data
                    });
                if (moving) {
                    here(head, section.ref, data);
                } else if (section.takeAll != null) {
                    actionBtn(
                        head, 1, 'takeAll', tips.takeAll(section.title), section.takeAll,
                        act('takeAll', null, section.ref), data
                    );
                }
                if (!section.open) {
                    note('inv-shut');
                } else if (section.expanded === false) {
                    continue;
                } else if (!section.rows.length) {
                    note('inv-nothing');
                }
                // Each row, but what's in what isn't expanded
                let hideBelow = Infinity;
                for (const row of section.rows) {
                    if (row.depth > hideBelow) continue;
                    hideBelow = row.container && !row.expanded ? row.depth : Infinity;
                    const view = new ItemRow(container, {row, expanded:row.expanded, onToggle:toggle}),
                        item = {item:row.id},
                        {take, drop, takeAll, transfer, equip} = row.actions;
                    if (moving) {
                        if (row.container && row.id !== moving.id) here(view, row.id, item);
                    } else {
                        if (take != null) {
                            actionBtn(view, 0, 'take', tips.take(row.label), take, act('take', row.id), item);
                        }
                        if (drop != null) {
                            actionBtn(view, 0, 'drop', tips.drop(row.label), drop, act('drop', row.id), item);
                        }
                        if (takeAll != null) {
                            actionBtn(
                                view, 1, 'takeAll', tips.takeAll(row.label), takeAll, act('takeAll', null, row.id), item
                            );
                        }
                        if (equip != null) {
                            const action = row.equipped ? 'unequip' : 'equip';
                            actionBtn(view, 1, action, tips[action](row.label, row.id), equip, act(action, row.id), item);
                        }
                        if (transfer != null) {
                            actionBtn(view, 2, 'transfer', tips.transfer(row.label), transfer, () => {
                                self._moving = {id:row.id, label:row.label};
                                self.refresh();
                            }, item);
                        }
                    }
                }
            }
            self.setContentHeightToFit(container.height);
        },

        /*  Esc (or ×) in a Transfer leaves it (then closes). */
        doClose: function() {
            if (this._moving) {
                this._moving = null;
                this.refresh();
            } else {
                this.callSuper();
            }
        }
    });
})(hc);
