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
"use strict"
const eggspress = require('../../api/eggspress.js');
const { Context } = require('../../util/context.js');

module.exports = eggspress('/cache/last-change-timestamp', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const svc_driver = Context.get('services').get('driver');
    const driver_response = await svc_driver.call({
        iface: 'puter-kvstore',
        method: 'get',
        args: { key: `last_change_timestamp:${req.user?.id}` },
    });
    const timestamp = driver_response.result;
    res.json({ timestamp });
});
