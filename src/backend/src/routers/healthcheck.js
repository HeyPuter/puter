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
'use strict';
const express = require('express');
const config = require('../config');
const router = new express.Router();

const normalizeHostDomain = (domain) => {
    if ( typeof domain !== 'string' ) return null;
    const normalizedDomain = domain.trim().toLowerCase().replace(/^\./, '');
    if ( ! normalizedDomain ) return null;

    try {
        return new URL(`http://${normalizedDomain}`).hostname.toLowerCase();
    } catch {
        return normalizedDomain.split(':')[0] || null;
    }
};

const hostMatchesDomain = (hostname, domain) => {
    const normalizedHost = normalizeHostDomain(hostname);
    const normalizedDomain = normalizeHostDomain(domain);
    if ( !normalizedHost || !normalizedDomain ) return false;
    return normalizedHost === normalizedDomain ||
        normalizedHost.endsWith(`.${normalizedDomain}`);
};

const isHostedDomainRequest = (req) => {
    const requestHost = normalizeHostDomain(req.hostname ?? req.headers?.host);
    if ( ! requestHost ) return false;

    const hostedDomains = new Set();
    for ( const domain of [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
        config.private_app_hosting_domain,
        config.private_app_hosting_domain_alt,
    ] ) {
        const normalizedDomain = normalizeHostDomain(domain);
        if ( normalizedDomain ) {
            hostedDomains.add(normalizedDomain);
        }
    }

    return [...hostedDomains].some(hostedDomain =>
        hostMatchesDomain(requestHost, hostedDomain));
};

const get_status = async (req) => {
    const svc_serverHealth = req.services.get('server-health');
    return await svc_serverHealth.get_status();
};

const send_health_status = async (req, res, { fail_with_http_error = false }) => {
    const status = await get_status(req);
    const shouldFailWithHttpError =
        fail_with_http_error || !!req.query['return-http-error'];
    const httpStatus = shouldFailWithHttpError && !status.ok ? 500 : 200;
    res.status(httpStatus).json(status);
};

// -----------------------------------------------------------------------//
// GET /healthcheck
// -----------------------------------------------------------------------//
router.get('/healthcheck', async (req, res, next) => {
    if ( isHostedDomainRequest(req) ) {
        next();
        return;
    }

    await send_health_status(req, res, { fail_with_http_error: false });
});

module.exports = router;
