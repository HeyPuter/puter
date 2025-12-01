// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html'],
            include: ['src/backend/**/*.js', 'src/backend/**/*.mjs', 'src/backend/**/*.ts', 'src/backend/**/*.ts'],
            exclude: [
                '**/types/**',
                '**/constants/**',
                '**/*.d.ts',
                '**/dist/**',
                '**/*.min.*',
            ],
        },
        env: loadEnv(mode, '', 'PUTER_'),
        include: ['src/backend/**/*.test.ts', 'src/backend/**/*.test.js']
    },
}));
