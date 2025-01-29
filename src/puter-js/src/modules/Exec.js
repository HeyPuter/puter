import * as utils from '../lib/utils.js';

export default class Exec {
    // Module Interface
    setAuthToken (authToken) {
        this.authToken = authToken;
    }
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    // Exec Interface
    async exec (...args) {
        return await utils.make_driver_method([
            'runtime', 'code', 'stdin',
        ], 'puter-exec', undefined, 'exec', {
            transform: async (result) => {
                result.toString = () => {
                    return result.message?.content;
                };

                result.valueOf = () => {
                    return result.message?.content;
                }

                return result;
            }
        }).call(this, ...args);
    }

    // Internal
}