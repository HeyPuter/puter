/**
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

'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
// vitest.bench.config.ts - Vitest benchmark configuration for Puter backend
var config_1 = require('vitest/config');
exports.default = (0, config_1.defineConfig)({
    test: {
        benchmark: {
            include: ['src/**/*.bench.{js,ts}'],
            reporters: ['default'],
        },
        root: __dirname,
    },
});
