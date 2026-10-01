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

/**
 * An fsentry's `metadata` as an object. It arrives as a client-writable JSON
 * string, so anything unparseable reads as `{}` rather than throwing mid-render.
 *
 * @param {unknown} metadata
 * @returns {Record<string, unknown>}
 */
const parse_item_metadata = (metadata) => {
    if ( metadata && typeof metadata === 'object' ) return metadata;
    if ( typeof metadata !== 'string' || metadata === '' ) return {};
    try {
        return JSON.parse(metadata) || {};
    } catch {
        return {};
    }
};

export default parse_item_metadata;
