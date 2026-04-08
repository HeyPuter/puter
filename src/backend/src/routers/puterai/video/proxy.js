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

const { Readable } = require('stream');
const { sha256 } = require('js-sha256');
const config = require('../../../config.js');
const eggspress = require('../../../api/eggspress.js');

const GEMINI_DOWNLOAD_BASE = 'https://generativelanguage.googleapis.com/download/v1beta/files';

module.exports = eggspress('/video/proxy', {
    allowedMethods: ['GET'],
}, async (req, res) => {
    const fileId = req.query.fileId;
    const provider = req.query.provider;
    const expires = req.query.expires;
    const signature = req.query.signature;

    if ( !fileId || typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(fileId) ) {
        return res.status(400).send('Invalid or missing fileId parameter');
    }

    if ( !expires || !signature ) {
        return res.status(403).send('Missing signature');
    }

    if ( Number(expires) < Date.now() / 1000 ) {
        return res.status(403).send('Signature expired');
    }

    const secret = config.url_signature_secret;
    const expected = sha256(`${fileId}/video-proxy/${secret}/${expires}`);
    if ( signature !== expected ) {
        return res.status(403).send('Invalid signature');
    }

    if ( provider === 'gemini' ) {
        const geminiConfig = config.services?.gemini;
        const apiKey = geminiConfig?.apiKey || geminiConfig?.secret_key;

        if ( ! apiKey ) {
            return res.status(500).send('Gemini API key not configured');
        }

        const url = `${GEMINI_DOWNLOAD_BASE}/${fileId}:download?alt=media&key=${apiKey}`;
        const videoUriResponse = await fetch(url);

        if ( ! videoUriResponse.ok ) {
            return res.status(videoUriResponse.status).send('Failed to fetch video');
        }

        const contentType = videoUriResponse.headers.get('content-type');
        if ( contentType ) {
            res.setHeader('Content-Type', contentType);
        }

        if ( videoUriResponse.body ) {
            Readable.fromWeb(videoUriResponse.body).pipe(res);
        } else {
            res.status(500).send('Empty response body');
        }
    } else {
        return res.status(400).send('Unsupported provider');
    }
});
