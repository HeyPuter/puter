import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
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

const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
const sampleRatio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? 0.05);

const sdk = new NodeSDK({
    resource: new Resource({
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
