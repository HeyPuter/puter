/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("puter-js-common");

const ENDPOINT = 'https://api.puter.com/drivers/call';

/*

Fetch example:

await fetch("https://api.puter.local/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer <actor token>",
  },
  "body": JSON.stringify({ interface: '...', method: '...', args: { ... } }),
  "method": "POST",
});

*/

class PuterDriverProxy extends AdvancedBase {
    static MODULES = {
        axios: require('axios'),
    }

    constructor ({ target }) {
        this.target = target;
    }

    async call (method, args) {
        const require = this.require;
        const axios = require('axios');

        // TODO: We need the BYOK feature before we can implement this
    }
}

module.exports = PuterDriverProxy;
