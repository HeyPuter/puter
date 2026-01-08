// vitest.bench.config.ts - Vitest benchmark configuration for Puter backend
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        benchmark: {
            include: ['src/**/*.bench.{js,ts}'],
            reporters: ['default'],
        },
        root: __dirname,
    },
});

