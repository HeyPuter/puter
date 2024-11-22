const BaseService = require("../../services/BaseService");

class AITestModeService extends BaseService {
    async _init () {
        const svc_driver = this.services.get('driver');
        svc_driver.register_test_service('puter-chat-completion', 'ai-chat');
    }
}

module.exports = {
    AITestModeService,
};
