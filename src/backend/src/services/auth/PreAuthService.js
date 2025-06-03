const configurable_auth = require("../../middleware/configurable_auth");
const BaseService = require("../BaseService");

class PreAuthService extends BaseService {
    async ['__on_install.middlewares.early'] (_, { app }) {
        app.use(configurable_auth({ optional: true }));
    }
}

module.exports = {
    PreAuthService,
};
