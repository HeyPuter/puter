const BaseService = require("../../services/BaseService");

/**
 * PermissiveCreditService listens to the event where DriverService asks
 * for a credit context, and always provides one that allows use of
 * cost-incurring services for no charge. This grants free use to
 * everyone to services that incur a cost, as long as the user has
 * permission to call the respective service.
 */
class PermissiveCreditService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }
    _init () {
        const svc_event = this.services.get('event');
        svc_event.on(`credit.check-available`, (_, event) => {
            // Useful for testing with Dall-E
            // event.available = 4 * Math.pow(10,6);

            // Useful for testing with Polly
            // event.available = 9000;

            event.available = Number.MAX_SAFE_INTEGER;
        });
    }
}

module.exports = PermissiveCreditService;
