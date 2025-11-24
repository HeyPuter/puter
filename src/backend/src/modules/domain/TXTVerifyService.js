const { get_user } = require('../../helpers');
const BaseService = require('../../services/BaseService');
const { atimeout } = require('../../util/asyncutil');

class TXTVerifyService extends BaseService {
    ['__on_boot.consolidation'] () {
        const svc_dns = this.services.get('dns');
        const dns = svc_dns.get_client();

        const svc_event = this.services.get('event');
        svc_event.on('domain.get-controlling-user', async (_, event) => {
            const record_name = `_puter-verify.${event.domain}`;
            try {
                const result = await atimeout(5000,
                                dns.resolve(record_name, 'TXT'));

                const answer = result.answers.filter(a => a.name === record_name &&
                    a.type === 16)[0];

                const data_raw = answer.data;
                const data = JSON.parse(data_raw);
                event.user = await get_user({ username: data.username });
            } catch (e) {
                console.error('ERROR', e);
            }
        });
    }
}

module.exports = {
    TXTVerifyService,
};
