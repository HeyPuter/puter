const BaseService = require("../../services/BaseService");
const { Judge0Client } = require("./Judge0Client");

class Judge0Service extends BaseService {
    _construct () {
        this.about_ = {};
    }

    static IMPLEMENTS = {
        ['puter-exec']: {
            async about () {
                return this.about ?? (this.about = await this.client.about());
            },
            async supported () {
                return require('./languages/languages');
            },
            async exec ({ runtime, code }) {
                return await this.exec_(runtime, code);
            }
        }
    }

    async _init () {
        this.client = new Judge0Client({
            token: this.config.token,
        });
    }

    async exec_ (runtime, code) {
        //
    }
}

module.exports = Judge0Service;
