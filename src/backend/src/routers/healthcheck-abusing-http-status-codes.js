/*
 * Copyright (C) 2025-present Puter Technologies Inc.
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
"use strict"
const express = require('express');
const router = new express.Router();

// This endpoint is identical to /healthcheck except it reports status 500 when
// any service is failing, as though reporting such depended on the services
// working.
router.get('/healthcheck-abusing-http-status-codes', async (req, res) => {
    const svc_serverHealth = req.services.get('server-health');

    const status = await svc_serverHealth.get_status();
    res.status(status.ok ? 200 : 500).json(status);
})
module.exports = router
