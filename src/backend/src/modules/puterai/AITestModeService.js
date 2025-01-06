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

// METADATA // {"ai-commented":{"service":"claude"}}
const BaseService = require("../../services/BaseService");


/**
* Service class that handles AI test mode functionality.
* Extends BaseService to register test services for AI chat completions.
* Used for testing and development of AI-related features by providing
* a mock implementation of the chat completion service.
*/
class AITestModeService extends BaseService {
    /**
    * Service for managing AI test mode functionality
    * @extends BaseService
    */
    async _init () {
        const svc_driver = this.services.get('driver');
        svc_driver.register_test_service('puter-chat-completion', 'ai-chat');
    }
}

module.exports = {
    AITestModeService,
};
