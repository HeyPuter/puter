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
const APIError = require('../api/APIError');
const { UserActorType } = require('../services/auth/Actor');
const auth2 = require('./auth2');

const auth = async (req, res, next) => {
    let auth2_ok = false;
    try {
        // Delegate to new middleware
        await auth2(req, res, () => {
            auth2_ok = true;
        });
        if ( ! auth2_ok ) return;

        // Everything using the old reference to the auth middleware
        // should only allow session tokens
        if ( ! (req.actor.type instanceof UserActorType) ) {
            throw APIError.create('forbidden');
        }

        next();
    }
    // auth failed
    catch (e) {
        return res.status(401).send(e);
    }
};

module.exports = auth;