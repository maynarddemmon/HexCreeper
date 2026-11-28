/*  Items and inventories (a module included in Game).

    An item kind (`items`, in data/items.json5) is what a thing is. It has a name, a
    description, and
        plural     its name for more than one (its name with an "s" if not given)
        material   the id of the material it's made of (see environs.json5's "materials")
        volume     its volume, in cubic centimetres
        weight     its weight, in grams: if not given, its volume times its material's
                   density (grams a cubic centimetre)
        capacity   the room it takes in an inventory (1 if not given; 0 takes none)
        stack      the most that make one stack (1 if not given: it doesn't stack)
        inventory  if things can be put in it: {capacity, weight, volume}, the most it can
                   hold (each without limit if not given). One that holds things doesn't
                   stack.
        equip      if a piece can equip it: {slot, damage, penetration, armor}. slot: one
                   of EQUIP_SLOTS (weapon, offhand, body, head, hands, feet); damage: a
                   weapon's [min, max], which replaces the piece's own (its species' or
                   profile's: unarmed) while it's equipped as its weapon; penetration: a
                   weapon's (it replaces the piece's own too; 0 if not given); armor: what
                   it adds to the piece's (0 if not given); cost: the action points
                   equipping it (or unequipping it) takes, in place of the equipCost
                   rule's (at least 0.1). One that's equipped doesn't stack.
        quench, satiates, heals, rests  if it can be drunk or eaten: what a dose of it
                   adds to thirst, hunger, HP and fatigue (in points: below 0 takes away; see
                   Needs.js). Each a number (for any species), or by species: {"goblin":100,
                   "hobgoblin":90, "*":5}, a species' own, else that of the nearest it
                   extends (a hobgoblin would have a goblin's), else "*"'s, else 0 (see
                   consumeEffects)
        dose       how many of it are eaten or drunk at once (1 if not given; what's left,
                   if fewer, does as much less)
        consumeCost  the action points eating or drinking it takes, in place of the
                   consumeCost rule's (at least 0.1)
        fluid      whether it's a fluid (water): it goes only in what holds fluids (an
                   inventory with "fluids":true: a flask), and nothing else goes there. It's
                   counted in its volume (a millilitre of water is one).
    Entries can extend others (see Subtypes.js).

    An item is plain data, saved with the game: {id, kind, count}, count being how many
    there are (a stack: they're one item), and inventory if its kind has one, and name if
    it has its own (a corpse: "goblin corpse"). Item ids are the game's (nextItemId), apart
    from pieces'.

    An inventory is {items:[...]}. A holder is what has one: a piece (what it carries), a
    cell's ground (what's on the ground there: Game.ground, "x,y" -> {x, y, inventory}) or
    an item (what's in it: so inventories nest, a corpse holding a sack holding coins). What
    a holder holds can't come to more than its limits:
        capacity  each stack takes its kind's capacity
        weight    each item's weight, with what's in it
        volume    each item's own volume (what's in it is inside it)
    A piece's limits are the carryCapacity, carryWeight and carryVolume rules', of its
    stats; a cell's, the groundCapacity, groundWeight and groundVolume rules'; an item's,
    its kind's. Some things are put in whatever the limits (force): what a piece had when
    it died goes into its corpse, and the corpse onto the ground, and an enemy starts with
    what its profile gives it.

    When a piece dies it leaves its remains on its cell: its species' corpse (an item kind:
    "corpse" if it doesn't say), holding all it had, named for it (see leaveRemains). A
    species whose corpse is "none" leaves nothing of itself, only what it had.

    Gold is an item (ITEM_GOLD, gold coins): loot gives it to the piece that takes it (what
    it can't carry falls on the ground), and placing a piece spends it (see spendGold).
    Your gold is all your pieces carry (see goldHeld).

    A fixture can be a holder too: a container (a chest, a table: see Fixtures.js). What a
    piece of yours can get at (its reach: see reachHolders) is what it carries, the ground
    under it, and the containers you know of on its cell or next to it (what's in one only
    while its access allows: an open chest), and what's in all those, all the way down.
    Whatever it can get at it can take (into what it carries), drop (onto the ground under
    it), or transfer (into any other holder it can get at), as much of it as fits, for the
    takeCost, dropCost and transferCost rules' action points; and it can take all that's in
    a holder, a thing at a time, while its points last (see playerTake, playerDrop,
    playerTransfer and playerTakeAll). */
(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        {
            Subtypes, isObj, attrs:{evaluate},
            STAT_VARS, ITEM_GOLD, EQUIP_SLOTS, NEED_UNIT, TILE_TYPE_FLOOR,
            formatVolume,
            isNatNum, isIntOfAtLeast
        } = pkg,
        {isText, isNum} = Subtypes,
        
        DEFAULT_CORPSE = 'corpse', // what a species leaves when it dies, if it doesn't say
        NO_CORPSE = 'none',        // a species that leaves no corpse
        
        // An inventory's limits as the data has them, made usable ({capacity, weight,
        // volume}, Infinity for none, and fluids: whether it holds fluids, and only them),
        // or null.
        parseLimits = v => {
            const limits = {
                capacity:v?.capacity ?? Infinity,
                weight:v?.weight ?? Infinity,
                volume:v?.volume ?? Infinity
            };
            return isObj(v) && Object.values(limits).every(n => n === Infinity || isNum(n)) &&
                (v.fluids === undefined || typeof v.fluids === 'boolean') ? {...limits, fluids:v.fluids === true} : null;
        },
        
        /*  An item kind as the data has it, made usable ({plural, material, volume,
            weight, capacity, stack, inventory}: inventory null if it holds nothing), or
            null if it isn't. */
        parseItem = entry => {
            const material = entry.material === undefined ? null : pkg.solids.getMaterial(entry.material) ?? undefined,
                volume = entry.volume,
                capacity = entry.capacity ?? 1,
                stack = entry.stack ?? 1,
                inventory = entry.inventory === undefined ? null : parseLimits(entry.inventory) ?? undefined,
                equip = entry.equip === undefined ? null : parseEquip(entry.equip),
                {dose = 1, consumeCost = null, fluid = false} = entry,
                effects = Object.fromEntries(CONSUME_EFFECTS.map(e => [e, parseBySpecies(entry[e])])),
                ok = isText(entry.plural) && material !== undefined && isNum(volume) &&
                    (entry.weight === undefined || isNum(entry.weight)) && isNatNum(capacity) &&
                    isIntOfAtLeast(stack, 1) && inventory !== undefined && !(inventory && stack > 1) &&
                    equip !== undefined && Object.values(effects).every(Boolean) && isIntOfAtLeast(dose, 1) &&
                    (consumeCost === null || (isNum(consumeCost) && consumeCost > 0)) && typeof fluid === 'boolean';
            return ok ? {
                plural:entry.plural || entry.name + 's',
                material:entry.material ?? null,
                volume,
                weight:entry.weight ?? volume * (material?.density ?? 0),
                capacity, stack, inventory, equip, ...effects, dose, consumeCost, fluid
            } : null;
        },
        
        // What eating or drinking an item can do (see parseItem)
        CONSUME_EFFECTS = ['quench', 'satiates', 'heals', 'rests'],
        
        /*  One of them as the data has it, made usable: by species, {id:n, "*":n} (a
            number for any species is {"*":n}; none is {}), or null if it isn't. */
        parseBySpecies = v => v === undefined ? {} : Number.isFinite(v) ? {'*':v} :
            isObj(v) && Object.values(v).every(Number.isFinite) ? {...v} : null,
        
        /*  An item kind's equip as the data has it, made usable ({slot, damage (or null),
            penetration, armor, cost (or null)}), or undefined if it isn't. */
        parseEquip = v => {
            const isRange = r => Array.isArray(r) && r.length === 2 && r.every(isNatNum) && r[0] <= r[1],
                equip = isObj(v) ? {
                    slot:v.slot, damage:v.damage ?? null, penetration:v.penetration ?? 0, armor:v.armor ?? 0, cost:v.cost ?? null
                } : null;
            return equip && EQUIP_SLOTS.includes(equip.slot) && (equip.damage === null || isRange(equip.damage)) &&
                isNatNum(equip.penetration) && isNatNum(equip.armor) && (equip.cost === null || (isNum(equip.cost) && equip.cost > 0)) ?
                {...equip, damage:equip.damage && [...equip.damage]} : undefined;
        },
        
        // The limits of what holds nothing
        NO_ROOM = {capacity:0, weight:0, volume:0},
        
        /*  A list of items as the data has it (an enemy profile's items, a fixture's
            contents), made usable ([{kind, count:[min, max], contents}]: it may be none),
            or null if it isn't: item kind ids, or {"kind":id, "count":n or [min, max],
            "contents":a list of what's in each}, e.g. a full canteen: {"kind":"canteen",
            "contents":[{"kind":"water", "count":1000}]}. */
        parseItemList = v => {
            const countOf = n => Number.isInteger(n) ? [n, n] : n ?? [1, 1],
                isRange = r => Array.isArray(r) && r.length === 2 && r.every(isNatNum) && r[0] <= r[1],
                items = Array.isArray(v ?? []) ? (v ?? []).map(e => typeof e === 'string' ? {kind:e, count:[1, 1], contents:[]} :
                    isObj(e) && typeof e.kind === 'string' ?
                        {kind:e.kind, count:countOf(e.count), contents:parseItemList(e.contents)} : null) : [null];
            return items.every(e => e && isRange(e.count) && e.contents) ? items : null;
        },
        
        // An item of a kind that isn't known: it weighs nothing, and takes a place.
        FALLBACK = {
            plural:'', material:null, volume:0, weight:0, capacity:1, stack:1, inventory:null, equip:null,
            quench:{}, satiates:{}, heals:{}, rests:{}, dose:1, consumeCost:null, fluid:false
        },
        
        // How many of something weighing (or taking) each, whose limit leaves room, fit.
        howMany = (room, each) => each > 0 ? Math.floor(room / each + 1e-9) : Infinity,
        
        // Whether an inventory as saved makes sense: {items:[...]}, each item {id, kind,
        // count, name?, inventory?}, all the way down.
        isInventory = v => isObj(v) && Array.isArray(v.items) && v.items.every(it => isObj(it) &&
            Number.isInteger(it.id) && typeof it.kind === 'string' && isIntOfAtLeast(it.count, 1) &&
            (it.name === undefined || typeof it.name === 'string') &&
            (it.expanded === undefined || typeof it.expanded === 'boolean') &&
            (it.equipped === undefined || typeof it.equipped === 'boolean') &&
            (it.inventory === undefined || isInventory(it.inventory)));
    
    pkg.items = new Subtypes('item', parseItem);
    
    pkg.Items = new JS.Module('Items', {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            isInventory,
            parseLimits,
            parseItemList,
            DEFAULT_CORPSE,
            NO_CORPSE,
            CONSUME_EFFECTS
        },
        
        // ---- Items ----
        /*  Item it's kind (FALLBACK's properties, named for its kind, if that isn't known). */
        itemKind: function(it) {
            return pkg.items.get(it.kind) ?? {...FALLBACK, id:it.kind, name:it.kind, description:'', plural:it.kind};
        },
        
        /*  A new item of the kind with id kind, count of them, holding nothing. (More than
            a stack is made into stacks when it's put somewhere: see addItem.) */
        makeItem: function(kind, count = 1) {
            const it = {id:this.nextItemId++, kind, count};
            if (this.itemKind(it).inventory) it.inventory = {items:[]};
            return it;
        },
        
        /*  What item it is called: its own name, or its kind's (its plural for more
            than one). */
        itemName: function(it) {
            const k = this.itemKind(it);
            return it.name ?? (it.count === 1 ? k.name : k.plural);
        },
        
        /*  Item it in words, as count of it (all of it if not given): "dagger", "12 gold
            coins", "0.25 L water" (a fluid: its volume). */
        itemLabel: function(it, count = it.count) {
            const name = this.itemName({...it, count});
            return this.itemKind(it).fluid ? i18n('item-fluid', formatVolume(this.itemKind(it).volume * count), name) :
                count > 1 ? i18n('item-count', count, name) : name;
        },
        
        /*  What item it weighs, in grams: its kind's weight, times how many, and what's in
            it. */
        itemWeight: function(it) {
            const inside = (it.inventory?.items ?? []).reduce((n, i) => n + this.itemWeight(i), 0);
            return this.itemKind(it).weight * it.count + inside;
        },
        
        /*  Item it's volume, in cubic centimetres (not counting what's in it). */
        itemVolume: function(it) {return this.itemKind(it).volume * it.count;},
        
        /*  Whether item b can go in item a's stack. */
        stacksWith: function(a, b) {
            return a.kind === b.kind && this.itemKind(a).stack > 1 && a.name === undefined && b.name === undefined &&
                !a.equipped && !b.equipped;
        },
        
        /*  Whether item it is target, or holds it (at any depth). */
        holdsItem: function(it, target) {
            return it === target || (it.inventory?.items ?? []).some(i => this.holdsItem(i, target));
        },
        
        // ---- Inventories ----
        /*  The most holder (a piece, a cell's ground, a fixture or an item) can hold:
            {capacity, weight, volume}. */
        inventoryLimits: function(holder) {
            let limits;
            if (holder.kind !== undefined) {
                limits = this.itemKind(holder).inventory ?? NO_ROOM;
            } else if (holder.subtype !== undefined) {
                limits = this.fixtureType(holder).inventory ?? NO_ROOM;
            } else if (holder.owner !== undefined) {
                const vars = this.statVars(holder),
                    rule = id => Math.max(0, evaluate(this.rules[id], STAT_VARS, vars)) || 0;
                limits = {
                    capacity:Math.floor(rule('carryCapacity')),
                    weight:rule('carryWeight'),
                    volume:rule('carryVolume')
                };
            } else {
                const rules = this.rules;
                limits = {capacity:rules.groundCapacity, weight:rules.groundWeight, volume:rules.groundVolume};
            }
            return limits;
        },
        
        /*  What holder holds comes to: {capacity, weight, volume} (see above). */
        inventoryTotals: function(holder) {
            const totals = {capacity:0, weight:0, volume:0};
            for (const it of holder.inventory?.items ?? []) {
                totals.capacity += this.itemKind(it).capacity;
                totals.weight += this.itemWeight(it);
                totals.volume += this.itemVolume(it);
            }
            return totals;
        },
        
        /*  How many of item it would fit in holder (from 0 to its count): stacks of its
            kind there take what they have room for, and the rest need new stacks. */
        fitCount: function(holder, it) {
            return Math.min(it.count, ...Object.values(this._fits(holder, it)));
        },
        
        /** @private How many of item it fit in holder, by each limit: {capacity, weight,
            volume}. None, if it would go in itself. */
        _fits: function(holder, it) {
            const k = this.itemKind(it),
                limits = this.inventoryLimits(holder),
                totals = this.inventoryTotals(holder),
                each = this.itemWeight(it) / it.count,
                room = (holder.inventory?.items ?? []).filter(i => this.stacksWith(i, it))
                    .reduce((n, i) => n + k.stack - i.count, 0),
                loop = holder.kind !== undefined && this.holdsItem(it, holder),
                // (A fluid goes only in what holds fluids, and only a fluid does.)
                misfit = k.fluid !== !!limits.fluids;
            return loop || misfit ? {capacity:0, weight:0, volume:0} : {
                capacity:room + howMany(limits.capacity - totals.capacity, k.capacity) * k.stack,
                weight:howMany(limits.weight - totals.weight, each),
                volume:howMany(limits.volume - totals.volume, k.volume)
            };
        },
        
        /*  Why count of item it (all of it if not given) can't go in holder: '' if it can,
            else 'loop' (it would go in itself), 'fluid' (it's a fluid, and holder doesn't
            hold fluids), 'solid' (holder holds only fluids), 'capacity', 'weight' or
            'volume' (the first limit it's over). */
        addProblem: function(holder, it, count = it.count) {
            const fits = this._fits(holder, it);
            let retval;
            if (holder.kind !== undefined && this.holdsItem(it, holder)) {
                retval = 'loop';
            } else if (this.itemKind(it).fluid !== !!this.inventoryLimits(holder).fluids) {
                retval = this.itemKind(it).fluid ? 'fluid' : 'solid';
            } else {
                retval = ['capacity', 'weight', 'volume'].find(limit => fits[limit] < count) ?? '';
            }
            return retval;
        },
        
        /*  Puts item it (all of it) in holder, if it fits (or whatever its limits, with
            force: but never in itself). Stacks of its kind there take what they have room
            for, the rest making new stacks (it, and more if it's more than a stack). Returns
            why it couldn't (see addProblem), or '' if it did. */
        addItem: function(holder, it, force = false) {
            const loop = holder.kind !== undefined && this.holdsItem(it, holder),
                problem = force ? (loop ? 'loop' : '') : this.addProblem(holder, it);
            if (!problem) {
                const k = this.itemKind(it),
                    items = (holder.inventory ??= {items:[]}).items;
                let left = it.count;
                for (const i of items) {
                    if (left > 0 && this.stacksWith(i, it) && i.count < k.stack) {
                        const n = Math.min(left, k.stack - i.count);
                        i.count += n;
                        left -= n;
                    }
                }
                let next = it;
                while (left > 0) {
                    next.count = Math.min(left, k.stack);
                    left -= next.count;
                    items.push(next);
                    if (left > 0) next = this.makeItem(it.kind, left);
                }
            }
            return problem;
        },
        
        /*  Takes count of item it (all of it if not given) out of holder: it, or for some
            of a stack, a new item of them. */
        takeOut: function(holder, it, count = it.count) {
            const items = holder.inventory.items;
            let retval = it;
            if (count < it.count) {
                it.count -= count;
                retval = this.makeItem(it.kind, count);
            } else {
                items.splice(items.indexOf(it), 1);
            }
            return retval;
        },
        
        /*  Item id, wherever it is in holder (at any depth): {item, holder} (holder being
            what holds it directly), or null. */
        findItem: function(holder, id) {
            let retval = null;
            for (const it of holder.inventory?.items ?? []) {
                retval = it.id === id ? {item:it, holder} : this.findItem(it, id);
                if (retval) break;
            }
            return retval;
        },
        
        /*  How many items of the kind with id kind holder holds (at any depth). */
        countOf: function(holder, kind) {
            return (holder.inventory?.items ?? [])
                .reduce((n, it) => n + (it.kind === kind ? it.count : 0) + this.countOf(it, kind), 0);
        },
        
        /*  Takes up to n items of the kind with id kind out of holder (at any depth, what
            it holds directly first). Returns how many it took. */
        removeKind: function(holder, kind, n) {
            let taken = 0;
            for (const it of [...holder.inventory?.items ?? []]) {
                if (taken < n && it.kind === kind) {
                    const m = Math.min(n - taken, it.count);
                    this.takeOut(holder, it, m);
                    taken += m;
                }
            }
            for (const it of holder.inventory?.items ?? []) {
                if (taken < n) taken += this.removeKind(it, kind, n - taken);
            }
            return taken;
        },
        
        /*  Puts in holder (whatever its limits) the items a list of them (see
            parseItemList) gives, how many of each rolled by rng, with what's in them. */
        rollItems: function(holder, list, rng) {
            for (const {kind, count:[min, max], contents} of list) {
                const n = min + Math.floor(rng() * (max - min + 1));
                if (contents.length) {
                    // Each its own, with what's in it
                    for (let i = 0; i < n; i++) {
                        const it = this.makeItem(kind);
                        this.rollItems(it, contents, rng);
                        this.addItem(holder, it, true);
                    }
                } else if (n > 0) {
                    this.addItem(holder, this.makeItem(kind, n), true);
                }
            }
        },
        
        // ---- The ground ----
        /*  What's on the ground at (x, y), a holder ({x, y, inventory}), or undefined if
            there's nothing; with make, one with nothing in it, kept. */
        groundAt: function(x, y, make = false) {
            const k = this.key(x, y);
            let g = this.ground.get(k);
            if (!g && make) this.ground.set(k, g = {x, y, inventory:{items:[]}});
            return g;
        },
        
        /*  The ground under piece p and next to it is let go of where there's nothing on it
            (after it's taken something from there). */
        tidyAround: function(p) {
            this.tidyGround(p.x, p.y);
            for (const [dx, dy] of pkg.hex.dirs) this.tidyGround(p.x + dx, p.y + dy);
        },
        
        /*  The ground at (x, y) is let go of if there's nothing on it. */
        tidyGround: function(x, y) {
            if (!this.groundAt(x, y)?.inventory.items.length) this.ground.delete(this.key(x, y));
        },
        
        /*  Puts item it in piece p's inventory, as much of it as fits: the rest falls on the
            ground under it. Returns how many p took. */
        giveItem: function(p, it) {
            const n = this.fitCount(p, it);
            if (n < it.count) {
                const rest = this.takeOut({inventory:{items:[it]}}, it, it.count - n);
                this.addItem(this.groundAt(p.x, p.y, true), rest, true);
            }
            if (n > 0) this.addItem(p, it, true);
            return n;
        },
        
        /*  Piece p has died: its remains are left on the ground where it was, its corpse
            (its species' corpse: see above) holding all it had, or with no corpse, what it
            had. Its corpse is named for it: by its name, if it has one, or its species'. */
        leaveRemains: function(p) {
            const species = pkg.species.get(p.species),
                corpse = species?.corpse ?? DEFAULT_CORPSE,
                ground = this.groundAt(p.x, p.y, true),
                had = p.inventory?.items ?? [];
            p.inventory = {items:[]};
            for (const it of had) delete it.equipped;
            if (corpse === NO_CORPSE) {
                for (const it of had) this.addItem(ground, it, true);
            } else {
                const c = this.makeItem(corpse),
                    into = c.inventory ? c : ground,
                    kindName = this.itemKind(c).name;
                c.expanded = true; // (what it had shows)
                c.name = p.name ? i18n('item-remains-of', p.name, kindName) :
                    species ? i18n('item-remains', species.name.toLowerCase(), kindName) : kindName;
                for (const it of had) this.addItem(into, it, true);
                this.addItem(ground, c, true);
            }
            this.tidyGround(p.x, p.y);
        },
        
        // ---- Gold ----
        /*  The gold your pieces carry. */
        goldHeld: function() {
            return this.piecesOf('player').reduce((n, p) => n + this.countOf(p, ITEM_GOLD), 0);
        },
        
        /*  Spends n of your gold (if you have it), from piece first's first, then from your
            other pieces', in order. Returns whether it did. */
        spendGold: function(n, first) {
            const done = this.goldHeld() >= n;
            if (done) {
                let left = n;
                for (const p of [first, ...this.piecesOf('player').filter(q => q !== first)]) {
                    if (p && left > 0) left -= this.removeKind(p, ITEM_GOLD, left);
                }
            }
            return done;
        },
        
        /*  Your core carries n gold, and your other pieces none (whatever it can carry):
            for tests, and trying things out. */
        setGold: function(n) {
            const core = this.getPlayerCore();
            for (const p of this.piecesOf('player')) this.removeKind(p, ITEM_GOLD, Infinity);
            if (core && n > 0) this.addItem(core, this.makeItem(ITEM_GOLD, n), true);
        },
        
        /*  Shows or hides, in the Inventory dialog, what's in the holder ref names, that
            piece p can get at (see reachHolder; shut or not): a container item (expanded:
            hidden unless it's true; a corpse's is, when it's left) or fixture (shown
            unless it's false). Saved with it. Not an action: it costs nothing. */
        toggleExpanded: function(p, ref) {
            if (typeof ref === 'number') {
                const it = this.reachItem(p, ref)?.item;
                if (it?.inventory) it.expanded = !it.expanded;
            } else {
                const top = this.reachHolders(p).find(t => t.ref === ref && t.ref.startsWith('fixture:'));
                if (top) top.holder.expanded = top.holder.expanded === false;
            }
        },
        
        // ---- Equipment ----
        /*  What piece p has equipped: what it carries (not in something it carries) that's
            equipped (equipped: true, saved). At most one in each slot (see equip). Its
            weapon's damage and penetration and its armor's armor count in a fight (see
            Combat.damageRange, penetrationOf and armorOf). */
        equipment: function(p) {return (p.inventory?.items ?? []).filter(it => it.equipped);},
        
        /*  What piece p has equipped in slot, or undefined. */
        equippedIn: function(p, slot) {return this.equipment(p).find(it => this.itemKind(it).equip?.slot === slot);},
        
        /*  Piece p equips what it carries that it can, each in a slot with nothing in it
            yet, in order (as an enemy does what its profile gives it). */
        equipAll: function(p) {
            for (const it of p.inventory?.items ?? []) {
                const slot = this.itemKind(it).equip?.slot;
                if (slot && !this.equippedIn(p, slot)) it.equipped = true;
            }
        },
        
        /*  Why piece p can't equip item id (or with unequip, unequip it): '' if it can,
            else 'over', 'player' (not yours), 'missing' (it doesn't carry it, not in
            something it carries), 'unequippable' (it can't be equipped), 'equipped' (or
            'unequipped': it already is), or 'ap' (not the points: see Combat.equipCostOf). */
        equipProblem: function(p, id, unequip = false) {
            const it = p?.owner === 'player' ? (p.inventory?.items ?? []).find(i => i.id === id) : null;
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!it) {
                retval = 'missing';
            } else if (!this.itemKind(it).equip) {
                retval = 'unequippable';
            } else if (!!it.equipped !== unequip) {
                retval = unequip ? 'unequipped' : 'equipped';
            } else if (!this.canAfford(p, this.equipCostOf(p, it))) {
                retval = 'ap';
            } else {
                retval = '';
            }
            return retval;
        },
        
        /*  Piece p equips item id (in place of what's in its slot), or with unequip,
            unequips it, for its kind's equip cost (see Combat.equipCostOf), if it can (see
            equipProblem). Returns whether it did. */
        playerEquip: function(p, id, unequip = false) {
            const done = !this.equipProblem(p, id, unequip);
            if (done) {
                const it = p.inventory.items.find(i => i.id === id);
                if (unequip) {
                    delete it.equipped;
                } else {
                    const was = this.equippedIn(p, this.itemKind(it).equip.slot);
                    if (was) delete was.equipped;
                    it.equipped = true;
                }
                this.fx(p.x, p.y, i18n(unequip ? 'fx-unequip' : 'fx-equip', this.itemLabel(it)), '--place-ink', {});
                this.spend(p, this.equipCostOf(p, it));
                this.afterPlayerAction();
            }
            return done;
        },
        
        // ---- Reach: what your pieces can get at ----
        /*  Whether fixture f's inventory can be got at now: its kind's access (a formula
            of its state) isn't 0 (a shut chest's is). */
        fixtureOpen: function(f) {return !!this.fixtureValue(f, 'access');},
        
        /*  The holders piece p can get at, each {ref, holder, open, dir}: itself (ref
            'piece'), the ground under it ('ground': with nothing on it, one that isn't
            kept), and the fixtures you know of with an inventory on its cell or next to it
            ('fixture:x,y'), open if they can be got at now (see fixtureOpen), and the ground
            next to it where something there holds things (a corpse: 'near:x,y',
            containersOnly: only those things, and what's in them, can be got at; nothing
            can be put there but in them). dir: where it is, an index into hex.dirs, or -1
            for p's own cell. */
        reachHolders: function(p) {
            const out = [
                {ref:'piece', holder:p, open:true, dir:-1},
                {ref:'ground', open:true, dir:-1, holder:this.groundAt(p.x, p.y) ?? {x:p.x, y:p.y, inventory:{items:[]}}}
            ];
            for (const [dir, [dx, dy]] of [[-1, [0, 0]], ...pkg.hex.dirs.map((d, i) => [i, d])]) {
                const f = this.fixtureAt(p.x + dx, p.y + dy);
                if (f?.inventory) {
                    out.push({ref:'fixture:' + this.key(f.x, f.y), holder:f, open:this.fixtureOpen(f), dir});
                }
            }
            // What holds things on the ground next to it (a corpse): only those, not what's
            // loose there.
            pkg.hex.dirs.forEach(([dx, dy], dir) => {
                const g = this.groundAt(p.x + dx, p.y + dy);
                if (g?.inventory.items.some(it => it.inventory)) {
                    out.push({ref:'near:' + this.key(g.x, g.y), holder:g, open:true, dir, containersOnly:true});
                }
            });
            return out;
        },
        
        /*  Item id, wherever piece p can get at it (not in a fixture that isn't open):
            {item, holder (what holds it), top (the reachHolders entry it's in)}, or
            null. */
        reachItem: function(p, id) {
            let retval = null;
            for (const top of this.reachHolders(p)) {
                let found = null;
                if (top.containersOnly) {
                    // (Only what holds things, and what's in them)
                    for (const it of top.holder.inventory.items) {
                        if (it.inventory) found ??= it.id === id ? {item:it, holder:top.holder} : this.findItem(it, id);
                    }
                } else if (top.open) {
                    found = this.findItem(top.holder, id);
                }
                if (found) {
                    retval = {...found, top};
                    break;
                }
            }
            return retval;
        },
        
        /*  The holder ref names, that piece p can get at (see reachHolders): 'piece',
            'ground', 'fixture:x,y' (one that's open), or an item's id (one with an
            inventory, wherever p can get at it); or null. */
        reachHolder: function(p, ref) {
            let retval;
            if (typeof ref === 'number') {
                const found = this.reachItem(p, ref);
                retval = found?.item.inventory ? found.item : null;
            } else {
                // (Not the ground next to it: what was put there it couldn't get at.)
                const top = this.reachHolders(p).find(t => t.ref === ref);
                retval = top?.open && !top.containersOnly ? top.holder : null;
            }
            return retval;
        },
        
        /*  Why piece p can't move item id (as much of it as fits: at least one) into the
            holder ref names (see reachHolder), for cost action points: '' if it can, else
            'over', 'player' (not yours), 'missing' (p can't get at it), 'nowhere' (or at
            that), 'there' (that's where it is), 'ap' (not the points), or why it doesn't
            fit (see addProblem: 'loop' for into itself). */
        moveProblem: function(p, id, ref, cost) {
            const found = p?.owner === 'player' ? this.reachItem(p, id) : null,
                to = found ? this.reachHolder(p, ref) : null;
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!found) {
                retval = 'missing';
            } else if (!to) {
                retval = 'nowhere';
            } else if (to === found.holder) {
                retval = 'there';
            } else if (!this.canAfford(p, cost)) {
                retval = 'ap';
            } else {
                retval = this.addProblem(to, found.item, 1);
            }
            return retval;
        },
        
        /** @private Piece p moves item id into the holder ref names, as much as fits, for
            cost action points (moveProblem has said it can). Returns what it moved, in
            words (see itemLabel). */
        _move: function(p, id, ref, cost) {
            const {item, holder} = this.reachItem(p, id),
                to = ref === 'ground' ? this.groundAt(p.x, p.y, true) : this.reachHolder(p, ref),
                n = this.fitCount(to, item),
                label = this.itemLabel(item, n);
            delete item.equipped; // (it's no longer carried as it was)
            this.addItem(to, this.takeOut(holder, item, n), true);
            this.tidyAround(p);
            this.spend(p, cost);
            return label;
        },
        
        /** @private Piece p moves item id into the holder ref names, for cost action
            points, if it can (see moveProblem), saying so with text (an I18N key). Returns
            whether it did. */
        _playerMove: function(p, id, ref, cost, text) {
            const done = !this.moveProblem(p, id, ref, cost);
            if (done) {
                this.fx(p.x, p.y, i18n(text, this._move(p, id, ref, cost)), '--place-ink', {});
                this.afterPlayerAction();
            }
            return done;
        },
        
        /*  Taking, dropping and transferring: piece p moves item id (wherever it can get
            at it: see reachItem), as much of it as fits, into its own inventory (take),
            onto the ground under it (drop), or into the holder ref names (transfer: see
            reachHolder), for the takeCost, dropCost or transferCost rule's action points.
            The problems say why it can't ('' if it can: see moveProblem); the rest do it,
            if it can, and return whether they did. */
        takeProblem: function(p, id) {return this.moveProblem(p, id, 'piece', this.takeCost(p));},
        dropProblem: function(p, id) {return this.moveProblem(p, id, 'ground', this.dropCost(p));},
        transferProblem: function(p, id, ref) {return this.moveProblem(p, id, ref, this.transferCost(p));},
        playerTake: function(p, id) {return this._playerMove(p, id, 'piece', this.takeCost(p), 'fx-take');},
        playerDrop: function(p, id) {return this._playerMove(p, id, 'ground', this.dropCost(p), 'fx-drop');},
        playerTransfer: function(p, id, ref) {return this._playerMove(p, id, ref, this.transferCost(p), 'fx-transfer');},
        
        /*  Why piece p can't take all that's in the holder ref names (see reachHolder; not
            itself): '' if it can take something of it, else 'over', 'player', 'nowhere',
            'empty', 'ap', or why the first thing in it doesn't fit (see addProblem). */
        takeAllProblem: function(p, ref) {
            const from = p?.owner === 'player' && ref !== 'piece' ? this.reachHolder(p, ref) : null,
                items = from?.inventory?.items ?? [];
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!from) {
                retval = 'nowhere';
            } else if (!items.length) {
                retval = 'empty';
            } else if (!this.canAfford(p, this.takeCost(p))) {
                retval = 'ap';
            } else {
                retval = items.some(it => !this.addProblem(p, it, 1)) ? '' : this.addProblem(p, items[0], 1);
            }
            return retval;
        },
        
        /*  Piece p takes all that's in the holder ref names (not what's in what's in it),
            in order, each as a take (as much as fits, for the takeCost rule's action
            points), for as long as it has the points: what doesn't fit, it leaves. Returns
            whether it took anything. */
        playerTakeAll: function(p, ref) {
            const done = !this.takeAllProblem(p, ref);
            if (done) {
                const from = this.reachHolder(p, ref),
                    cost = this.takeCost(p),
                    took = [];
                for (const it of [...from.inventory.items]) {
                    if (this.canAfford(p, cost) && !this.addProblem(p, it, 1)) {
                        took.push(this._move(p, it.id, 'piece', cost));
                    }
                }
                this.fx(p.x, p.y, i18n('fx-take', took.join(', ')), '--place-ink', {});
                this.afterPlayerAction();
            }
            return done;
        },
        
        // ---- Eating and drinking ----
        /*  The fluid on the floor at (x, y) (a stream's, a pool's: see Solids.js): {floor,
            fluid (its item kind's id)}, or null. */
        fluidAt: function(x, y) {
            const t = this.tiles.get(this.key(x, y)),
                floor = t ? (t.kind === TILE_TYPE_FLOOR ? pkg.floors.get(t.subtype) : null) : this.baseFloor();
            return floor?.fluid ? {floor, fluid:floor.fluid} : null;
        },
        
        /*  The fluids piece p can get at: on its cell and next to it, each {ref
            ('source:x,y'), x, y, dir (as reachHolders'), floor, fluid}. */
        fluidSources: function(p) {
            const out = [];
            for (const [dir, [dx, dy]] of [[-1, [0, 0]], ...pkg.hex.dirs.map((d, i) => [i, d])]) {
                const x = p.x + dx, y = p.y + dy, at = this.fluidAt(x, y);
                if (at) out.push({ref:'source:' + this.key(x, y), x, y, dir, ...at});
            }
            return out;
        },
        
        /*  Whether a kind can be eaten or drunk: it quenches, satiates, heals or rests
            (some species, at least). */
        isConsumable: function(kind) {
            return !!kind && CONSUME_EFFECTS.some(e => Object.values(kind[e] ?? {}).some(Boolean));
        },
        
        /*  What eating or drinking n of a kind (a dose of it, if not given) would do for
            piece p, by its species (see parseItem: its own, else the nearest it extends,
            else "*"): {quench, satiates, heals, rests}, in points (as much less as n is
            less than a dose). */
        consumeEffects: function(p, kind, n = kind.dose) {
            const lineage = pkg.species.lineage(p.species),
                of = table => (table[lineage.find(id => id in table)] ?? table['*'] ?? 0) * n / kind.dose;
            return Object.fromEntries(CONSUME_EFFECTS.map(e => [e, of(kind[e] ?? {})]));
        },
        
        /** @private Piece p eats or drinks n of a kind (see consumeEffects): its thirst goes
            by its quench, its hunger by its satiates, its fatigue by its rests (see
            Needs.js), and its HP by its heals (see Needs.changeHp: it can kill it). */
        _consume: function(p, kind, n) {
            const {quench, satiates, heals, rests} = this.consumeEffects(p, kind, n);
            this.changeNeed(p, 'thirst', NEED_UNIT * quench);
            this.changeNeed(p, 'hunger', NEED_UNIT * satiates);
            this.changeNeed(p, 'fatigue', NEED_UNIT * rests);
            if (heals) this.changeHp(p, heals);
        },
        
        /*  What piece p would eat or drink for item id (wherever it can get at it): it, or
            if it holds fluids (a flask), what's in it (drinking from it), {item, holder};
            {item:null} for an empty flask; or null if p can't get at it. */
        consumeTarget: function(p, id) {
            const found = this.reachItem(p, id);
            return found && this.itemKind(found.item).inventory?.fluids ?
                {item:found.item.inventory.items[0] ?? null, holder:found.item} : found;
        },
        
        /*  Why piece p can't eat or drink item id (wherever it can get at it: a dose of it,
            or what's left; for a flask, what's in it): '' if it can, else 'over', 'player',
            'missing', 'empty' (a flask with nothing in it), 'inedible' (it can't be eaten
            or drunk), 'needless' (p has no needs) or 'ap'. */
        consumeProblem: function(p, id) {
            const found = p?.owner === 'player' ? this.consumeTarget(p, id) : null;
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!found) {
                retval = 'missing';
            } else if (!found.item) {
                retval = 'empty';
            } else if (!this.isConsumable(this.itemKind(found.item))) {
                retval = 'inedible';
            } else if (!p.needs) {
                retval = 'needless';
            } else if (!this.canAfford(p, this.consumeCostOf(p, found.item))) {
                retval = 'ap';
            } else {
                retval = '';
            }
            return retval;
        },
        
        /*  Piece p eats or drinks item id (a dose of it, or what's left), for its consume
            cost, if it can (see consumeProblem). Returns whether it did. */
        playerConsume: function(p, id) {
            const done = !this.consumeProblem(p, id);
            if (done) {
                const {item, holder} = this.consumeTarget(p, id),
                    kind = this.itemKind(item),
                    n = Math.min(kind.dose, item.count),
                    cost = this.consumeCostOf(p, item);
                this.fx(p.x, p.y, i18n(kind.fluid ? 'fx-drink' : 'fx-eat', this.itemLabel(item, n)), '--heal', {});
                this.takeOut(holder, item, n);
                this.tidyAround(p);
                this.spend(p, cost);
                this._consume(p, kind, n); // (last: it can kill p)
                this.afterPlayerAction();
            }
            return done;
        },
        
        /*  Why piece p can't drink from the fluid source ref names (see fluidSources: a
            dose of its fluid): '' if it can, else 'over', 'player', 'nowhere' (it isn't in
            reach), 'inedible', 'needless' or 'ap' (the consumeCost rule's, or its fluid's). */
        drinkProblem: function(p, ref) {
            const source = p?.owner === 'player' ? this.fluidSources(p).find(s => s.ref === ref) : null,
                kind = source ? pkg.items.get(source.fluid) : null;
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!source) {
                retval = 'nowhere';
            } else if (!this.isConsumable(kind)) {
                retval = 'inedible';
            } else if (!p.needs) {
                retval = 'needless';
            } else if (!this.canAfford(p, this.consumeCostOf(p, {kind:source.fluid}))) {
                retval = 'ap';
            } else {
                retval = '';
            }
            return retval;
        },
        
        /*  Piece p drinks a dose from the fluid source ref names, if it can (see
            drinkProblem). Returns whether it did. */
        playerDrink: function(p, ref) {
            const done = !this.drinkProblem(p, ref);
            if (done) {
                const {fluid} = this.fluidSources(p).find(s => s.ref === ref),
                    kind = pkg.items.get(fluid);
                this.fx(p.x, p.y, i18n('fx-drink', this.itemLabel({kind:fluid, count:kind.dose})), '--heal', {});
                this.spend(p, this.consumeCostOf(p, {kind:fluid}));
                this._consume(p, kind, kind.dose);
                this.afterPlayerAction();
            }
            return done;
        },
        
        /*  Why piece p can't fill item id (a flask: something that holds fluids, that it can
            get at) from a fluid source it can get at (the first: see fluidSources): '' if
            it can (with at least a millilitre), else 'over', 'player', 'missing', 'unfillable'
            (it doesn't hold fluids), 'dry' (there's no source in reach), 'ap' (the fillCost
            rule's), or why the fluid doesn't fit (see addProblem). */
        fillProblem: function(p, id) {
            const found = p?.owner === 'player' ? this.reachItem(p, id) : null,
                source = found ? this.fluidSources(p)[0] : null;
            let retval;
            if (this.over) {
                retval = 'over';
            } else if (p?.owner !== 'player') {
                retval = 'player';
            } else if (!found) {
                retval = 'missing';
            } else if (!this.itemKind(found.item).inventory?.fluids) {
                retval = 'unfillable';
            } else if (!source) {
                retval = 'dry';
            } else if (!this.canAfford(p, this.fillCost(p))) {
                retval = 'ap';
            } else {
                retval = this.addProblem(found.item, {id:-1, kind:source.fluid, count:1}, 1);
            }
            return retval;
        },
        
        /*  Piece p fills item id from the first fluid source in reach, as full as it'll go,
            for the fillCost rule's action points, if it can (see fillProblem). Returns
            whether it did. */
        playerFill: function(p, id) {
            const done = !this.fillProblem(p, id);
            if (done) {
                const {item} = this.reachItem(p, id),
                    {fluid} = this.fluidSources(p)[0],
                    n = this.fitCount(item, {id:-1, kind:fluid, count:1e9});
                this.addItem(item, this.makeItem(fluid, n), true);
                this.fx(p.x, p.y, i18n('fx-fill', this.itemLabel(item), this.itemLabel({kind:fluid, count:n})), '--heal', {});
                this.spend(p, this.fillCost(p));
                this.afterPlayerAction();
            }
            return done;
        }
    });
})(hc);
