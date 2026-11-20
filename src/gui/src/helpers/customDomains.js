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

// The `/custom-domains` API as the GUI talks to it, with its own session:
// the desktop's attach dialog and the dashboard's publish dialog share it.

/**
 * @typedef {object} CustomDomainRecord
 * @property {string} type
 * @property {string} name
 * @property {string} value
 * @property {'routing'|'redirect'|string} [purpose]
 * @property {boolean} [required]
 */

/**
 * @typedef {object} CustomDomain
 * @property {string} uuid
 * @property {string} hostname
 * @property {string} site Subdomain of the website it serves.
 * @property {'active'|'pending'|'failed'|string} status
 * @property {string} [statusDetail]
 * @property {boolean} [isApex]
 * @property {string} [redirectFrom] The root domain forwarding to `hostname`.
 * @property {string} [dnsProvider]
 * @property {CustomDomainRecord[]} [records]
 */

/**
 * @typedef {object} CustomDomainResponse
 * @property {number} status
 * @property {boolean} ok
 * @property {any} data The parsed JSON body, or null.
 */

/** API error code → message key; anything unlisted gets the server's message. */
const ERROR_KEYS = {
    invalid_hostname: 'custom_domain_error_invalid',
    custom_domain_taken: 'custom_domain_error_taken',
    custom_domain_limit_reached: 'custom_domain_error_limit',
    custom_domain_rejected: 'custom_domain_error_rejected',
    site_not_found: 'custom_domain_error_site',
    custom_domain_not_found: 'custom_domain_error_not_found',
    custom_domains_not_enabled: 'custom_domain_not_enabled',
    custom_domains_permission_required: 'custom_domain_error_generic',
};

/** Error codes that mean "try another hostname". */
export const CUSTOM_DOMAIN_HOSTNAME_ERRORS = new Set([
    'invalid_hostname',
    'custom_domain_taken',
    'custom_domain_rejected',
]);

const STATUSES = new Set(['active', 'pending', 'failed']);

/**
 * A domain's status as the GUI draws it; anything unknown reads as pending.
 *
 * @param {Partial<CustomDomain> | null | undefined} domain
 * @returns {'active'|'pending'|'failed'}
 */
export const customDomainStatus = (domain) => (STATUSES.has(domain?.status) ? domain.status : 'pending');

/**
 * The monthly price the list call reports, in the user's locale.
 *
 * @param {{ amount?: number, currency?: string } | null | undefined} pricing
 * @returns {string | null}
 */
export const formatCustomDomainPrice = (pricing) => {
    if ( ! pricing || typeof pricing.amount !== 'number' ) return null;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: pricing.currency || 'USD',
            minimumFractionDigits: 2,
        }).format(pricing.amount);
    } catch {
        return null;
    }
};

/**
 * Calls `/custom-domains{path}`. Resolves with the status and parsed body,
 * even for an error status; rejects only when the request itself fails.
 *
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} [path] Starting with `/`, after `/custom-domains`.
 * @param {object} [body]
 * @param {string} [authToken] Defaults to the GUI's session.
 * @returns {Promise<CustomDomainResponse>}
 */
export const customDomainsRequest = async (method, path = '', body, authToken = puter.authToken ?? window.auth_token) => {
    const res = await fetch(`${window.api_origin}/custom-domains${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${authToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        // Non-JSON body; callers go by the status.
    }
    return { status: res.status, ok: res.ok, data };
};

/**
 * Plain text for a failed response. A known code gets our wording; anything
 * else shows what the server said, which beats a generic message when
 * something is misconfigured.
 *
 * @param {CustomDomainResponse} res
 * @returns {string}
 */
export const customDomainErrorText = (res) => {
    const text = (key) => i18n(key, [], false);
    if ( res.status === 402 ) return text('custom_domain_error_plan');
    if ( res.status === 429 ) return text('custom_domain_error_rate_limited');
    const key = ERROR_KEYS[res.data?.code];
    if ( key ) return text(key);
    if ( typeof res.data?.message === 'string' && res.data.message ) {
        return res.data.message;
    }
    return `${text('custom_domain_error_generic')} (HTTP ${res.status})`;
};

/**
 * What to show after a status check. A domain that is no longer pending
 * comes back with only its routing record, and a GET never repeats the DNS
 * provider or the redirect, so those are kept from what was shown before.
 *
 * @param {CustomDomain} known What the add (or the last check) returned.
 * @param {CustomDomain} fresh What the GET returned.
 * @returns {CustomDomain}
 */
export const mergeCustomDomainRefresh = (known, fresh) => {
    const knownRecords = known.records ?? [];
    const redirect = knownRecords.filter((r) => r.purpose === 'redirect');
    const records = (fresh.records?.length > 1 ? fresh.records : knownRecords)
        .filter((r) => r.purpose !== 'redirect');
    return {
        ...fresh,
        dnsProvider: known.dnsProvider,
        redirectFrom: known.redirectFrom,
        records: [...records.slice(0, 1), ...redirect, ...records.slice(1)],
    };
};
