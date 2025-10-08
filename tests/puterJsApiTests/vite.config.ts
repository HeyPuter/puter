// vite.config.ts - Vite configuration for Puter API tests (TypeScript)
import { defineConfig, loadEnv } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => ({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./setup.ts'],
        coverage: {
            reporter: ['text', 'json', 'html'],
            exclude: ['setup.ts', 'testUtils.ts'],
        },
        env: loadEnv(mode, "", "PUTER_"),
    },
    plugins: [
        viteStaticCopy({
            targets: [
                { src: '../src/puter-js/src/index.js', dest: 'puter-js' },
            ],
        }),
    ],
}));