import { Service } from "../definitions.js";

/**
 * This service is responsible for exporting definitions to the
 * service script SDK. This is the SDK that services provided by
 * the backend will use.
 */
export class ExportService extends Service {
    constructor () {
        super();
        this.exports_ = {};
    }

    register (name, definition) {
        this.exports_[name] = definition;
    }

    get (name) {
        if ( name ) {
            return this.exports_[name];
        }
        return this.exports_;
    }
}
