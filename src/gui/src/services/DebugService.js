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

export class DebugService extends Service {
    async _init () {
        // Track enabled log categories
        this.enabled_logs = [];

        // Provide enabled logs as a query param
        const svc_exec = this.services.get('exec');
        svc_exec.register_param_provider(() => {
            return {
                ...(this.enabled_logs.length > 0
                    ? { enabled_logs: this.enabled_logs.join(';') }
                    : {}
                ),
            };
        });
    }
    logs(category) {
        const msg = {
            $: 'puterjs-debug',
            cmd: 'log.on',
            category,
        };
        this.enabled_logs.push(category);
        puter.logger.on(category);
        $('iframe').each(function () {
            this.contentWindow.postMessage(msg);
        });
    }
}
