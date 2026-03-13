// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        // Run test files serially by default to reduce heap pressure in large backend suites.
        maxWorkers: 1,
        minWorkers: 1,
        fileParallelism: false,
        coverage: {
            provider: 'v8',
            reporter: isCi
                ? ['json', 'json-summary', 'lcov']
                : ['text', 'json', 'json-summary', 'html', 'lcov'],
            processingConcurrency: 1,
            excludeAfterRemap: true,
            // Keep coverage focused on executed files to avoid high-memory
            // uncovered-file remapping in CI.
            exclude: [
                'src/**/types/**',
                'src/**/constants/**',
                'src/**/*.d.ts',
                'src/**/*.d.mts',
                'src/**/*.d.cts',
                'src/**/dist/**',
                'src/**/*.min.*',
                'src/**/*.bench.{js,mjs,ts,mts}',
                'src/**/*.{test,spec}.{js,mjs,ts,mts}',
                'src/public/**',
                'src/services/worker/template/**',
            ],
        },
        env: loadEnv(mode, '', 'PUTER_'),
        include: ['src/**/*.{test,spec}.{ts,js}'],
        root: __dirname, // Ensures paths are relative to backend/
    },
}));
