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
 * Read an app by uid, as `puter.apps.get` reads one by name (`params` takes
 * the same options). Returns null when it does not exist or the lookup fails.
 */
export async function get_app_by_uid (uid, params) {
    try {
        const res = await fetch(`${window.api_origin}/drivers/call`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth_token}`,
            },
            body: JSON.stringify({
                interface: 'puter-apps',
                driver: 'es:app',
                method: 'read',
                args: { uid, params },
            }),
            method: 'POST',
        });
        if ( ! res.ok ) return null;
        const body = await res.json();
        return body?.result ?? null;
    } catch (e) {
        console.error('Failed to look up app', uid, e);
        return null;
    }
}
