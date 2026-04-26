// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: isCi
                ? ['json', 'json-summary', 'lcov']
                : ['text', 'json', 'json-summary', 'html', 'lcov'],
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
        include: ['**/*.{test,spec}.{ts,js}'],
        root: __dirname, // Ensures paths are relative to backend/
    },
}));
