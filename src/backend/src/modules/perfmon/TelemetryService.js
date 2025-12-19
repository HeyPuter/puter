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
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import config from '../../config.js';
import BaseService from '../../services/BaseService.js';

export class TelemetryService extends BaseService {
    /** @type {import('@opentelemetry/api').Tracer} */
    #tracer = null;
    _construct () {

        const traceExporter = this.#getConfiguredExporter();
        const metricExporter = this.#getMetricExporter();

        if ( !traceExporter && !metricExporter ) {
            console.log('TelemetryService not configured, skipping initialization.');
            return;
        }

        const resource = Resource.default().merge(
                        new Resource({
                            [SemanticResourceAttributes.SERVICE_NAME]: 'puter-backend',
                            [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
                        }));

        const sdk = new NodeSDK({
            resource,
            traceExporter: traceExporter,
            metricReader: new PeriodicExportingMetricReader({
                exporter: metricExporter,
            }),
            instrumentations: [getNodeAutoInstrumentations()],
        });

        this.sdk = sdk;

        this.sdk.start();

        this.#tracer = trace.getTracer('puter-tracer');

    }

    _init () {
        if ( ! this.#tracer ) {
            return;
        }
        const svc_context = this.services.get('context');
        svc_context.register_context_hook('pre_arun', ({ hints, trace_name, callback, replace_callback }) => {
            if ( ! trace_name ) return;
            if ( ! hints.trace ) return;
            replace_callback(async () => {
                return await this.#tracer.startActiveSpan(trace_name, async span => {
                    try {
                        return await callback();
                    } catch ( error ) {
                        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                        throw error;
                    } finally {
                        span.end();
                    }
                });
            });
        });
    }

    #getConfiguredExporter () {
        if ( config.jaeger ?? this.config.jaeger ) {
            return new OTLPTraceExporter(config.jaeger ?? this.config.jaeger);
        }
        if ( this.config.console ) {
            return new ConsoleSpanExporter();
        }
    }

    #getMetricExporter () {
        if ( config.jaeger ?? this.config.jaeger ) {
            return new OTLPMetricExporter(config.jaeger ?? this.config.jaeger);
        }
        if ( this.config.console ) {
            return new ConsoleMetricExporter();
        }
    }
}