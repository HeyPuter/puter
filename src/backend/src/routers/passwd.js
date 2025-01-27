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
const express = require('express');
const { invalidate_cached_user, get_user } = require('../helpers');
const router = new express.Router();
const auth = require('../middleware/auth.js');
const { DB_WRITE } = require('../services/database/consts');

// -----------------------------------------------------------------------//
// POST /passwd
// -----------------------------------------------------------------------//
router.post('/passwd', auth, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const bcrypt = require('bcrypt');

    if(!req.body.old_pass)
        return res.status(401).send('old_pass is required')
    // old_pass must be a string
    else if (typeof req.body.old_pass !== 'string')
        return res.status(400).send('old_pass must be a string.')
    else if(!req.body.new_pass)
        return res.status(401).send('new_pass is required')
    // new_pass must be a string
    else if (typeof req.body.new_pass !== 'string')
        return res.status(400).send('new_pass must be a string.')

    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('passwd') ) {
        return res.status(429).send('Too many requests.');
    }

    try{
        const user = await get_user({ id: req.user.id, force: true });
        // check old_pass
        const isMatch = await bcrypt.compare(req.body.old_pass, user.password)
        if(!isMatch)
            return res.status(400).send('old_pass does not match your current password.')
        // check new_pass length
        // todo use config, 6 is hard-coded and wrong
        else if(req.body.new_pass.length < 6)
            return res.status(400).send('new_pass must be at least 6 characters long.')
        else{
            await db.write(
                'UPDATE user SET password=?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ?',
                [await bcrypt.hash(req.body.new_pass, 8), req.user.id]
            );
            invalidate_cached_user(req.user);

            const svc_email = req.services.get('email');
            svc_email.send_email({ email: user.email }, 'password_change_notification');

            return res.send('Password successfully updated.')
        }
    }catch(e){
        return res.status(401).send('an error occured');
    }
})

module.exports = router