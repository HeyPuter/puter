const BaseService = require("../../services/BaseService");

class TestAssetHostService extends BaseService {
    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');
        const path_ = require('node:path');
        
        app.use('/test-assets', require('express').static(
            path_.join(__dirname, 'assets')
        ));
    }
}

module.exports = {
    TestAssetHostService
};
