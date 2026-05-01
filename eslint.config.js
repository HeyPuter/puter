import js from '@eslint/js';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

// typescript-eslint's flat/recommended preset is an array of configs (base +
// eslint-recommended overrides + recommended rules). Flatten its rules so we
// can apply them via our own `files`-scoped blocks.
const tsRecommendedRules = tseslintPlugin.configs['flat/recommended'].reduce(
    (acc, cfg) => ({ ...acc, ...(cfg.rules ?? {}) }),
    {},
);

const prettierRules = {
    ...prettierConfig.rules,
    'prettier/prettier': 'error',
};

const unusedVarsOptions = {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
    ignoreRestSiblings: true,
};

const preferConstOptions = {
    destructuring: 'all',
    ignoreReadBeforeAssign: false,
};

const lintedGlobals = {
    ...globals.node,
    extension: 'readonly',
    config: 'readonly',
    global_config: 'readonly',
};

const jsFiles = [
    'src/backend/**/*.{js,mjs,cjs}',
    'extensions/**/*.{js,mjs,cjs}',
];

const tsIgnores = [
    '**/*.test.ts',
    '**/*.test.mts',
    '**/*.spec.ts',
    '**/*.spec.mts',
    'src/backend/test/**',
    'src/backend/tools/**',
    'src/backend/vitest.config.ts',
    'src/backend/vitest.bench.config.ts',
];

const createTsConfig = ({ files, project }) => ({
    files,
    ignores: tsIgnores,
    languageOptions: {
        parser: tseslintParser,
        globals: lintedGlobals,
        parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            projectService: { defaultProject: project },
            tsconfigRootDir: import.meta.dirname,
        },
    },
    plugins: {
        '@typescript-eslint': tseslintPlugin,
        prettier: prettierPlugin,
    },
    rules: {
        ...tsRecommendedRules,
        ...prettierRules,
        '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
        '@typescript-eslint/no-explicit-any': 'warn',
        'prefer-const': ['error', preferConstOptions],
    },
});

export default defineConfig([
    {
        ignores: [
            '**/*.dbmig.js',
            'dist/**',
            'build/**',
            'volatile/**',
            'node_modules/**',
            'puter.js/**',
            'apps/**',
            'experiment/**',
            'workers/**',
            'src/public/**',
            'src/gui/**',
            'src/docs/**',
            'src/puter-js/**',
            'src/worker/**',
            'submodules/**',
            'tests/**',
            'tools/**',
        ],
    },
    {
        files: jsFiles,
        ignores: ['**/*.test.js'],
        plugins: {
            js,
            prettier: prettierPlugin,
        },
        extends: ['js/recommended'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: lintedGlobals,
        },
        rules: {
            ...prettierRules,
            'no-unused-vars': ['error', unusedVarsOptions],
            'prefer-const': ['error', preferConstOptions],
        },
    },
    createTsConfig({
        files: ['src/backend/**/*.ts', 'extensions/**/*.ts'],
        project: './tsconfig.json',
    }),
]);
