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
const { Driver } = require("../definitions/Driver");

class HelloWorld extends Driver {
    static ID = 'public-helloworld';
    static VERSION = '0.0.0';
    static INTERFACE = 'helloworld';
    static SLA = {
        greet: {
            rate_limit: {
                max: 10,
                period: 30000,
            },
            monthly_limit: Math.pow(1, 6),
        },
    }
    static METHODS = {
        greet: async function ({ subject }) {
            return `Hello, ${subject ?? 'World'}!`
        }
    }
}

module.exports = {
    HelloWorld,
};
