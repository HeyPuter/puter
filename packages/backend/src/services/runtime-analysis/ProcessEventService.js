/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { Context } = require("../../util/context");

class ProcessEventService {
    constructor ({ services }) {
        const log = services.get('log-service').create('process-event-service');
        const errors = services.get('error-service').create(log);

        // TODO: when the service lifecycle is implemented, but these
        //       in the init hook

        process.on('uncaughtException', async (err, origin) => {
            await Context.allow_fallback(async () => {
                errors.report('process:uncaughtException', {
                    source: err,
                    origin,
                    trace: true,
                    alarm: true,
                });
            });

        });

        process.on('unhandledRejection', async (reason, promise) => {
            await Context.allow_fallback(async () => {
                errors.report('process:unhandledRejection', {
                    source: reason,
                    promise,
                    trace: true,
                    alarm: true,
                });
            });
        });
    }
}

module.exports = {
    ProcessEventService,
};
