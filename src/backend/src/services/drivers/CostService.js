const APIError = require("../../api/APIError");
const { Context } = require("../../util/context");
const BaseService = require("../BaseService");

class CreditContext {
    constructor (svc, o) {
        for ( const k in o ) this[k] = o[k];
        this.svc = svc;
    }
}

class CostService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }

    _init () {
        const svc_cost = this;
        const svc_event = this.services.get('event');
        svc_event.on('driver.create-call-context', async (_, event) => {
            event.context = event.context.sub({
                // Future Use
            });
        });
    }
    async get_credit_context (params) {
        return new CreditContext(this, params);
    }

    async get_funding_allowed (options = {}) {
        const cost_uuid = this.modules.uuidv4();
        const svc_event = this.services.get('event');
        const event = {
            actor: Context.get('actor'),
            available: 0,
            cost_uuid,
        };
        await svc_event.emit('credit.check-available', event);

        // specified minimum or 1/10th of a cent
        const minimum = options.minimum ?? 100;
        
        return event.available >= minimum;
    }
    async record_cost ({ cost }) {
        const svc_event = this.services.get('event');
        const event = {
            actor: Context.get('actor'),
            cost,
        };
        await svc_event.emit('credit.record-cost', event);
    }
}

module.exports = {
    CostService,
};
