const BaseService = require("../../services/BaseService");

class TestConfigUpdateService extends BaseService {
    async _run_as_early_as_possible () {
        const config = this.global_config;
        config.__set_config_object__({
            testConfigValue: 'abcdefg'
        });
    }
}

module.exports = TestConfigUpdateService;
