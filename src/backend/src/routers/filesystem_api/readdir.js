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
"use strict"
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.js');
const config = require('../../config.js');
const PerformanceMonitor = require('../../monitor/PerformanceMonitor.js');
const { Context } = require('../../util/context.js');
const eggspress = require('../../api/eggspress.js');
const FSNodeParam = require('../../api/filesystem/FSNodeParam.js');
const FlagParam = require('../../api/filesystem/FlagParam.js');
const { LLReadDir } = require('../../filesystem/ll_operations/ll_readdir.js');
const { HLReadDir } = require('../../filesystem/hl_operations/hl_readdir.js');

// -----------------------------------------------------------------------//
// POST /readdir
// -----------------------------------------------------------------------//
module.exports = eggspress('/readdir', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    alias: { uid: 'path' },
    parameters: {
        subject: new FSNodeParam('path'),
        recursive: new FlagParam('recursive', { optional: true }),
        no_thumbs: new FlagParam('no_thumbs', { optional: true }),
        no_assocs: new FlagParam('no_assocs', { optional: true }),
    }
}, async (req, res, next) => {
    let log; {
        const x = Context.get();
        log = x.get('services').get('log-service').create('readdir');
        log.info(`readdir: ${req.body.path}`);
    }

    const subject = req.values.subject;
    const recursive = req.values.recursive;
    const no_thumbs = req.values.no_thumbs;
    const no_assocs = req.values.no_assocs;

    const hl_readdir = new HLReadDir();
    const result = await hl_readdir.run({
        subject,
        recursive,
        no_thumbs,
        no_assocs,
        user: req.user,
        actor: req.actor,
    });

    // check for duplicate names
    if ( ! recursive ) {
        const names = new Set();
        for ( const entry of result ) {
            if ( names.has(entry.name) ) {
                log.error(`Duplicate name: ${entry.name}`);
                // throw new Error(`Duplicate name: ${entry.name}`);
            }
            names.add(entry.name);
        }
    }

    res.send(result);
    return;
});
