const BaseService = require("./BaseService")

/**
 * A generic service class for any service that enables registering
 * detail providers. A detail provider is a function that takes an
 * input object and uses its values to populate another object.
 */
class DetailProviderService extends BaseService {
    _construct () {
        this.providers_ = [];
    }

    register_provider (fn) {
        this.providers_.push(fn);
    }

    async get_details (context, out) {
        out = out || {};

        for (const provider of this.providers_) {
            await provider(context, out);
        }

        return out;
    }
}

module.exports = { DetailProviderService }
