/*  A part of what makes a map: its tile generator, its spawn generator (Generators.js) or
    its enemy AI (EnemyAI.js). A map names one of each by type, and gives values for that
    type's attrs (see Maps.js).
    
    A component belongs to one game, and the game calls it at set points (its base class's
    methods). Anything else it keeps is its own, saved with the game (exportState /
    importState). Each type is registered by name with its base class (register), and
    made by name (make).
    
    A component is tuned by its attrs: its class declares them, with their defaults, in
    ATTRS (see Attrs.js), and a map gives values for them. A component's attrs, all of
    them, are in this.attrs. */
(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        NOOP = myt.NOOP,
        
        {attrs:{resolve}} = pkg;
    
    pkg.MapComponent = new JSClass('MapComponent', {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            ATTRS:[], // the attrs a component of the class takes (see Attrs.js)
            
            /*  Registers Type, a subclass, under name: make(name, game) makes one. */
            register: function(name, Type) {
                this.types[name] = Type;
            },
            
            /*  Whether a type is registered under name. */
            has: function(name) {
                return Object.hasOwn(this.types, name);
            },
            
            /*  Makes a component of the type registered under name, for game, with the
                attrs given ({id:value}; the rest at their defaults). Its `type` is the
                name. Throws for an unknown name. */
            make: function(name, game, attrs) {
                if (!this.has(name)) throw new Error('Unknown ' + this.KIND + ' ' + name);
                const component = new this.types[name](game, attrs);
                component.type = name;
                return component;
            },
            
            /*  The attrs given for a component of the type registered under name, made
                usable: only those given, with any that can't be used skipped with a
                warning saying where. */
            cleanAttrs: function(name, attrs, where) {
                return resolve(this.types[name].ATTRS, attrs, where, true);
            }
        },
        
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, attrs) {
            this.game = game;
            this.attrs = resolve(this.klass.ATTRS, attrs, this.klass.KIND);
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  What it keeps, as JSON-ready data, and back again (throwing if it's malformed). */
        exportState: () => ({}),
        importState: NOOP // function(_state) {}
    });
})(hc);
