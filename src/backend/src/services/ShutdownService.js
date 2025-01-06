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

// METADATA // {"ai-commented":{"service":"claude"}}
const BaseService = require("./BaseService");


/**
* Service responsible for handling graceful system shutdown operations.
* Extends BaseService to provide shutdown functionality with optional reason and exit code.
* Ensures proper cleanup and logging when the application needs to terminate.
* @class ShutdownService
* @extends BaseService
*/
class ShutdownService extends BaseService {
    shutdown ({ reason, code } = {}) {
        this.log.info(`Puter is shutting down: ${reason ?? 'no reason provided'}`);
        process.stdout.write('\x1B[0m\r\n');
        process.exit(code ?? 0);
    }
}

module.exports = { ShutdownService };
