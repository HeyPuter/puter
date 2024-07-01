const { DBKVStore } = require("../drivers/DBKVStore");
const { EntityStoreImplementation } = require("../drivers/EntityStoreImplementation");
const { HelloWorld } = require("../drivers/HelloWorld");
const BaseService = require("./BaseService");

class SelfhostedService extends BaseService {
    static description = `
        Registers drivers for self-hosted Puter instances.
    `

    async _init () {
        const svc_driver = this.services.get('driver');

        svc_driver.register_driver('helloworld', new HelloWorld());
        svc_driver.register_driver('puter-kvstore', new DBKVStore());
        svc_driver.register_driver('puter-apps', new EntityStoreImplementation({ service: 'es:app' }));
        svc_driver.register_driver('puter-subdomains', new EntityStoreImplementation({ service: 'es:subdomain' }));
        svc_driver.register_driver('puter-notifications', new EntityStoreImplementation({ service: 'es:notification' }));
    }
}

module.exports = { SelfhostedService };
