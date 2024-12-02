// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
const BaseService = require("./BaseService");


/**
* @class HelloWorldService
* @extends BaseService
* @description This class extends the BaseService and provides methods to get the version
* of the service and to generate a greeting message. The greeting message can be personalized
* based on the input subject.
*/
class HelloWorldService extends BaseService {
    static IMPLEMENTS = {
        ['version']: {
            /**
            * Returns the current version of the service.
            *
            * @returns {string} The version string.
            */
            get_version () {
                return 'v1.0.0';
            }
        },
        ['hello-world']: {
            /**
            * Greets the user with a customizable message.
            *
            * @param {Object} options - The options object.
            * @param {string} [options.subject] - The subject of the greeting. If not provided, defaults to "World".
            * @returns {string} The greeting message.
            */
            
            ```javascript
            11:             async greet ({ subject }) {
            12:                 if ( subject ) {
            13:                     return `Hello, ${subject}!`;
            14:                 }
            15:                 return `Hello, World!`;
            16:             }
            17:         },
            async greet ({ subject }) {
                if ( subject ) {
                    return `Hello, ${subject}!`;
                }
                return `Hello, World!`;
            }
        },
    }
}

module.exports = { HelloWorldService };
