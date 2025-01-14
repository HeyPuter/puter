const express = require('express');
const { PassThrough } = require('stream');
const { pausing_tee } = require('../util/streamutil');

function measure () {
    return async (req, res, next) => {
        if ( ! req.readable ) {
            return next();
        }

        let sz_incoming = 0;
        // let sz_outgoing = 0; // future

        try {
            const [req_monitor, req_pass] = pausing_tee(req, 2);

            req_monitor.on('data', (chunk) => {
                sz_incoming += chunk.length;
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

        // Wait for the request to finish processing
        res.on('finish', () => {
            console.log(`Incoming Data: ${sz_incoming} bytes`);
            // console.log(`Outgoing Data: ${sz_outgoing} bytes`); // future
        });

        next();
    };
}

module.exports = measure;
