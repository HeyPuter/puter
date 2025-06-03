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
import UIAlert from "../UI/UIAlert.js";

import { Service } from "../definitions.js";

export class LaunchOnInitService extends Service {
    _construct () {
        this.commands = {
            'window-call': ({ fn_name, args }) => {
                window[fn_name](...args);
            }
        };
    }
    async _init () {
        const launch_options = this.$puter.gui_params.launch_options;
        if ( ! launch_options ) return;

        if ( launch_options.on_initialized ) {
            for ( const command of launch_options.on_initialized ) {
                this.run_(command);
            }
        }
    }

    run_ (command) {
        const args = { ...command };
        delete args.$;
        this.commands[command.$](args);
    }
}
