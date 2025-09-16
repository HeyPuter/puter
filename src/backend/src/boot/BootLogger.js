const config = require("../config");

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
    constructor () {
        this.log_ = config.enable_boot_logger ? console.log : () => {};
        this.log_(
            `\x1B[36;1mBoot logger started :)\x1B[0m`,
        );
    }
    info (...args) {
        this.log_(
            '\x1B[36;1m[BOOT/INFO]\x1B[0m',
            ...args,
        );
    }
    error (...args) {
        this.log_(
            '\x1B[31;1m[BOOT/ERROR]\x1B[0m',
            ...args,
        );
    }
    warn (...args) {
        this.log_(
            '\x1B[33;1m[BOOT/WARN]\x1B[0m',
            ...args,
        );
    }
}

module.exports = {
    BootLogger,
};
