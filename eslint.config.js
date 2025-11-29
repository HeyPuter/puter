import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import bangSpaceIf from './eslint/bang-space-if.js';
import controlStructureSpacing from './eslint/control-structure-spacing.js';
import spaceUnaryOpsWithException from './eslint/space-unary-ops-with-exception.js';

export const rules = {
    'no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        caughtErrors: 'none',
        ignoreRestSiblings: false,
        ignoreUsingDeclarations: false,
        reportUsedIgnorePattern: false,
        argsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',

    }],
    curly: ['error', 'multi-line'],
    '@stylistic/curly-newline': ['error', 'always'],
    '@stylistic/object-curly-spacing': ['error', 'always'],
    '@stylistic/indent': ['error', 4, {
        CallExpression: {
            arguments: 4,
        },
    }],
    '@stylistic/indent-binary-ops': ['error', 4],
    '@stylistic/array-bracket-newline': ['error', 'consistent'],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/quotes': ['error', 'single', { 'avoidEscape': true }],
    '@stylistic/function-call-argument-newline': ['error', 'consistent'],
    '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
    '@stylistic/space-before-function-paren': 'error',
    '@stylistic/key-spacing': ['error', { 'beforeColon': false, 'afterColon': true }],
    '@stylistic/keyword-spacing': ['error', { 'before': true, 'after': true }],
    '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
    '@stylistic/comma-spacing': ['error', { 'before': false, 'after': true }],
    '@stylistic/comma-dangle': ['error', 'always-multiline'],
    '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
    '@stylistic/dot-location': ['error', 'property'],
    '@stylistic/space-infix-ops': ['error'],
    'no-undef': 'error',
    'custom/control-structure-spacing': 'error',
    'custom/bang-space-if': 'error',
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/space-before-blocks': ['error', 'always'],
    'prefer-template': 'error',
    '@stylistic/no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
    'custom/space-unary-ops-with-exception': ['error', { words: true, nonwords: false }],
    '@stylistic/no-multi-spaces': ['error', { exceptions: { 'VariableDeclarator': true } }],
    '@stylistic/type-annotation-spacing': 'error',
    '@stylistic/type-generic-spacing': 'error',
    '@stylistic/type-named-tuple-spacing': ['error'],
};

export default defineConfig([
    {
        files: ['**/*.d.ts'],
        parserOptions: {
            project: null,
        },
        rules: {
            '@typescript-eslint/no-unused-vars': 'off', // Disable rules requiring type checking
        },
    },
    // TypeScript support for tests
    {
        files: ['**/*.test.ts', '**/*.test.mts', '**/*.test.setup.ts'],
        ignores: ['tests/playwright/tests/**/*.ts'],
        languageOptions: {
            parser: tseslintParser,
            globals: { ...globals.node, ...globals.vitest },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: './tests/tsconfig.json',
            },
        },
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
        rules: {
            // Recommended rules for TypeScript
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        },
    },
    // TypeScript support block
    {
        files: ['**/*.ts'],
        ignores: ['**/*.test.ts', '**/*.test.mts', 'extensions/**/*.ts'],
        languageOptions: {
            parser: tseslintParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: './tsconfig.json',
            },
        },
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
        rules: {
            // Recommended rules for TypeScript
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        },
    },
    // TypeScript support for extensions
    {
        files: ['extensions/**/*.ts'],
        languageOptions: {
            parser: tseslintParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: './extensions/tsconfig.json',
            },
        },
        plugins: {
            '@typescript-eslint': tseslintPlugin,
        },
        rules: {
            // Recommended rules for TypeScript
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        },
    },
    {
        plugins: {
            js,
            '@stylistic': stylistic,
            custom: {
                rules: {
                    'control-structure-spacing': controlStructureSpacing,
                    'bang-space-if': bangSpaceIf,
                    'space-unary-ops-with-exception': spaceUnaryOpsWithException,
                },
            },
        },
    },
    {
        files: [
            'src/backend/**/*.{js,mjs,cjs,ts}',
            'src/backend-core-0/**/*.{js,mjs,cjs,ts}',
            'src/putility/**/*.{js,mjs,cjs,ts}',
        ],
        ignores: [
            '**/*.test.js',
            '**/*.test.ts',
            '**/*.test.mts',
        ],
        languageOptions: { globals: globals.node },
        rules,
        extends: ['js/recommended'],
        plugins: {
            js,
            '@stylistic': stylistic,
        },
    },
    {
        files: [
            '**/*.test.js',
            '**/*.test.ts',
            '**/*.test.mts',
        ],
        languageOptions: { globals: { ...globals.node, ...globals.vitest } },
        rules,
        plugins: {
            js,
            '@stylistic': stylistic,
        },
    },
    {
        files: ['extensions/**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: {
                extension: 'readonly',
                config: 'readonly',
                global_config: 'readonly',
                ...globals.node,
            },
        },
        rules,
        extends: ['js/recommended'],
        plugins: {
            js,
            '@stylistic': stylistic,
        },
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}', 'src/gui/src/**/*.js'],
        ignores: [
            'src/backend/**/*.{js,mjs,cjs,ts}',
            'extensions/**/*.{js,mjs,cjs,ts}',
            'src/backend-core-0/**/*.{js,mjs,cjs,ts}',
            'submodules/**',
            'tests/**',
            'tools/**',
            '**/*.min.js',
            '**/*.min.cjs',
            '**/*.min.mjs',
            '**/socket.io.js',
            '**/dist/*.js',
            'src/phoenix/**',
            'src/gui/src/lib/**',
            'src/gui/dist/**',
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.jquery,
                i18n: 'readonly',
                puter: 'readonly',
            },
        },
        rules,
        extends: ['js/recommended'],
        plugins: {
            js,
            '@stylistic': stylistic,
        },
    },
]);
