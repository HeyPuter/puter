import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

const backendLanguageOptions = {
    globals: {
        // Current, intentionally supported globals
        extension: 'readonly',
        config: 'readonly',
        global_config: 'readonly',

        // Older not entirely ideal globals
        use: 'readonly', // <-- older import mechanism
        def: 'readonly', // <-- older import mechanism
        kv: 'readonly', // <-- should be passed/imported
        ll: 'readonly', // <-- questionable

        // Language/environment globals
        ...globals.node,
    },
};

const mandatoryRules = {
    'no-undef': 'error',
    'no-use-before-define': ['error', {
        'functions': false,
    }],
    'no-invalid-this': 'warn',
};

export default defineConfig([
    {
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
    },
    {
        files: [
            'src/backend/**/*.{js,mjc,cjs}',
            'extensions/**/*.{js,mjc,cjs}',
        ],
        ignores: [
            // Migration `.dbmig.js` scripts run in a VM context with injected
            // `read` / `write` / `log` globals, not node's — they're linted
            // separately below.
            'src/backend/clients/database/migrations/**/*.{js,cjs,mjs}',
        ],
        rules: mandatoryRules,
        languageOptions: {
            ...backendLanguageOptions,
        },
    },
    {
        files: [
            'src/backend/clients/database/migrations/**/*.{js,cjs,mjs}',
        ],
        rules: mandatoryRules,
        languageOptions: {
            globals: {
                read: 'readonly',
                write: 'readonly',
                log: 'readonly',
                ...globals.node,
            },
        },
    },
    {
        files: [
            'src/backend/**/*.{ts}',
            'extensions/**/*.{ts}',
        ],
        rules: mandatoryRules,
        languageOptions: {
            ...backendLanguageOptions,
        },
    },
]);
