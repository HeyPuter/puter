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

export default defineConfig([
    {
        ignores: [
            'src/backend/src/modules/apps/AppInformationService.js', // TEMPORARY - SHOULD BE FIXED!
            'src/backend/src/services/worker/WorkerService.js', // TEMPORARY - SHOULD BE FIXED!
            'src/backend/src/public/**/*', // We may be able to delete this! I don't think it's used

            // These files run in the worker environment, so these rules don't apply
            'src/backend/src/services/worker/dist/**/*.{js,cjs,mjs}',
            'src/backend/src/services/worker/src/**/*.{js,cjs,mjs}',
            'src/backend/src/services/worker/template/puter-portable.js',
        ],
    },
    {
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
    },
    {
        files: [
            'src/backend/**/*.{js,mjc,cjs}',
            'extensions/**/*.{js,mjc,cjs}',
            'src/backend-core-0/**/*.{js,mjc,cjs}',
        ],
        ignores: [
            'src/backend/src/services/database/sqlite_setup/**/*.js',
        ],
        rules: {
            'no-undef': 'error',
        },
        languageOptions: {
            ...backendLanguageOptions,
        },
    },
    {
        files: [
            'src/backend/src/services/database/sqlite_setup/**/*.js',
        ],
        rules: {
            'no-undef': 'error',
        },
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
            'src/backend-core-0/**/*.{ts}',
        ],
        rules: {
            'no-undef': 'error',
        },
        languageOptions: {
            ...backendLanguageOptions,
        },
    },
]);
