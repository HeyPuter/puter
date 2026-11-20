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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The uuid of the user an embedding page is signed in as, from its
 * `#user=<uuid>` fragment, in lower case. Null without a well-formed one.
 *
 * @param {string} hash - `location.hash`
 * @returns {string | null}
 */
export const embedHostUser = (hash) => {
    const value = new URLSearchParams(String(hash ?? '').replace(/^#/, '')).get('user');
    return value && UUID.test(value) ? value.toLowerCase() : null;
};
