const { existsSync, readFileSync } = require('node:fs');
const vm = require('node:vm');
const { resolve } = require('node:path');
const open = require('open');

// `puter.cjs` only exists after `prepublishOnly` renames webpack's output, so
// fall back to the raw bundle — a plain `npm run build` is then enough to use
// the CLI from a source checkout.
const resolveBundle = () => {
    const dist = `${resolve(__filename, '..')}/../dist`;
    for (const name of ['puter.cjs', 'puter.js']) {
        const candidate = `${dist}/${name}`;
        if (existsSync(candidate)) return candidate;
    }
    throw new Error(
        'puter.js bundle not found — run `npm run build` in src/puter-js first',
    );
};
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
    const code = readFileSync(resolveBundle(), 'utf8');
    const context = vm.createContext(goodContext);
    vm.runInNewContext(code, context);
    if ( authToken ) {
        goodContext.puter.setAuthToken(authToken);
    }
    return goodContext.puter;
};

const getAuthToken = (guiOrigin = 'https://puter.com') => {
    const http = require('node:http');
    const state = require('node:crypto').randomBytes(32).toString('base64url');

    return new Promise((resolve, reject) => {
        let consumed = false;
        const requestListener = function (/**@type {IncomingMessage} */ req, res) {
            let callback;
            try {
                callback = new URL(req.url, 'http://127.0.0.1/');
            } catch {
                res.writeHead(400);
                res.end('Invalid authentication callback.');
                return;
            }
            const token = callback.searchParams.get('token');
            if (consumed || req.method !== 'GET' || callback.pathname !== '/' ||
                callback.searchParams.getAll('state').length !== 1 ||
                callback.searchParams.get('state') !== state ||
                callback.searchParams.getAll('token').length !== 1 || !token) {
                res.writeHead(400);
                res.end('Invalid authentication callback.');
                return;
            }
            consumed = true;
            server.close();
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful - Puter</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #404C71;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 48px;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            max-width: 420px;
            margin: 20px;
        }
        .checkmark {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #00c853 0%, #00e676 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            animation: scaleIn 0.5s ease-out;
        }
        .checkmark svg {
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
            fill: none;
            animation: drawCheck 0.6s ease-out 0.3s forwards;
            stroke-dasharray: 50;
            stroke-dashoffset: 50;
        }
        @keyframes scaleIn {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
        }
        @keyframes drawCheck {
            to { stroke-dashoffset: 0; }
        }
        h1 {
            color: #1a1a2e;
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        p {
            color: #64748b;
            font-size: 16px;
            line-height: 1.6;
        }
        .puter-logo {
            margin-top: 32px;
            opacity: 0.6;
            font-size: 14px;
            color: #94a3b8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">
            <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <h1>Authentication Successful</h1>
        <p>You're all set! You may now close this window and return to your terminal.</p>
        <div class="puter-logo">Powered by Puter</div>
    </div>
</body>
</html>`);

            resolve(token);
        };
        const server = http.createServer(requestListener);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', function () {
            try {
                const callback = new URL(`http://127.0.0.1:${this.address().port}/`);
                callback.searchParams.set('state', state);
                const signIn = new URL(guiOrigin);
                signIn.searchParams.set('action', 'authme');
                signIn.searchParams.set('redirectURL', callback.href);
                Promise.resolve(open.default(signIn.href)).catch(error => {
                    server.close();
                    reject(error);
                });
            } catch (error) {
                server.close();
                reject(error);
            }
        });
    });
};

module.exports = { init, getAuthToken };