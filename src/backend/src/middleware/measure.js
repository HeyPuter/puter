const { pausing_tee } = require('../util/streamutil');
const putility = require('@heyputer/putility');

const _intercept_req = ({ data, req, next }) => {
    if ( ! req.readable ) {
        return next();
    }

    try {
        const [req_monitor, req_pass] = pausing_tee(req, 2);

        req_monitor.on('data', (chunk) => {
            data.sz_incoming += chunk.length;
        });

        const replaces = ['readable', 'pipe', 'on', 'once', 'removeListener'];
        for ( const replace of replaces ) {
            const replacement = req_pass[replace]
            Object.defineProperty(req, replace, {
                get () {
                    if ( typeof replacement === 'function' ) {
                        return replacement.bind(req_pass);
                    }
                    return replacement;
                }
            });
        }
    } catch (e) {
        console.error(e);
        return next();
    }
};

const _intercept_res = ({ data, res, next }) => {
    if ( ! res.writable ) {
        return next();
    }

    try {
        const org_write = res.write;
        const org_end = res.end;
      
        // Override the `write` method
        res.write = function (chunk, ...args) {
          if (Buffer.isBuffer(chunk)) {
            data.sz_outgoing += chunk.length;
          } else if (typeof chunk === 'string') {
            data.sz_outgoing += Buffer.byteLength(chunk);
          }
          return org_write.apply(res, [chunk, ...args]);
        };
      
        // Override the `end` method
        res.end = function (chunk, ...args) {
          if (chunk) {
            if (Buffer.isBuffer(chunk)) {
              data.sz_outgoing += chunk.length;
            } else if (typeof chunk === 'string') {
              data.sz_outgoing += Buffer.byteLength(chunk);
            }
          }
          const result = org_end.apply(res, [chunk, ...args]);
          return result;
        };
    } catch (e) {
        console.error(e);
        return next();
    }
};

function measure () {
    return async (req, res, next) => {
        const data = {
            sz_incoming: 0,
            sz_outgoing: 0,
        };

        _intercept_req({ data, req });
        _intercept_res({ data, res });

        req.measurements = new putility.libs.promise.TeePromise();

        // Wait for the request to finish processing
        res.on('finish', () => {
            req.measurements.resolve(data);
            // console.log(`Incoming Data: ${data.sz_incoming} bytes`);
            // console.log(`Outgoing Data: ${data.sz_outgoing} bytes`); // future
        });

        next();
    };
}

module.exports = measure;
