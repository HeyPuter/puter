import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import controlStructureSpacing from './control-structure-spacing.js';

export default defineConfig([
    {
        plugins: {
            js,
            '@stylistic': stylistic,
            custom: { rules: { 'control-structure-spacing': controlStructureSpacing } },
        },
    },
    {
        files: ['src/backend/**/*.{js,mjs,cjs}'],
        languageOptions: { globals: globals.node },
        rules: {
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
                'CallExpression': 4,
            }],
            '@stylistic/indent-binary-ops': ['error', 4],
            '@stylistic/array-bracket-newline': ['error', 'consistent'],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/quotes': ['error', 'single'],
            '@stylistic/function-call-argument-newline': ['error', 'consistent'],
            '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
            '@stylistic/space-before-function-paren': ['error', { 'anonymous': 'never', 'named': 'never', 'asyncArrow': 'always', 'catch': 'never' }],
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

        },
        extends: ['js/recommended'],
        plugins: {
            js,
            '@stylistic': stylistic,
        },
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: { globals: globals.browser },
        rules: {

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
            '@stylistic/curly-newline': ['error', 'always'],
            '@stylistic/object-curly-spacing': ['error', 'always'],
            '@stylistic/indent': ['error', 4, {
                'CallExpression': { arguments: 4 },
            }],
            '@stylistic/indent-binary-ops': ['error', 4],
            '@stylistic/array-bracket-newline': ['error', 'consistent'],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/quotes': ['error', 'single'],
            '@stylistic/function-call-argument-newline': ['error', 'consistent'],
            '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
            '@stylistic/space-before-function-paren': ['error', { 'anonymous': 'never', 'named': 'never', 'asyncArrow': 'always', 'catch': 'never' }],
            '@stylistic/key-spacing': ['error', { 'beforeColon': false, 'afterColon': true }],
            '@stylistic/keyword-spacing': ['error', { 'before': true, 'after': true }],
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
            '@stylistic/comma-spacing': ['error', { 'before': false, 'after': true }],
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
            '@stylistic/dot-location': ['error', 'property'],
            '@stylistic/space-infix-ops': ['error'],
            'no-undef': 'error',
            curly: ['error', 'multi-line'],
            'custom/control-structure-spacing': 'error',
            '@stylistic/no-trailing-spaces': 'error',
        },
        extends: ['js/recommended'],
        plugins: {
            js,
            '@stylistic': stylistic,

        },
    },
]);
