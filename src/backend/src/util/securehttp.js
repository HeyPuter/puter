/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { URL } = require('url');
const APIError = require('../api/APIError');

// Cloudflare's malware-blocking DNS server
const SECURE_DNS_SERVER = '1.1.1.3';

/**
 * Validates that a URL does not contain an IP address (IPv4 or IPv6).
 * Only domain names are allowed to prevent SSRF attacks.
 *
 * This is NOT the only validation required to prevent SSRF attacks.
 *
 * @param {string} url - The URL to validate
 * @throws {APIError} If the URL contains an IP address
 */
function validateUrlNoIP (url) {
    const parsedUrl = new URL(url);

    const hostname = parsedUrl.hostname;

    // Remove brackets from IPv6 addresses for validation
    const hostnameForValidation = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    // Disallow specifying the host by IP address directly.
    // (we want to always use CloudFlare DNS here)
    const ipVersion = net.isIP(hostnameForValidation);
    if ( ipVersion === 4 || ipVersion === 6 ) {
        throw APIError.create('ip_not_allowed');
    }

    // This is not necessary, but there's no reason not to disallow this
    if ( hostnameForValidation === 'localhost' ) {
        throw APIError.create('ip_not_allowed');
    }
}

/**
 * Creates a custom DNS lookup function that uses 1.1.1.3 for DNS resolution.
 * This function resolves hostnames using Node.js's built-in Resolver with the secure DNS server.
 * @param {string} hostname - The hostname to resolve
 * @param {Object|number|Function} options - Lookup options, family number, or callback
 * @param {Function} callback - Callback function (err, address, family) or (err, addresses[])
 */
function secureDNSLookup (hostname, options, callback) {
    // Overloading (possible call signatures)
    if ( typeof options === 'function' ) {
        callback = options;
        options = { family: 0, all: false };
    } else if ( typeof options === 'number' ) {
        options = { family: options, all: false };
    } else if ( ! options ) {
        options = { family: 0, all: false };
    }

    const family = options.family || 0; // 0 = both, 4 = IPv4, 6 = IPv6
    const all = options.all || false;

    const hostnameForValidation = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    // Ensure IP addresses don't reach this DNS lookup
    // (already checked in validateUrlNoIP, but double-check in
    //  case this ever is called elsewhere)
    const ipVersion = net.isIP(hostnameForValidation);
    if ( ipVersion === 4 || ipVersion === 6 ) {
        return callback(new Error('IP addresses not allowed'));
    }

    // Use Resolver with 1.1.1.3 to resolve the hostname
    const resolver = new dns.Resolver();
    resolver.setServers([SECURE_DNS_SERVER]);

    const resolveAddresses = (err, addresses, addrFamily) => {
        if ( err || !addresses || addresses.length === 0 ) {
            console.error(`[securehttp] Failed to resolve ${hostname}:`, err || 'No addresses found');
            return callback(err || new Error('No addresses found'));
        }

        if ( all ) {
            const result = addresses.map(addr => ({ address: addr, family: addrFamily }));
            callback(null, result);
        } else {
            callback(null, addresses[0], addrFamily);
        }
    };

    if ( family === 4 || family === 0 ) {
        resolver.resolve4(hostname, (err, addresses) => {
            if ( !err && addresses && addresses.length > 0 ) {
                console.log(`[securehttp] Resolved ${hostname} to ${addresses[0]} via 1.1.1.3 (IPv4)`);
                resolveAddresses(null, addresses, 4);
            } else if ( family === 4 ) {
                // If we only wanted IPv4 and it failed, return error
                resolveAddresses(err || new Error('No IPv4 addresses found'), null, 4);
            } else {
                // Try IPv6 as fallback
                resolver.resolve6(hostname, (err6, addresses6) => {
                    if ( !err6 && addresses6 && addresses6.length > 0 ) {
                        console.log(`[securehttp] Resolved ${hostname} to ${addresses6[0]} via 1.1.1.3 (IPv6)`);
                        resolveAddresses(null, addresses6, 6);
                    } else {
                        resolveAddresses(err6 || err || new Error('No addresses found'), null, 0);
                    }
                });
            }
        });
    } else if ( family === 6 ) {
        // IPv6 only
        resolver.resolve6(hostname, (err, addresses) => {
            if ( !err && addresses && addresses.length > 0 ) {
                console.log(`[securehttp] Resolved ${hostname} to ${addresses[0]} via 1.1.1.3 (IPv6)`);
                resolveAddresses(null, addresses, 6);
            } else {
                resolveAddresses(err || new Error('No IPv6 addresses found'), null, 6);
            }
        });
    } else {
        callback(new Error('Invalid family'));
    }
}

/**
 * Creates secure HTTP and HTTPS agents with custom DNS lookup and no redirects.
 * @returns {Object} Object containing httpAgent and httpsAgent
 */
function createSecureAgents () {
    const httpAgent = new http.Agent({
        lookup: secureDNSLookup,
        keepAlive: false,
    });

    const httpsAgent = new https.Agent({
        lookup: secureDNSLookup,
        keepAlive: false,
    });

    return { httpAgent, httpsAgent };
}

/**
 * Makes a secure HTTP request using axios with SSRF protections:
 * - Validates URL does not contain IP addresses
 * - Disables redirects
 * - Uses secure DNS resolution (1.1.1.3)
 * @param {Object} axios - The axios instance
 * @param {string} url - The URL to request
 * @param {Object} options - Additional axios options
 * @returns {Promise} Axios response
 */
async function secureAxiosRequest (axios, url, options = {}) {
    // Validate URL doesn't contain IP addresses
    validateUrlNoIP(url);

    // Create secure agents
    const { httpAgent, httpsAgent } = createSecureAgents();

    // Merge options with security settings
    const secureOptions = {
        ...options,
        maxRedirects: 0, // Disable redirects - axios will return 3xx responses without following
        httpAgent,
        httpsAgent,
        validateStatus: (_status) => {
            // Accept all status codes so we can check for redirects
            return true;
        },
    };

    try {
        const response = await axios.get(url, secureOptions);

        // Check if the response is a redirect (maxRedirects: 0 means axios returns but doesn't follow)
        if ( response.status >= 300 && response.status < 400 ) {
            throw APIError.create('field_invalid', null, {
                key: 'url',
                expected: 'web URL (redirects not allowed)',
                got: `redirect to ${response.headers.location || 'unknown'}`,
            });
        }

        // Log different information based on URL type
        const parsedUrl = new URL(url);
        if ( parsedUrl.protocol === 'data:' ) {
            // Extract data format from data URL
            const dataFormat = url.split(',')[0].split(':')[1] || 'unknown format';
            console.log(`[securehttp] Successfully processed data URL with format: ${dataFormat}`);
        } else {
            console.log(`[securehttp] Successfully fetched ${url} (status: ${response.status})`);
        }
        return response;
    } catch (e) {
        // Re-throw APIError if it's already one (e.g., from validateUrlNoIP or redirect check)
        if ( e instanceof APIError || (e.constructor && e.constructor.name === 'APIError') ) {
            throw e;
        }

        // Log different information based on URL type
        const parsedUrl = new URL(url);
        if ( parsedUrl.protocol === 'data:' ) {
            // Extract data format from data URL
            const dataFormat = url.split(',')[0].split(':')[1] || 'unknown format';
            console.error(`[securehttp] Request failed for data URL with format: ${dataFormat}:`, e);
        } else {
            console.error(`[securehttp] Request failed for ${url}:`, e);
        }

        // Handle redirect errors in catch block (in case axios throws for redirects)
        if ( e.response && (e.response.status === 301 || e.response.status === 302 ||
            e.response.status === 303 || e.response.status === 307 || e.response.status === 308) ) {
            throw APIError.create('field_invalid', null, {
                key: 'url',
                expected: 'web URL (redirects not allowed)',
                got: `redirect to ${e.response.headers.location || 'unknown'}`,
            });
        }

        // Provide more detailed error messages
        let errorMessage = e.message;
        if ( e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ) {
            errorMessage = `DNS resolution failed: ${e.message}`;
        } else if ( e.code === 'ECONNREFUSED' ) {
            errorMessage = `Connection refused: ${e.message}`;
        } else if ( e.code === 'ETIMEDOUT' ) {
            errorMessage = `Connection timeout: ${e.message}`;
        }

        throw APIError.create('field_invalid', null, {
            key: 'url',
            expected: 'web URL',
            got: errorMessage,
        });
    }
}

module.exports = {
    validateUrlNoIP,
    createSecureAgents,
    secureAxiosRequest,
};
