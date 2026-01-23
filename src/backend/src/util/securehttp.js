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
const { Resolver } = require('dns/promises');
const net = require('net');
const { URL } = require('url');
const APIError = require('../api/APIError');

// Cloudflare's malware-blocking DNS server
const SECURE_DNS_SERVER = '1.1.1.3';

// Create a DNS resolver using 1.1.1.3
let secureResolver = null;
function getSecureResolver () {
    if ( ! secureResolver ) {
        secureResolver = new Resolver();
        secureResolver.setServers([SECURE_DNS_SERVER]);
    }
    return secureResolver;
}

/**
 * Validates that a URL does not contain an IP address (IPv4 or IPv6).
 * Only domain names are allowed to prevent SSRF attacks.
 * @param {string} url - The URL to validate
 * @throws {APIError} If the URL contains an IP address
 */
function validateUrlNoIP (url) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (e) {
        throw APIError.create('field_invalid', null, {
            key: 'url',
            expected: 'valid URL',
            got: `invalid URL format: ${e.message}`,
        });
    }

    const hostname = parsedUrl.hostname;

    // Remove brackets from IPv6 addresses for validation
    const hostnameForValidation = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    // Use Node.js's built-in IP validation (more reliable than regex)
    const ipVersion = net.isIP(hostnameForValidation);
    if ( ipVersion === 4 || ipVersion === 6 ) {
        throw APIError.create('field_invalid', null, {
            key: 'url',
            expected: 'domain name (IP addresses not allowed)',
            got: `IPv${ipVersion} address`,
        });
    }

    // Additional check: reject localhost
    if ( hostnameForValidation === 'localhost' ) {
        throw APIError.create('field_invalid', null, {
            key: 'url',
            expected: 'domain name (localhost not allowed)',
            got: 'localhost',
        });
    }
}

/**
 * Creates a custom DNS lookup function that uses 1.1.1.3 for DNS resolution.
 * This function resolves hostnames using Node.js's built-in Resolver with the secure DNS server.
 * Falls back to system DNS if the secure resolver fails.
 * @param {string} hostname - The hostname to resolve
 * @param {Object} options - Lookup options
 * @param {Function} callback - Callback function (err, address, family)
 */
function secureDNSLookup (hostname, options, callback) {
    // First validate it's not an IP address (should have been validated already, but double-check)
    const hostnameForValidation = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    // Use Node.js's built-in IP validation
    const ipVersion = net.isIP(hostnameForValidation);
    if ( ipVersion === 4 || ipVersion === 6 ) {
        return callback(new Error('IP addresses not allowed'));
    }

    // Use Resolver with 1.1.1.3 to resolve the hostname
    const resolver = getSecureResolver();

    // Try IPv4 first, then IPv6
    (async () => {
        let resolverError = null;
        try {
            // Try IPv4 first
            const records = await resolver.resolve4(hostname);
            if ( records && records.length > 0 ) {
                const ip = records[0];
                // Validate it's actually an IP address
                if ( ip && typeof ip === 'string' && net.isIP(ip) === 4 ) {
                    console.log(`[securehttp] Resolved ${hostname} to ${ip} via 1.1.1.3 (IPv4)`);
                    return callback(null, ip, 4);
                }
            }
        } catch ( err ) {
            resolverError = err;
            // If IPv4 fails, try IPv6
            try {
                const records6 = await resolver.resolve6(hostname);
                if ( records6 && records6.length > 0 ) {
                    const ip6 = records6[0];
                    // Validate it's actually an IPv6 address
                    if ( ip6 && typeof ip6 === 'string' && net.isIP(ip6) === 6 ) {
                        console.log(`[securehttp] Resolved ${hostname} to ${ip6} via 1.1.1.3 (IPv6)`);
                        return callback(null, ip6, 6);
                    }
                }
            } catch ( err6 ) {
                // Both IPv4 and IPv6 failed with secure resolver
                console.warn(`[securehttp] Secure resolver (1.1.1.3) failed for ${hostname}: IPv4 error: ${resolverError.message}, IPv6 error: ${err6.message}, falling back to system DNS`);
            }
        }

        // Fallback to system DNS if secure resolver fails or returns no results
        dns.lookup(hostname, options, (lookupErr, address, family) => {
            if ( lookupErr ) {
                // If both failed, return a comprehensive error
                const errorMsg = resolverError
                    ? `DNS resolution failed: secure resolver (1.1.1.3) error: ${resolverError.message}, system DNS error: ${lookupErr.message}`
                    : `DNS resolution failed: ${lookupErr.message}`;
                console.error(`[securehttp] Failed to resolve ${hostname}: ${errorMsg}`);
                return callback(new Error(errorMsg));
            }

            // Validate the address before using it
            if ( !address || typeof address !== 'string' ) {
                const errorMsg = `System DNS returned invalid address for ${hostname}: ${address}`;
                console.error(`[securehttp] ${errorMsg}`);
                return callback(new Error(errorMsg));
            }

            // Validate it's actually an IP address
            const ipVersion = net.isIP(address);
            if ( ! ipVersion ) {
                const errorMsg = `System DNS returned non-IP address for ${hostname}: ${address}`;
                console.error(`[securehttp] ${errorMsg}`);
                return callback(new Error(errorMsg));
            }

            console.log(`[securehttp] Resolved ${hostname} to ${address} via system DNS (IPv${ipVersion})`);
            callback(null, address, family || ipVersion);
        });
    })();
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

    console.log(`[securehttp] Making secure request to ${url}`);

    // Create secure agents
    const { httpAgent, httpsAgent } = createSecureAgents();

    // Merge options with security settings
    const secureOptions = {
        ...options,
        maxRedirects: 0, // Disable redirects - axios will return 3xx responses without following
        httpAgent,
        httpsAgent,
        validateStatus: (status) => {
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

        console.log(`[securehttp] Successfully fetched ${url} (status: ${response.status})`);
        return response;
    } catch (e) {
        // Re-throw APIError if it's already one (e.g., from validateUrlNoIP or redirect check)
        if ( e instanceof APIError || (e.constructor && e.constructor.name === 'APIError') ) {
            throw e;
        }

        // Log the full error for debugging
        console.error(`[securehttp] Request failed for ${url}:`, e);

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
