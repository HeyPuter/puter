'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
// vitest.bench.config.ts - Vitest benchmark configuration for Puter backend
var config_1 = require('vitest/config');
exports.default = (0, config_1.defineConfig)({
    test: {
        benchmark: {
            include: ['src/**/*.bench.{js,ts}'],
            reporters: ['default'],
        },
        root: __dirname,
    },
});
