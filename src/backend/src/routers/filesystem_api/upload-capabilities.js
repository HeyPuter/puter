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

const eggspress = require('../../api/eggspress.js');
const { NodePathSelector } = require('../../filesystem/node/selectors.js');
const config = require('../../config.js');

module.exports = eggspress('/upload/capabilities', {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    json: true,
    allowedMethods: ['GET', 'POST'],
}, async (req, res) => {
    const signedConfig = config.signed_uploads ?? {};
    if ( ! signedConfig.enabled ) {
        return res.send({
            supported: false,
            reason: 'disabled',
            signedUploads: false,
            multipart: false,
        });
    }

    const fs = req.services.get('filesystem');
    const pathCandidate =
        req.query?.parent_path ??
        req.body?.parent_path ??
        `/${req.user.username}`;
    const parent = await fs.node(new NodePathSelector(pathCandidate));
    const provider = parent.provider;
    const capabilities =
        provider.getSignedUploadCapabilities?.() ??
        provider.storageController?.getUploadCapabilities?.() ?? {
            signedUploads: false,
            multipart: false,
            reason: 'unsupported',
        };

    return res.send({
        supported: Boolean(capabilities.signedUploads),
        ...capabilities,
        multipartThresholdBytes:
            signedConfig.multipart_threshold_bytes ?? 64 * 1024 * 1024,
        multipartPartSizeBytes:
            signedConfig.multipart_part_size_bytes ?? 8 * 1024 * 1024,
        urlExpirySeconds:
            signedConfig.url_expiry_seconds ?? 15 * 60,
        sessionTtlSeconds:
            signedConfig.session_ttl_seconds ?? 60 * 60,
    });
});
