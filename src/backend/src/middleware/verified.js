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
const config = require("../config")

const verified = async (req, res, next)=>{
    if ( ! config.strict_email_verification_required ) {
        next();
        return;
    }

    if ( ! req.user.requires_email_confirmation ) {
        next();
        return;
    }

    if ( req.user.email_confirmed ) {
        next();
        return;
    }

    res.status(400).send({
        code: 'account_is_not_verified',
        message: 'Account is not verified'
    });
}

module.exports = verified
