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

const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { Context } = require("../../util/context");

module.exports = eggspress('/search/uid', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const services = Context.get('services');
    const svc_fsEntryFetcher = services.get('fsEntryFetcher');
    
    try {
        const { uid } = req.body;
        const fileInfo = await svc_fsEntryFetcher.findByUID(uid);
        
        if ( ! fileInfo ) {
            throw APIError.create('entity_not_found', null, {
                identifier: 'fs:' + uid,
            });
        }

        res.send(fileInfo);
    } catch (error) {
        next(error);
    }
});