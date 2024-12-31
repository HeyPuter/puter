const BaseService = require("../../services/BaseService");
const { PuterFSProvider } = require("./lib/PuterFSProvider");

class PuterFSService extends BaseService {
    async _init () {
        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.register_mounter('puterfs', this.as('mounter'));
    }

    static IMPLEMENTS = {
        mounter: {
            async mount ({ path, options }) {
                const provider = new PuterFSProvider();
                return provider;
            }
        }
    }
}

module.exports = {
    PuterFSService,
};