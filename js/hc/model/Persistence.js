(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}, downloadObjectAsJSON} = myt,
        
        SAVE_FORMAT_VERSION = 1,
        DEFAULT_STORAGE_KEY = 'hc.save',
        
        isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        readStorage = key => {
            try {
                const txt = localStorage.getItem(key);
                return txt ? JSON.parse(txt) : null;
            } catch (err) {
                console.warn('Unable to read save', key, err);
                return null;
            }
        },
        
        /*  A save record of the game as it is now. */
        prepareRecord = game => ({
            version:SAVE_FORMAT_VERSION,
            savedAt:new Date().toISOString(),
            data:game.exportToObj()
        }),
        
        /*  Returns why a record can't be used as a save, or null if it can. Only checks the
            outline. Problems deeper in the data are caught when it is restored. */
        validateRecord = record => {
            if (!isObj(record)) return i18n('save-problem-not-save');
            if (record.version !== SAVE_FORMAT_VERSION) return i18n('save-problem-version', record.version);
            if (!isObj(record.data)) return i18n('save-problem-no-data');
            return null;
        };
        
    /*  Saves a game to localStorage and restores it, as in TimeCorps. The game's state is
        small, so the whole of it is saved rather than what differs from a new game.
        
        A save can also be exported to a file and imported again.
        
        Saved record: {version, savedAt:<ISO string>, data:<game.exportToObj()>} */
    pkg.PersistenceManager = new JS.Class('PersistenceManager', {
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(game, storageKey=DEFAULT_STORAGE_KEY) {
            this.game = game;
            this.storageKey = storageKey;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /*  The Date of the last save, or null if there is no save. */
        getLastSavedDate: function() {
            const savedAt = readStorage(this.storageKey)?.savedAt;
            return savedAt ? new Date(savedAt) : null;
        },
        
        hasSave: function() {return readStorage(this.storageKey) != null;},
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Returns whether it saved. */
        save: function() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(prepareRecord(this.game)));
                return true;
            } catch (err) {
                console.error('Save failed', err);
                return false;
            }
        },
        
        /*  Returns null if the save was restored, otherwise the reason it failed. A save that
            can't be restored is cleared, and the game is left as it was. */
        restore: function() {
            const record = readStorage(this.storageKey);
            let problem = record ? validateRecord(record) : i18n('save-problem-not-save');
            if (!problem) {
                try {
                    this.game.importFromObj(record.data);
                } catch (err) {
                    console.error('Restore failed', err);
                    problem = i18n('save-problem-not-applied');
                }
            }
            if (problem) this.clear();
            return problem;
        },
        
        /*  Downloads the game as it is now as a save file. */
        export: function() {
            downloadObjectAsJSON(prepareRecord(this.game), 'hexcreeper-save');
        },
        
        /*  Carries on from a record read from a save file: it replaces the game, and is saved.
            Returns null on success, otherwise the reason it failed. A record that can't be
            used leaves the game and the save as they were; if only the saving fails, the game
            has still been replaced. */
        importRecord: function(record) {
            let problem = validateRecord(record);
            if (!problem) {
                try {
                    this.game.importFromObj(record.data);
                } catch (err) {
                    console.error('Import failed', err);
                    problem = i18n('save-problem-not-applied');
                }
            }
            if (!problem && !this.save()) problem = i18n('save-problem-storage-blocked');
            return problem;
        },
        
        clear: function() {
            try {
                localStorage.removeItem(this.storageKey);
            } catch (err) {
                console.warn('Unable to clear save', err);
            }
        }
    });
})(hc);
