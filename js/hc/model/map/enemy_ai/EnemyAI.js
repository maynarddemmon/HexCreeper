/*  A map's enemy AI (a map component: see MapComponent.js), which plays the enemies' turn
    (so far there's one, "squad": see SquadAI.js). The game calls it at the point below. */
(pkg => {
    'use strict';
    
    pkg.EnemyAI = new JS.Class('EnemyAI', pkg.MapComponent, {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            KIND:'enemy AI',
            types:{} // name -> EnemyAI subclass (see register)
        },
        
        // Methods /////////////////////////////////////////////////////////////
        /*  The enemies' turn: each enemy piece may act. The game animates what they do (see
            Game.enemyPhase). */
        takeTurn: myt.NOOP // function() {}
    });
})(hc);
