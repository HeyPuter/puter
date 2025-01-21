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
const { Context } = require("../util/context");

const featureflag = options => async (req, res, next) => {
    const { feature } = options;
    
    const context = Context.get();
    const services = context.get('services');
    const svc_featureFlag = services.get('feature-flag');

    if ( ! await svc_featureFlag.check({
        actor: req.actor,
    }, feature) ) {
        const e = APIError.create('forbidden');
        e.write(res);
        return;
    }

    next();
};

module.exports = featureflag;
