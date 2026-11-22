/*  A map's generators (map components: see MapComponent.js): its tile generator, which
    chooses and places its tiles, and its spawn generator, which chooses and places its
    enemies (so far there's one of each, "proximity": see ProximityTileGenerator.js and
    ProximitySpawnGenerator.js). The game calls them at the points below. */
(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        NOOP = myt.NOOP,
        
        MapComponent = pkg.MapComponent;
    
    pkg.TileGenerator = new JSClass('TileGenerator', MapComponent, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'tile generator', // what they are, for error messages
            types:{} // name -> TileGenerator subclass (see register)
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  A new game: the tiles there from the start. Your core is in place. */
        start: NOOP, // function() {},
        
        /*  Your pieces have moved (or one was placed): the tiles they now need. */
        piecesMoved: NOOP // function() {}
    });
    
    pkg.SpawnGenerator = new JSClass('SpawnGenerator', MapComponent, {
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
