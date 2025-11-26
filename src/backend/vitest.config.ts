// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [],
        coverage: {
            reporter: ['text', 'json', 'html'],
            exclude: [],
        },
        env: loadEnv(mode, '', 'PUTER_'),
    },
}));
