/**
 * This middleware checks the subdomain, and if the subdomain doesn't
 * match it calls `next('route')` to skip the current route.
 * Be sure to use this before any middleware that might erroneously
 * block the request.
 * 
 * @param {string|string[]} allowedSubdomains - The subdomain to allow;
 *    if an array, any of the subdomains in the array will be allowed.
 * 
 * @returns {function} - An express middleware function
 */
const subdomain = allowedSubdomains => {
    if ( ! Array.isArray(allowedSubdomains) ) {
        allowedSubdomains = [allowedSubdomains];
    }
    return async (req, res, next) => {
        // Note: at the time of implementing this, there is a config
        // option called `experimental_no_subdomain` that is designed
        // to lie and tell us the subdomain is `api` when it's not.
        const actual_subdomain = require('../helpers').subdomain(req);
        if ( ! allowedSubdomains.includes(actual_subdomain) ) {
            next('route');
            return;
        }

        next();
    };
}

module.exports = subdomain;
