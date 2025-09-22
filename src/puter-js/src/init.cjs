const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { resolve } = require('node:path');
/**
 * Method for loading puter.js in Node.js environment with auth token
 * @param {string} authToken - Optional auth token to initialize puter with
 * @returns {import('../index').puter} The `puter` object from puter.js
 */
const init = (authToken) => {
    const goodContext = {};
    Object.getOwnPropertyNames(globalThis).forEach(name => {
        try {
            goodContext[name] = globalThis[name];
        } catch {
            // silent fail
        }
    });
    goodContext.globalThis = goodContext;
    const code = readFileSync(`${resolve(__filename, '..')}/../dist/puter.js`, 'utf8');
    const context = vm.createContext(goodContext);
    vm.runInNewContext(code, context);
    if ( authToken ) {
        goodContext.puter.setAuthToken(authToken);
    }
    return goodContext.puter;
};

module.exports = { init };