const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");

/**
 * @typedef {Object} ErrorSpec
 * @property {string} code - The error code
 * @property {string} status - HTTP status code
 * @property {function} message - A function that generates an error message
 */

/**
 * The APIErrorService class provides a mechanism for registering and managing
 * error codes and messages which may be sent to clients.
 * 
 * This allows for a single source-of-truth for error codes and messages that
 * are used by multiple services.
 */
class APIErrorService extends BaseService {
    _construct () {
        this.codes = {
            ...this.constructor.codes,
        };
    }

    // Hardcoded error codes from before this service was created
    static codes = APIError.codes;
    
    /**
     * Registers API error codes.
     * 
     * @param {Object.<string, ErrorSpec>} codes - A map of error codes to error specifications
     */
    register (codes) {
        for ( const code in codes ) {
            this.codes[code] = codes[code];
        }
    }
    
    create (code, fields) {
        const error_spec = this.codes[code];
        if ( ! error_spec ) {
            return new APIError(500, 'Missing error message.', null, {
                code,
            });
        }
        
        return new APIError(error_spec.status, error_spec.message, null, {
            ...fields,
            code,
        });
    }
}

module.exports = APIErrorService;
