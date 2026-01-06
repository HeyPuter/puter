/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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

// Bridge file to ensure ES modules and CommonJS modules use the same Context instance
// This file uses require() to load context.js, ensuring compatibility with
// CommonJS modules that also require() context.js
const { Context, ContextExpressMiddleware } = require('./context.js');

module.exports = {
    Context,
    ContextExpressMiddleware,
};
