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
const fs_ = require('fs');

const FSAccessContext = require("./FSAccessContext");
const DatabaseFSEntryFetcher = require("./storage/DatabaseFSEntryFetcher");
const { DatabaseFSEntryService } = require('./storage/DatabaseFSEntryService.js');
const { ResourceService } = require('./storage/ResourceService.js');
const { SizeService } = require('./storage/SizeService.js');
const config = require('../config.js');
const { TraceService: FSTracer } = require('../services/TraceService.js');

const systemfs = new FSAccessContext();

systemfs.fsEntryFetcher = new DatabaseFSEntryFetcher();
systemfs.fsEntryService = new DatabaseFSEntryService();
systemfs.resourceService = new ResourceService();
systemfs.sizeService = new SizeService();
systemfs.traceService = new FSTracer();

// Log usages every 10 seconds for debugging
if ( config.usages_debug ) setInterval(async ()=>{
    await fs_.promises.writeFile('/tmp/user_usages.json', JSON.stringify(systemfs.sizeService.usages, null, 4));
}, 10*1000);

module.exports = systemfs;
