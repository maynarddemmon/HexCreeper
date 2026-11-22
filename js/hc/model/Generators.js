/*  What makes a map: its tile generator, which chooses and places its tiles, and its
    spawn generator, which chooses and places its enemies. A map names one of each (for now
    every map uses "proximity"; see ProximityTileGenerator.js and ProximitySpawnGenerator.js).
    
    A generator belongs to one game, and the game calls it at set points (the methods
    below). Anything else it keeps is its own, saved with the game (exportState /
    importState). Each kind of generator is registered by name with its base class
    (register), and made by name (make).
    
    A generator is tuned by its attrs: its class declares them, with their defaults, in
    ATTRS (see Attrs.js), and a map gives values for them (see Maps.js). A generator's
    attrs, all of them, are in this.attrs. */
(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        NOOP = myt.NOOP,
        
        {attrs:{num, resolve}} = pkg,
        
        /*  What tile and spawn generators have in common. */
        Generator = pkg.Generator = new JSClass('Generator', {
            // Class Methods and Attributes ////////////////////////////////////
            extend: {
                ATTRS:[], // the attrs a generator of the class takes (see Attrs.js)
                
                /*  Registers Type, a subclass, under name: make(name, game) makes one. */
                register: function(name, Type) {
                    this.types[name] = Type;
                },
                
                /*  Whether a type is registered under name. */
                has: function(name) {
                    return Object.hasOwn(this.types, name);
                },
                
                /*  Makes a generator of the type registered under name, for game, with the
                    attrs given ({id:value}; the rest at their defaults). Its `type` is the
                    name. Throws for an unknown name. */
                make: function(name, game, attrs) {
                    if (!this.has(name)) throw new Error('Unknown ' + this.KIND + ' ' + name);
                    const generator = new this.types[name](game, attrs);
                    generator.type = name;
                    return generator;
                },
                
                /*  The attrs given for a generator of the type registered under name, made
                    usable: only those given, with any that can't be used skipped with a
                    warning saying where. */
                cleanAttrs: function(name, attrs, where) {
                    return resolve(this.types[name].ATTRS, attrs, where, true);
                }
            },
            
            // Life Cycle //////////////////////////////////////////////////////
            initialize: function(game, attrs) {
                this.game = game;
                this.attrs = resolve(this.klass.ATTRS, attrs, this.klass.KIND);
            },
            
            // Methods /////////////////////////////////////////////////////////
            /*  What it keeps, as JSON-ready data, and back again (throwing if it's malformed). */
            exportState: () => ({}),
            importState: NOOP // function(_state) {}
        });
    
    pkg.TileGenerator = new JSClass('TileGenerator', Generator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'tile generator', // what they are, for error messages
            types:{} // name -> TileGenerator subclass (see register)
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  The radius of the grid's chunks (quadrants) in this map, fixed for the whole game
            (see Grid.js). Only a generator that uses quadrants cares. */
        chunkRadius: () => 1,
        
        /*  A new game: the tiles there from the start. Your core is in place. */
        start: NOOP, // function() {},
        
        /*  Your pieces have moved (or one was placed): the tiles they now need. */
        piecesMoved: NOOP // function() {}
    });
    
    pkg.SpawnGenerator = new JSClass('SpawnGenerator', Generator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'spawn generator',
            types:{}, // name -> SpawnGenerator subclass (see register)
            
            // What the enemies are like, whatever spawns them. (These may move to enemy
            // subtypes one day.)
            ATTRS:[
                num('aiExpose', 12, 0, 50),   // caution: how much a squad minds leaving pieces next to yours (see AI.expose)
                num('aiPatience', 2, 1, 20),  // turns without a hit before a nearby squad stops minding
                num('enemyHpPer', 1, 1, 20),  // enemy max HP = this x its rank
                num('maxSquad', 16, 1, 31)    // the largest a squad can be
            ]
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  A new game: the enemies there from the start. Your core and the starting tiles
            are in place. */
        start: NOOP, // function() {},
        
        /*  A new turn has begun (the enemies have moved and the turn count gone up). */
        turnEnded: NOOP // function() {}
    });
})(hc);
