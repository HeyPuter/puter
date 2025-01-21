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

let V86;

if (typeof window !== 'undefined') {
	V86 = window.V86;
} else {
	try {
		const { createRequire } = await import('module');
		const require = createRequire(import.meta.url);
		const NodeV86 = require("../third-party/libv86.js");
		V86 = NodeV86.V86;
	} catch (error) {
		console.error('Failed to load V86 in Node.js environment:', error);
	}
}

export { V86 };
