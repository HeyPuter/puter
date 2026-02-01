const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { resolve } = require('node:path');
const { IncomingMessage } = require('node:http');
const open = require('open');
/**
 * Method for loading puter.js in Node.js environment with auth token
 * @param {string} authToken - Optional auth token to initialize puter with
 * @returns {import('../index').puter} The `puter` object from puter.js
 */
const init = (authToken) => {
    const goodContext = {
        PUTER_API_ORIGIN: globalThis.PUTER_API_ORIGIN,
        PUTER_ORIGIN: globalThis.PUTER_ORIGIN,
    };
    Object.getOwnPropertyNames(globalThis).forEach(name => {
        try {
            goodContext[name] = globalThis[name];
        } catch {
            // silent fail
        }
    });
    goodContext.globalThis = goodContext;
    const code = readFileSync(`${resolve(__filename, '..')}/../dist/puter.cjs`, 'utf8');
    const context = vm.createContext(goodContext);
    vm.runInNewContext(code, context);
    if ( authToken ) {
        goodContext.puter.setAuthToken(authToken);
    }
    return goodContext.puter;
};

const getAuthToken = (guiOrigin = 'https://puter.com') => {
    const http = require('http');

    return new Promise((resolve) => {
        const requestListener = function (/**@type {IncomingMessage} */ req, res) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Authentication Granted! You maty now close this window.');

            resolve(new URL(req.url, 'http://localhost/').searchParams.get('token'));
        };
        const server = http.createServer(requestListener);
        server.listen(0, function () {
            const url = `${guiOrigin}/?action=authme&redirectURL=${encodeURIComponent('http://localhost:') + this.address().port}`;
            open.default(url);
        });
    });
};

module.exports = { init, getAuthToken };