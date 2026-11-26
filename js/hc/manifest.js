JS.Packages(file => {
    const HC_ROOT = globalThis.HC_ROOT ?? '',
        COMPONENT_ROOT = HC_ROOT + 'component/',
        MODEL_ROOT = HC_ROOT + 'model/',
        MAP_ROOT = MODEL_ROOT + 'map/',
        MAP_TILE_ROOT = MAP_ROOT + 'tile/',
        MAP_SPAWN_ROOT = MAP_ROOT + 'spawn/',
        MAP_ENEMY_AI_ROOT = MAP_ROOT + 'enemy_ai/',
        TILE_ROOT = MODEL_ROOT + 'tile/',
        VIEW_ROOT = HC_ROOT + 'view/';
    
    file(HC_ROOT + 'hc.js').provides('hc','hc.theme','hc.cfg');
    
    file(HC_ROOT + '../../lib/json5.min.js').provides('JSON5');
    
    
    // Component //
    file(COMPONENT_ROOT + 'Misc.js').provides(
        'hc.WideView','hc.Spacer','hc.Panel','hc.LabeledValue'
    ).requires('hc.theme');
    file(COMPONENT_ROOT + 'Btn.js').provides(
        'hc.Btn','hc.UnderlineBtn','hc.SquareBtn','hc.IconBtn','hc.ToggleBtn'
    ).requires('hc.theme');
    file(COMPONENT_ROOT + 'Dialogs.js').provides(
        'hc.dialogUtil','hc.ModalDialog','hc.AckDialog','hc.ConfirmDialog'
    ).requires('hc.IconBtn','hc.UnderlineBtn','hc.Spacer','hc.WideView','hc.Panel');
    
    
    // Model //
    file(MODEL_ROOT + 'Grid.js').provides('hc.hex','hc.makeChunks','hc.hexDist').requires('hc.cfg');
    file(MODEL_ROOT + 'PieceTypes.js').provides('hc.PIECE_TYPES').requires('hc.hex');
    file(MODEL_ROOT + 'Movement.js').provides('hc.Movement','hc.MOVE_MODES','hc.PLAYER_MOVE_MODES').requires('hc.hex','hc.EFFECT_EXHAUSTED');
    file(MODEL_ROOT + 'Navigation.js').provides('hc.Navigation').requires('hc.hex','hc.cfg','hc.AP_UNIT');
    file(MODEL_ROOT + 'Formation.js').provides('hc.Formation').requires('hc.hexDist');
    file(MODEL_ROOT + 'Expr.js').provides('hc.expr').requires('hc');
    file(MODEL_ROOT + 'Goals.js').provides('hc.goals','hc.Goals').requires('hc.hex','hc.expr');
    file(MODEL_ROOT + 'Attrs.js').provides('hc.attrs').requires('hc');
    
    // Tile
    file(TILE_ROOT + 'Subtypes.js').provides('hc.Subtypes').requires('hc');
    file(TILE_ROOT + 'Solids.js').provides('hc.solids','hc.holes','hc.floors','hc.defineShadow').requires('hc.Subtypes','hc.cfg');
    file(TILE_ROOT + 'Fixtures.js').provides('hc.Fixtures','hc.fixtures','hc.fixtureOptions','hc.FIXTURE_TYPES','hc.FIXTURE_HEAL','hc.FIXTURE_HARM','hc.FIXTURE_LOOT','hc.FIXTURE_FEATURE').requires('hc.Subtypes','hc.hexDist','hc.attrs','hc.solids');
    
    // Map
    file(MAP_ROOT + 'MapComponent.js').provides('hc.MapComponent').requires('hc.attrs');
    file(MAP_ROOT + 'Maps.js').provides('hc.maps').requires('hc.cfg','JSON5','hc.goals','hc.solids','hc.Fixtures','hc.effects','hc.defineEnemies','hc.settings','hc.ProximityTileGenerator','hc.CavernsTileGenerator','hc.ProximitySpawnGenerator','hc.SquadAI');
    file(MAP_ROOT + 'Generators.js').provides('hc.TileGenerator','hc.SpawnGenerator').requires('hc.MapComponent','hc.enemyTrees','hc.hex','hc.hexDist');
    
    // Map Spawn Generators
    file(MAP_SPAWN_ROOT + 'ProximitySpawnGenerator.js').provides('hc.ProximitySpawnGenerator').requires('hc.SpawnGenerator','hc.hexDist');
    file(MAP_SPAWN_ROOT + 'CavernsSpawnGenerator.js').provides('hc.CavernsSpawnGenerator').requires('hc.SpawnGenerator','hc.hexDist','hc.attrs','hc.enemies');
    
    // Map Tile Generators
    file(MAP_TILE_ROOT + 'ProximityTileGenerator.js').provides('hc.ProximityTileGenerator').requires('hc.TileGenerator','hc.makeChunks','hc.solids','hc.Fixtures','hc.hexDist');
    file(MAP_TILE_ROOT + 'CavernsTileGenerator.js').provides('hc.CavernsTileGenerator').requires('hc.TileGenerator','hc.makeChunks','hc.solids','hc.Fixtures');
    
    // Map EnemyAI Generators
    file(MAP_ENEMY_AI_ROOT + 'EnemyAI.js').provides('hc.EnemyAI').requires('hc.MapComponent');
    file(MAP_ENEMY_AI_ROOT + 'SquadAI.js').provides('hc.SquadAI').requires('hc.EnemyAI','hc.hex','hc.PIECE_TYPES');
    
    file(MODEL_ROOT + 'Effects.js').provides('hc.Effects','hc.effects','hc.EFFECT_EXHAUSTED','hc.EFFECT_RALLYING','hc.EFFECT_RALLIED').requires('hc.Subtypes');
    file(MODEL_ROOT + 'Combat.js').provides('hc.Combat','hc.species','hc.backgrounds','hc.enemies','hc.STATS','hc.STAT_VARS','hc.XP_VARS','hc.MULTI_KILL_VARS','hc.AP_UNIT','hc.XP_UNIT','hc.DAMAGE_VARS').requires('hc.Subtypes','hc.attrs','hc.EFFECT_EXHAUSTED','hc.EFFECT_RALLYING','hc.EFFECT_RALLIED');
    file(MODEL_ROOT + 'Enemies.js').provides('hc.enemyGroups','hc.defineEnemies','hc.enemyTrees').requires('hc.Subtypes','hc.enemies');
    file(MODEL_ROOT + 'Game.js').provides('hc.Game').requires('hc.hex','hc.PIECE_TYPES','hc.Movement','hc.Navigation','hc.Formation','hc.Combat','hc.Goals','hc.solids','hc.Fixtures','hc.Effects','hc.settings','hc.ProximityTileGenerator','hc.CavernsTileGenerator','hc.ProximitySpawnGenerator','hc.CavernsSpawnGenerator','hc.SquadAI');
    file(MODEL_ROOT + 'Settings.js').provides('hc.settings','hc.COST_VARS').requires('hc.cfg','hc.attrs','hc.PLAYER_MOVE_MODES','hc.STAT_VARS','hc.XP_VARS','hc.MULTI_KILL_VARS','hc.DAMAGE_VARS');
    file(MODEL_ROOT + 'Persistence.js').provides('hc.PersistenceManager').requires('hc.Game');
    
    
    // View //
    file(VIEW_ROOT + 'View.js').provides('hc.view').requires('hc.Game','hc.settings');
    file(VIEW_ROOT + 'Render.js').provides('hc.view.render').requires('hc.view');
    file(VIEW_ROOT + 'GameView.js').provides('hc.GameView').requires('hc.view.render','hc.LabeledValue');
    file(VIEW_ROOT + 'SettingsDialog.js').provides('hc.SettingsDialog','hc.SettingsList').requires(
        'hc.AckDialog','hc.settings','hc.ToggleBtn','hc.WideView'
    );
    file(VIEW_ROOT + 'MapsDialog.js').provides('hc.MapsDialog').requires(
        'hc.AckDialog','hc.maps','hc.UnderlineBtn','hc.WideView'
    );
    file(VIEW_ROOT + 'PieceMenu.js').provides('hc.PieceMenu').requires('hc.Btn','hc.theme');
    file(VIEW_ROOT + 'MapBrief.js').provides('hc.MapBrief').requires(
        'hc.ConfirmDialog','hc.WideView'
    );
    file(VIEW_ROOT + 'CharacterSheet.js').provides('hc.CharacterSheet').requires(
        'hc.ConfirmDialog','hc.WideView','hc.IconBtn','hc.STATS'
    );
    
    // Development only: not required by the App (see index.html's ?dev, and tools/sim.mjs).
    file(HC_ROOT + 'dev/Simulate.js').provides('hc.simulate').requires('hc.Game','hc.maps','hc.settings','hc.SpawnGenerator','hc.attrs','hc.hexDist');
    
    // Include Everything
    file(HC_ROOT + 'App.js').provides('hc.App').requires(
        'hc.GameView','hc.SettingsDialog','hc.MapsDialog','hc.MapBrief','hc.CharacterSheet','hc.PieceMenu','hc.dialogUtil','hc.Btn','hc.LabeledValue','hc.PersistenceManager'
    );
});
