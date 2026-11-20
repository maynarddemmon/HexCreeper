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
    file(MODEL_ROOT + 'Grid.js').provides('hc.makeGrid','hc.hexDist').requires('hc.cfg');
    file(MODEL_ROOT + 'PieceTypes.js').provides('hc.PIECE_TYPES').requires('hc.makeGrid');
    file(MODEL_ROOT + 'Game.js').provides('hc.Game').requires('hc.makeGrid','hc.PIECE_TYPES');
    file(MODEL_ROOT + 'EnemyAI.js').provides('hc.Game.prototype.planSquad').requires('hc.Game');
    file(MODEL_ROOT + 'Settings.js').provides('hc.settings').requires('hc.cfg');
    file(MODEL_ROOT + 'Persistence.js').provides('hc.PersistenceManager').requires('hc.Game');
    file(HC_ROOT + '../../lib/json5.min.js').provides('JSON5');
    file(MODEL_ROOT + 'Levels.js').provides('hc.levels').requires('hc.cfg','JSON5');
    
    // View //
    file(VIEW_ROOT + 'View.js').provides('hc.view').requires('hc.Game','hc.Game.prototype.planSquad','hc.settings');
    file(VIEW_ROOT + 'Render.js').provides('hc.view.render').requires('hc.view');
    file(VIEW_ROOT + 'GameView.js').provides('hc.GameView').requires('hc.view.render','hc.LabeledValue');
    file(VIEW_ROOT + 'SettingsDialog.js').provides('hc.SettingsDialog','hc.SettingsList').requires(
        'hc.AckDialog','hc.settings','hc.ToggleBtn','hc.UnderlineBtn','hc.WideView'
    );
    file(VIEW_ROOT + 'LevelsDialog.js').provides('hc.LevelsDialog').requires(
        'hc.AckDialog','hc.levels','hc.UnderlineBtn','hc.WideView'
    );
    file(VIEW_ROOT + 'LevelBrief.js').provides('hc.LevelBrief').requires(
        'hc.ConfirmDialog','hc.SettingsList','hc.WideView'
    );
    
    // Include Everything
    file(HC_ROOT + 'App.js').provides('hc.App').requires(
        'hc.GameView','hc.SettingsDialog','hc.LevelsDialog','hc.LevelBrief','hc.dialogUtil','hc.Btn','hc.LabeledValue','hc.PersistenceManager'
    );
});
