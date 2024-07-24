const BaseService = require("./BaseService");

class HelloWorldService extends BaseService {
    static IMPLEMENTS = {
        ['version']: {
            get_version () {
                return 'v1.0.0';
            }
        },
        ['hello-world']: {
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
