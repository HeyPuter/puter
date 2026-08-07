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

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
    AggregationType,
    PeriodicExportingMetricReader,
    type ViewOptions,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
const sampleRatio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? 0.05);

/**
 * Latency histograms default to explicit buckets, which some backends can only
 * represent as a min/max/sum/count summary — enough for an average, not enough
 * for a percentile. Exponential histograms carry their bucket distribution, so
 * a backend that understands them can answer percentile queries.
 *
 * Off by default because whether that survives the export path depends on the
 * receiving end, and losing the summary would be worse than not having
 * percentiles. Enable per deployment once verified.
 */
const percentileViews: ViewOptions[] =
    process.env.OTEL_EXPONENTIAL_HISTOGRAMS === 'true'
        ? [
              'driver.call.duration',
              'http.server.duration',
              'http.server.request.duration',
          ].map((instrumentName) => ({
              instrumentName,
              aggregation: {
                  type: AggregationType.EXPONENTIAL_HISTOGRAM as const,
                  // 160 buckets covers microseconds to minutes at the default
                  // scale; the cost is per-series memory in the process, not
                  // anything downstream.
                  options: { recordMinMax: true, maxSize: 160 },
              },
          }))
        : [];

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
    views: percentileViews,
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
