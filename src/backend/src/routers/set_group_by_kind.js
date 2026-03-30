'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.js');
const config = require('../config');
const { DB_WRITE } = require('../services/database/consts.js');

// -----------------------------------------------------------------------//
// POST /set_group_by_kind
// -----------------------------------------------------------------------//
router.post('/set_group_by_kind', auth, express.json(), async (req, res, next) => {
    // check subdomain
    if ( require('../helpers').subdomain(req) !== 'api' ) {
        next();
    }

    // check if user is verified
    if ( (config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed ) {
        return res.status(400).send({ code: 'account_is_not_verified', message: 'Account is not verified' });
    }

    // validation
    if ( req.body.item_uid === undefined ) {
        return res.status(400).send('`item_uid` is required');
    }
    if ( req.body.group_by_kind === undefined ) {
        return res.status(400).send('`group_by_kind` is required');
    }
    if ( req.body.group_by_kind !== true && req.body.group_by_kind !== false ) {
        return res.status(400).send('`group_by_kind` must be a boolean');
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'ui');
    const { uuid2fsentry, chkperm } = require('../helpers');

    // get dir
    const item = await uuid2fsentry(req.body.item_uid);

    // item not found
    if ( item === false ) {
        return res.status(400).send({ error: { message: 'No entry found with this uid' } });
    }

    // must be dir
    if ( ! item.is_dir ) {
        return res.status(400).send('must be a directory');
    }

    // check permission
    if ( ! await chkperm(item, req.user.id, 'write') ) {
        return res.status(403).send({ code: 'forbidden', message: 'permission denied.' });
    }

    // save group_by_kind
    await db.write(
        'UPDATE fsentries SET group_by_kind = ? WHERE id = ?',
        [req.body.group_by_kind ? 1 : 0, item.id],
    );

    return res.send({});
});

module.exports = router;