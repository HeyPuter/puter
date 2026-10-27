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

async function changeLanguage (lang) {
    if ( !lang || window.locale === lang ) return;
    // Shell strings are rendered once. Persist first, then reload.
    try {
        await puter.kv.set('user_preferences.language', lang);
    } catch (err) {
        console.warn('Could not save user_preferences.language:', err);
        return;
    }
    window.locale = lang;
    try {
        window.mutate_user_preferences({
            language: lang,
        });
    } catch (err) {
        console.warn('Could not apply user_preferences.language:', err);
    }
    location.reload();
}

export default changeLanguage;
