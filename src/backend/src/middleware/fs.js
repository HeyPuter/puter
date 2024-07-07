/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const FSAccessContext = require('../filesystem/FSAccessContext.js');

const fs = (req, res, next)=>{
    const systemfs = req.services.get('filesystem').get_systemfs();
    try {
        const fs = new FSAccessContext();
        fs.fsEntryFetcher = systemfs.fsEntryFetcher;
        fs.fsEntryService = systemfs.fsEntryService;
        fs.resourceService = systemfs.resourceService;
        fs.sizeService = systemfs.sizeService;
        fs.traceService = systemfs.traceService;
        fs.user = req.user;
        fs.services = req.services;

        // TODO: Decorate with AuthEntryFetcher

        req.fs = fs;
    } catch (e) {
        // TODO: log details about this error to another service
        console.error(e);
        return res.status(500).send({
            // TODO: standardize 500 errors to avoid inference attacks
            error: 'the operation could not be completed'
        });
    }
    next();
}

module.exports = fs;
