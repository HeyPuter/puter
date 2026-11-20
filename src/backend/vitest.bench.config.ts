/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { backendAliases, lowerDecoratorsPlugin } from './vitest.config';

// Benchmarks (`*.bench.ts`), run through `npm run bench`. See doc/benchmarks.md.
export default defineConfig(({ mode }) => ({
    plugins: [lowerDecoratorsPlugin],
    resolve: { alias: backendAliases },
    test: {
        benchmark: {
            include: [
                'src/backend/**/*.bench.{js,ts}',
                'extensions/**/*.bench.{js,ts}',
            ],
        },
        // Files sharing a CPU would time each other's load.
        fileParallelism: false,
        hookTimeout: 120_000,
        env: loadEnv(mode, '', 'PUTER_'),
        root: path.resolve(__dirname, '../..'),
    },
}));
