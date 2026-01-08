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
//# sourceMappingURL=vitest.bench.config.js.map