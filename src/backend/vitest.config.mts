// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
