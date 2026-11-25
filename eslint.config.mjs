import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                
                JS: 'readonly',
                myt: 'readonly',
                LOCALE_KEY: 'readonly', // Set by index.html's locale detection.
                JSON5: 'readonly',
                hc: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'no-extra-boolean-cast': 'off',
            'no-constant-condition': ['warn', {checkLoops: false}],
            'no-useless-escape': 'off',
            'no-cond-assign': 'off'
        }
    },
    {
        // The test harness runs in Node as ES modules. Code passed to page.evaluate runs in
        // the game page, so "hc" stays available as a global there.
        files: ['tests/**/*.mjs', 'tools/**/*.mjs', 'playwright.config.mjs'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        }
    }
];
