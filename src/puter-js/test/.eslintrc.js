module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    // Disable strict type checking for test files
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'no-unused-vars': 'off',
    // Allow console.log in tests
    'no-console': 'off',
    // Allow process.exit in tests
    'no-process-exit': 'off'
  },
  globals: {
    // Allow global variables that might be set in test environment
    global: 'readonly',
    process: 'readonly'
  }
};
