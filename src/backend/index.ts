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

import { isSpanContextValid, trace } from '@opentelemetry/api';
import { puterClients } from './clients';
import { loadConfig } from './config';
import { puterControllers } from './controllers';
import { puterDrivers } from './drivers';
import { PuterServer } from './server';
import { puterServices } from './services';
import { puterStores } from './stores';
import { createGracefulShutdown } from './util/gracefulShutdown.js';
import { installJsonConsole } from './util/jsonConsole.js';

// How long a node with a server identity keeps serving in-flight work after
// it stops accepting connections.
const GRACEFUL_DRAIN_MS = 90_000;

// if called directly, start the server
if (require.main === module) {
    const config = loadConfig();

    // Structured logging: when `log_format: "json"`, replace the global console
    // so each call emits one JSON line (level, timestamp, msg, and the active
    // trace id) — one event per call, so a line-oriented log collector can't
    // split stack traces across events. Installed here rather than in the OTel
    // preload so it applies even when telemetry is disabled; the trace id is
    // simply absent when no span is active.
    if (config.log_format === 'json') {
        installJsonConsole({
            getTraceContext: () => {
                const ctx = trace.getActiveSpan()?.spanContext();
                if (!ctx || !isSpanContextValid(ctx)) return undefined;
                return { traceId: ctx.traceId, spanId: ctx.spanId };
            },
        });
    }

    const server = new PuterServer(
        config,
        puterClients,
        puterStores,
        puterServices,
        puterControllers,
        puterDrivers,
    );
    server.start();
    // Owns process exit on signals; the telemetry preload installs none and is
    // flushed as the last shutdown step.
    const shutDownProcess = createGracefulShutdown(server, {
        // SIGINT (Ctrl-C) always exits immediately, even with a serverId: a
        // 90s wait on a local dev interrupt would make it look hung.
        drainMs: (signal) =>
            signal === 'SIGTERM' && config.serverId ? GRACEFUL_DRAIN_MS : 0,
    });
    // `on`, not `once`: a repeat signal must hit the in-progress guard instead
    // of falling through to Node's default immediate exit.
    process.on('SIGINT', () => void shutDownProcess('SIGINT'));
    process.on('SIGTERM', () => void shutDownProcess('SIGTERM'));
    // Uncaught exceptions and unhandled rejections are reported by the guards
    // `PuterServer.start()` installs — see util/processGuards.ts.
}
