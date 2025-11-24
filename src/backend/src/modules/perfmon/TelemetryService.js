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
const opentelemetry = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { PeriodicExportingMetricReader, ConsoleMetricExporter } = require('@opentelemetry/sdk-metrics');

const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { ConsoleSpanExporter, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const config = require('../../config');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');

const BaseService = require('../../services/BaseService');

class TelemetryService extends BaseService {
    _construct () {
        const resource = Resource.default().merge(
                        new Resource({
                            [SemanticResourceAttributes.SERVICE_NAME]: 'puter-backend',
                            [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
                        }));

        const provider = new NodeTracerProvider({ resource });
        const exporter = this.getConfiguredExporter_();
        this.exporter = exporter;

        const processor = new BatchSpanProcessor(exporter);
        provider.addSpanProcessor(processor);

        provider.register();

        const sdk = new NodeSDK({
            traceExporter: new ConsoleSpanExporter(),
            metricReader: new PeriodicExportingMetricReader({
                exporter: new ConsoleMetricExporter(),
            }),
            instrumentations: [getNodeAutoInstrumentations()],
        });

        this.sdk = sdk;

        this.sdk.start();

        this.tracer_ = opentelemetry.trace.getTracer('puter-tracer');
    }

    _init () {
        const svc_context = this.services.get('context');
        svc_context.register_context_hook('pre_arun', ({ hints, trace_name, callback, replace_callback }) => {
            if ( ! trace_name ) return;
            if ( ! hints.trace ) return;
            console.log('APPLYING TRACE NAME', trace_name);
            replace_callback(async () => {
                return await this.tracer_.startActiveSpan(trace_name, async span => {
                    try {
                        return await callback();
                    } catch ( error ) {
                        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR, message: error.message });
                        throw error;
                    } finally {
                        span.end();
                    }
                });
            });
        });
    }

    getConfiguredExporter_ () {
        if ( config.jaeger ?? this.config.jaeger ) {
            return new OTLPTraceExporter(config.jaeger ?? this.config.jaeger);
        }
        const exporter = new ConsoleSpanExporter();
    }
}

module.exports = TelemetryService;
