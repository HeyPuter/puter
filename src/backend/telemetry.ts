/**
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
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { installJsonConsole } from './util/jsonConsole.js';

/**
 * Resolve `log_format` with the SAME precedence as the server's `loadConfig`
 * (index.ts): defaults from `config.default.json`, overlaid by a single
 * override file — `PUTER_CONFIG_PATH` if it exists, else `<pkg>/config.json`.
 * This preload runs before the backend loads config, so it must stay in lockstep
 * with that resolution or it'd act on a value the server never sees.
 */
const configLogFormat = (): unknown => {
    const pkgRoot = path.resolve(__dirname, '../../..');
    const readJson = (file: string): Record<string, unknown> => {
        try {
            return JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            // A missing/invalid file is treated as no override; the server's
            // loadConfig surfaces a real parse error moments later.
            return {};
        }
    };

    const defaultPath = path.join(pkgRoot, 'config.default.json');
    const runtimePath = path.join(pkgRoot, 'config.json');
    const envPath = process.env.PUTER_CONFIG_PATH;

    const defaults = existsSync(defaultPath) ? readJson(defaultPath) : {};
    const overridePath =
        envPath && existsSync(envPath)
            ? envPath
            : existsSync(runtimePath)
              ? runtimePath
              : null;
    const override = overridePath ? readJson(overridePath) : {};

    // deepMerge over a scalar key == override wins when it sets the key.
    return 'log_format' in override ? override.log_format : defaults.log_format;
};

// When config sets `log_format: "json"`, replace the global console so every
// call emits one JSON line tagged with the active trace — one event per call,
// filterable by level. Any other value (the default) leaves console untouched.
if (configLogFormat() === 'json') {
    installJsonConsole({
        getTraceContext: () => {
            const ctx = trace.getActiveSpan()?.spanContext();
            if (!ctx || !isSpanContextValid(ctx)) return undefined;
            return { traceId: ctx.traceId, spanId: ctx.spanId };
        },
    });
}

const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
const sampleRatio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? 0.05);

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'puter-backend',
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
        'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    // Honour upstream sampling decisions; for root spans, keep ~5% of traces.
    sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: endpoint }),
        exportIntervalMillis: 60_000,
    }),
    instrumentations: [
        getNodeAutoInstrumentations({
            // Too noisy — every file read / dns lookup becomes a span.
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-dns': { enabled: false },
            '@opentelemetry/instrumentation-net': { enabled: false },
        }),
    ],
});

sdk.start();

const shutdown = () => {
    sdk.shutdown()
        .catch((err) => console.error('[telemetry] shutdown error', err))
        .finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
