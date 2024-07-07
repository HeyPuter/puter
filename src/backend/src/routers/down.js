"use strict"
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.js');
const config = require('../config.js');
const fs = require('../middleware/fs.js');
const { DB_WRITE } = require('../services/database/consts.js');
const { NodePathSelector } = require('../filesystem/node/selectors.js');
const { HLRead } = require('../filesystem/hl_operations/hl_read.js');

// -----------------------------------------------------------------------//
// GET /down
// -----------------------------------------------------------------------//
router.post('/down', auth, fs, express.json(), async (req, res, next)=>{
    // check subdomain
    if(require('../helpers').subdomain(req) !== 'api')
        next();

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed)
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});

    // check anti-csrf token
    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! svc_antiCSRF.consume_token(req.user.uuid, req.body.anti_csrf) ) {
        return res.status(400).json({ message: 'incorrect anti-CSRF token' });
    }

    // validation
    if(!req.query.path)
        return res.status(400).send('path is required')
    // path must be a string
    else if (typeof req.query.path !== 'string')
        return res.status(400).send('path must be a string.')
    else if(req.query.path.trim() === '')
        return res.status(400).send('path cannot be empty')

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'filesystem');
    const _path = require('path');
    const {chkperm} = require('../helpers')
    const path       = _path.resolve('/', req.query.path);
    const AWS        = require('aws-sdk');

    // cannot download the root, because it's a directory!
    if(path === '/')
        return res.status(400).send('Cannot download a directory.');

    // resolve path to its FSEntry
    const fsnode = await req.fs.node(new NodePathSelector(path));

    // not found
    if( ! fsnode.exists() ) {
        return res.status(404).send('File not found');
    }

    // stream data from S3
    try{
        const hl_read = new HLRead();
        const stream = await hl_read.run({
            fsNode: fsnode,
            user: req.user,
        });
        // let stream = await s3.getObject({
        //     Bucket: fsentry.bucket,
        //     Key: fsentry.uuid, // File name you want to save as in S3
        // }).createReadStream().on('error', error => {
        //     console.log(error);
        // });
        res.attachment(await fsnode.get('name'));
        return stream.pipe(res);
    }catch(e){
        console.log(e);
        return res.type('application/json').status(500).send({message: 'There was an internal problem reading the file.'});
    }
})

module.exports = router
