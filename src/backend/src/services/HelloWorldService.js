const BaseService = require("./BaseService");

class HelloWorldService extends BaseService {
    static IMPLEMENTS = {
        ['driver-metadata']: {
            get_response_meta () {
                return {
                    driver: 'hello-world',
                    driver_version: 'v1.0.0',
                    driver_interface: 'helloworld',
                };
            }
        },
        helloworld: {
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
