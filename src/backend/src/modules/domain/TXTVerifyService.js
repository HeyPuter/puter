const { get_user } = require("../../helpers");
const BaseService = require("../../services/BaseService");

class TXTVerifyService extends BaseService {
    async _init () {
        const require = this.require;
        const dns = require('dns').promises;

        const svc_event = this.services.get('event');
        svc_event.on('domain.get-controlling-user', async (_, event) => {
            let records = await dns.resolveTxt(`_puter-verify.${event.domain}`);
            records = records.flat();
        
            console.log('got records :: ', records);
        })
    }
}

module.exports = {
    TXTVerifyService,
}
