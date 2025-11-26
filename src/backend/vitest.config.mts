// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import {loadEnv} from 'vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        environment: 'jsdom',
        coverage: {
            reporter: ['text', 'json', 'html'],
        },
        env: loadEnv(mode, '', 'PUTER_'),
    },
}));