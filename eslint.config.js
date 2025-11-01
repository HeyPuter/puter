import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import controlStructureSpacing from './control-structure-spacing.js';

const rules = {
    'no-unused-vars': ['error', {
        'vars': 'all',
        'args': 'after-used',
        'caughtErrors': 'all',
        'ignoreRestSiblings': false,
        'ignoreUsingDeclarations': false,
        'reportUsedIgnorePattern': false,
        'argsIgnorePattern': '^_',
        'caughtErrorsIgnorePattern': '^_',
        'destructuredArrayIgnorePattern': '^_',

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
    '@stylistic/space-before-function-paren': ['error', { 'anonymous': 'never', 'named': 'never', 'asyncArrow': 'always', 'catch': 'always' }],
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
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/space-before-blocks': ['error', 'always'],
};

export default defineConfig([
    // TypeScript support block
    {
        files: ['**/*.ts'],
        ignores: ['tests/**/*.ts'],
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
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        },
    },
    // TypeScript support for tests
    {
        files: ['tests/**/*.ts'],
        languageOptions: {
            parser: tseslintParser,
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
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        },
    },
    {
        plugins: {
            js,
            '@stylistic': stylistic,
            custom: { rules: { 'control-structure-spacing': controlStructureSpacing } },
        },
    },
    {
        files: ['src/backend/**/*.{js,mjs,cjs,ts}'],
        languageOptions: { globals: globals.node },
        rules,
        extends: ['js/recommended'],
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
        files: ['**/*.{js,mjs,cjs,ts}'],
        ignores: [
            'src/backend/**/*.{js,mjs,cjs,ts}',
            'extensions/**/*.{js,mjs,cjs,ts}',
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.jquery,
                i18n: 'readonly',
            },
        },
        rules,
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        ignores: ['src/backend/**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.jquery,
                i18n: 'readonly',
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
