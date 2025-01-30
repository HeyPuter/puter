import putility from '@heyputer/putility';
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
        const socket = puter.fs.socket;
        const tokenPromise = new putility.libs.promise.TeePromise();
        const resultPromise = new putility.libs.promise.TeePromise();
        const listener = async result => {
            const token = await tokenPromise;
            if ( result.id !== token ) return;
            resultPromise.resolve(result);
            socket.off('submission.done', listener);
        };
        socket.on('submission.done', listener);
        
        const { token } = await utils.make_driver_method([
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
        tokenPromise.resolve(token);
        return await resultPromise;
    }

    // Internal
}