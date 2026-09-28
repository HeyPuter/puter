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

import { loadConfig } from '../config';
import { SmtpReceiver } from './SmtpReceiver.js';
import {
    SmtpConfigError,
    isLocalServerEnabled,
    resolveSmtpConfig,
} from './config.js';
import { describeTarget } from './ingressClient.js';

// Its own process rather than part of the server: it binds its own port, and a
// fault here should not take the API down with it.
if (require.main === module) {
    const config = loadConfig();

    if (!isLocalServerEnabled(config)) {
        console.log(
            '[smtp] userEmail.localServer is not enabled - nothing to run',
        );
        process.exit(0);
    }

    let cfg;
    try {
        cfg = resolveSmtpConfig(config);
    } catch (err) {
        if (!(err instanceof SmtpConfigError)) throw err;
        console.error(`[smtp] ${err.message}`);
        process.exit(1);
    }

    const receiver = new SmtpReceiver(cfg);
    receiver
        .listen()
        .then(({ port }) => {
            console.log(
                `[smtp] accepting mail for ${cfg.domains.join(', ')} on ${cfg.host}:${port}`,
            );
            console.log(
                `[smtp] forwarding to ${describeTarget(cfg.ingressUrl)}`,
            );
        })
        .catch((err: Error) => {
            console.error(`[smtp] failed to listen: ${err.message}`);
            process.exit(1);
        });

    const shutDown = async () => {
        await receiver.close();
        process.exit(0);
    };
    process.on('SIGINT', shutDown);
    process.on('SIGTERM', shutDown);
}
