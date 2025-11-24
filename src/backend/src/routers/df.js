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
const config = require('../config.js');
const router = new express.Router();
const auth = require('../middleware/auth.js');

// TODO: Why is this both a POST and a GET?

// -----------------------------------------------------------------------//
// POST /df
// -----------------------------------------------------------------------//
router.post('/df', auth, express.json(), async (req, response, next) => {
    // check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' )
    {
        next();
    }

    // check if user is verified
    if ( (config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed )
    {
        return response.status(400).send({ code: 'account_is_not_verified', message: 'Account is not verified' });
    }

    const { df } = require('../helpers');
    const svc_hostDiskUsage = req.services.get('host-disk-usage', { optional: true });
    try {
        // auth
        response.send({
            used: parseInt(await df(req.user.id)),
            capacity: config.is_storage_limited ? (req.user.free_storage === undefined || req.user.free_storage === null) ? config.storage_capacity : req.user.free_storage : config.available_device_storage,
            ...(svc_hostDiskUsage ? svc_hostDiskUsage.get_extra() : {}),
        });
    } catch (e) {
        console.log(e);
        response.status(400).send();
    }
});

// -----------------------------------------------------------------------//
// GET /df
// -----------------------------------------------------------------------//
router.get('/df', auth, express.json(), async (req, response, next) => {
    // check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' )
    {
        next();
    }

    // check if user is verified
    if ( (config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed )
    {
        return response.status(400).send({ code: 'account_is_not_verified', message: 'Account is not verified' });
    }

    const { df } = require('../helpers');
    const svc_hostDiskUsage = req.services.get('host-disk-usage', { optional: true });
    try {
        // auth
        response.send({
            used: parseInt(await df(req.user.id)),
            capacity: config.is_storage_limited ? (req.user.free_storage === undefined || req.user.free_storage === null) ? config.storage_capacity : req.user.free_storage : config.available_device_storage,
            ...(svc_hostDiskUsage ? svc_hostDiskUsage.get_extra() : {}),
        });
    } catch (e) {
        console.log(e);
        response.status(400).send();
    }
});

module.exports = router;