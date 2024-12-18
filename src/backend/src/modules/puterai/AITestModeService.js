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
