JS.Packages(file => {
    const HC_ROOT = globalThis.HC_ROOT ?? '',
        COMPONENT_ROOT = HC_ROOT + 'component/',
        MODEL_ROOT = HC_ROOT + 'model/',
        VIEW_ROOT = HC_ROOT + 'view/';
    
    file(HC_ROOT + 'hc.js').provides('hc','hc.theme','hc.cfg');
    
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
    file(MODEL_ROOT + 'Movement.js').provides('hc.Movement','hc.MOVE_MODES','hc.PLAYER_MOVE_MODES').requires('hc.hex');
    file(MODEL_ROOT + 'Navigation.js').provides('hc.Navigation').requires('hc.hex','hc.cfg');
    file(MODEL_ROOT + 'Formation.js').provides('hc.Formation').requires('hc.hexDist');
    file(MODEL_ROOT + 'Expr.js').provides('hc.expr').requires('hc');
    file(MODEL_ROOT + 'Goals.js').provides('hc.goals','hc.Goals').requires('hc.hex','hc.expr');
    file(MODEL_ROOT + 'Attrs.js').provides('hc.attrs').requires('hc');
    file(MODEL_ROOT + 'Subtypes.js').provides('hc.Subtypes').requires('hc');
    file(MODEL_ROOT + 'Solids.js').provides('hc.solids','hc.holes').requires('hc.Subtypes');
    file(MODEL_ROOT + 'EffectTiles.js').provides('hc.EffectTiles','hc.heals','hc.harms','hc.loots').requires('hc.Subtypes','hc.hexDist');
    file(MODEL_ROOT + 'MapComponent.js').provides('hc.MapComponent').requires('hc.attrs');
    file(MODEL_ROOT + 'Generators.js').provides('hc.TileGenerator','hc.SpawnGenerator').requires('hc.MapComponent');
    file(MODEL_ROOT + 'ProximityTileGenerator.js').provides('hc.ProximityTileGenerator').requires('hc.TileGenerator','hc.makeChunks','hc.solids','hc.EffectTiles');
    file(MODEL_ROOT + 'CavernsTileGenerator.js').provides('hc.CavernsTileGenerator').requires('hc.TileGenerator','hc.makeChunks','hc.solids','hc.EffectTiles');
    file(MODEL_ROOT + 'ProximitySpawnGenerator.js').provides('hc.ProximitySpawnGenerator').requires('hc.SpawnGenerator','hc.hexDist');
    file(MODEL_ROOT + 'EnemyAI.js').provides('hc.EnemyAI').requires('hc.MapComponent');
    file(MODEL_ROOT + 'SquadAI.js').provides('hc.SquadAI').requires('hc.EnemyAI','hc.hex','hc.PIECE_TYPES');
    file(MODEL_ROOT + 'Game.js').provides('hc.Game').requires('hc.hex','hc.PIECE_TYPES','hc.Movement','hc.Navigation','hc.Formation','hc.Goals','hc.solids','hc.EffectTiles','hc.settings','hc.ProximityTileGenerator','hc.CavernsTileGenerator','hc.ProximitySpawnGenerator','hc.SquadAI');
    file(MODEL_ROOT + 'Settings.js').provides('hc.settings').requires('hc.cfg','hc.attrs','hc.PLAYER_MOVE_MODES');
    file(MODEL_ROOT + 'Persistence.js').provides('hc.PersistenceManager').requires('hc.Game');
    file(HC_ROOT + '../../lib/json5.min.js').provides('JSON5');
    file(MODEL_ROOT + 'Maps.js').provides('hc.maps').requires('hc.cfg','JSON5','hc.goals','hc.solids','hc.EffectTiles','hc.settings','hc.ProximityTileGenerator','hc.CavernsTileGenerator','hc.ProximitySpawnGenerator','hc.SquadAI');
    
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
    
    // Include Everything
    file(HC_ROOT + 'App.js').provides('hc.App').requires(
        'hc.GameView','hc.SettingsDialog','hc.MapsDialog','hc.MapBrief','hc.PieceMenu','hc.dialogUtil','hc.Btn','hc.LabeledValue','hc.PersistenceManager'
    );
});
