/*  What makes a map: its tile generator, which chooses and places its tiles, and its
    spawn generator, which chooses and places its enemies. A map names one of each (for now
    every map uses "proximity"; see ProximityTileGenerator.js and ProximitySpawnGenerator.js).
    
    A generator belongs to one game, and the game calls it at set points (the methods
    below). Anything else it keeps is its own, saved with the game (exportState /
    importState). Each kind of generator is registered by name with its base class
    (register), and made by name (make). */
(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        NOOP = myt.NOOP,
        
        /*  What tile and spawn generators have in common. */
        Generator = pkg.Generator = new JSClass('Generator', {
            // Class Methods and Attributes ////////////////////////////////////
            extend: {
                /*  Registers Type, a subclass, under name: make(name, game) makes one. */
                register: function(name, Type) {
                    this.types[name] = Type;
                },
                
                /*  Makes a generator of the type registered under name, for game (its `type` is
                    the name). Throws for an unknown name. */
                make: function(name, game) {
                    const Type = this.types[name];
                    if (!Type) throw new Error('Unknown ' + this.KIND + ' ' + name);
                    const generator = new Type(game);
                    generator.type = name;
                    return generator;
                }
            },
            
            // Life Cycle //////////////////////////////////////////////////////
            initialize: function(game) {
                this.game = game;
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
        /*  The radius of the grid's chunks (quadrants) in this map, fixed for the whole game.
            (See Grid.js.) */
        chunkRadius: () => pkg.cfg.QUAD.radius,
        
        /*  A new game: the tiles there from the start. Your core is in place. */
        start: NOOP, // function() {},
        
        /*  Your pieces have moved (or one was placed): the tiles they now need. */
        piecesMoved: NOOP // function() {}
    });
    
    pkg.SpawnGenerator = new JSClass('SpawnGenerator', Generator, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'spawn generator',
            types:{} // name -> SpawnGenerator subclass (see register)
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  A new game: the enemies there from the start. Your core and the starting tiles
            are in place. */
        start: NOOP, // function() {},
        
        /*  A new turn has begun (the enemies have moved and the turn count gone up). */
        turnEnded: NOOP // function() {}
    });
})(hc);
