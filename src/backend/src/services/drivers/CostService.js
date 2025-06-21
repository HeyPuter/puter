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
        return (options.available ?? await this.get_available_amount())
            >= (options.minimum ?? 100);
    }

    async get_available_amount () {
        const cost_uuid = this.modules.uuidv4();
        const svc_event = this.services.get('event');
        const event = {
            actor: Context.get('actor'),
            available: 0,
            cost_uuid,
        };
        await svc_event.emit('credit.check-available', event);
        
        return event.available;
    }
    async record_cost ({ cost }) {
        const svc_event = this.services.get('event');
        const event = {
            actor: Context.get('actor'),
            cost,
        };
        this.log.info('cost record', {
            actor: event.actor,
            cost,
            client_driver_call: Context.get('client_driver_call'),
        });
        await svc_event.emit('credit.record-cost', event);
    }
    async record_funding_update ({ old_amount, new_amount }) {
        const svc_event = this.services.get('event');
        const event = {
            actor: Context.get('actor'),
            old_amount,
            new_amount,
        };
        await svc_event.emit('credit.funding-update', event);
    }
}

module.exports = {
    CostService,
};
