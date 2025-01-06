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

import { Service } from "../definitions.js";

export class AntiCSRFService extends Service {
    /**
     * Request an anti-csrf token from the server
     * @return anti_csrf: string
     */
    async token () {
        const anti_csrf = await (async () => {
            const resp = await fetch(
                `${window.gui_origin}/get-anticsrf-token`,{
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + window.auth_token,
                    }
                },)
            const { token } = await resp.json();
            return token;
        })();
        
        return anti_csrf;
    }
}
