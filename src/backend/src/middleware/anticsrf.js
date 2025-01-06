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

const APIError = require("../api/APIError");

const anticsrf = options => async (req, res, next) => {
    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! req.body.anti_csrf ) {
        const err = APIError.create('anti-csrf-incorrect');
        err.write(res);
        return;
    }
    const has = svc_antiCSRF.consume_token(req.user.uuid, req.body.anti_csrf);
    if ( ! has ) {
        const err = APIError.create('anti-csrf-incorrect');
        err.write(res);
        return;
    }
    
    next();
};

module.exports = anticsrf;
