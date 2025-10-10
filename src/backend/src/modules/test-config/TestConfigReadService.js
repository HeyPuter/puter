const BaseService = require("../../services/BaseService");

class TestConfigReadService extends BaseService {
    async _init () {
        this.log.noticeme('test config value (should be abcdefg) is: ' +
            this.global_config.testConfigValue,
        );
    }
}

module.exports = TestConfigReadService;
