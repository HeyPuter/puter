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
const eggspress = require('../../api/eggspress.js');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLStat } = require('../../filesystem/hl_operations/hl_stat.js');

module.exports = eggspress('/stat', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['GET', 'POST'],
    alias: {
        path: 'subject',
        uid: 'subject',
    },
    parameters: {
        subject: new FSNodeParam('subject'),
    },
}, async (req, res, next) => {
    // modules
    const hl_stat = new HLStat();
    const result = await hl_stat.run({
        subject: req.values.subject,
        user: req.user,
        return_subdomains: req.body.return_subdomains,
        return_permissions: req.body.return_permissions,
        return_shares: req.body.return_shares,
        return_versions: req.body.return_versions,
        return_size: req.body.return_size,
    });
    res.send(result);
});
