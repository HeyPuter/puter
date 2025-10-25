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
class BootLogger {
    info (...args) {
        console.log(
            '\x1B[36;1m[BOOT/INFO]\x1B[0m',
            ...args,
        );
    }
    debug (...args) {
        if ( ! process.env.DEBUG ) return;
        console.log('\x1B[37m[BOOT/DEBUG]', ...args, '\x1B[0m');
    }
    error (...args) {
        console.log(
            '\x1B[31;1m[BOOT/ERROR]\x1B[0m',
            ...args,
        );
    }
    warn (...args) {
        console.log(
            '\x1B[33;1m[BOOT/WARN]\x1B[0m',
            ...args,
        );
    }
}

module.exports = {
    BootLogger,
};
