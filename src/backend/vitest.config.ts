// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        setupFiles: ['./vitest.setup.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
            include: ['src/**/*.{js,mjs,ts,mts}'],
            exclude: [
                'src/**/types/**',
                'src/**/constants/**',
                'src/**/*.d.ts',
                'src/**/*.d.mts',
                'src/**/*.d.cts',
                'src/**/dist/**',
                'src/**/*.min.*',
            ],
        },
        env: loadEnv(mode, '', 'PUTER_'),
        include: ['src/**/*.{test,spec}.{ts,js}'],
        root: __dirname, // Ensures paths are relative to backend/
    },
}));
