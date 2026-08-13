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
 * Whether the `show_hidden_files` preference is currently on. The dashboard
 * shares the preference with the desktop Explorer, so toggling it in one
 * place carries over to the other.
 *
 * @returns {boolean}
 */
export const showHiddenFiles = () => !! window.user_preferences?.show_hidden_files;

/**
 * Whether a name is a hidden one - dot-prefixed, same rule as the Explorer.
 *
 * @param {string} name - The entry's name
 * @returns {boolean}
 */
export const isHiddenName = (name) => String(name ?? '').startsWith('.');

/**
 * Whether an entry of this name belongs in a listing, given the preference.
 *
 * @param {string} name - The entry's name
 * @param {boolean} showHidden - Value of the `show_hidden_files` preference
 * @returns {boolean}
 */
export const isEntryVisible = (name, showHidden) => showHidden || ! isHiddenName(name);
