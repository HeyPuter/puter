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
import { SemanticAttributes, SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import config from '../../config.js';
import BaseService from '../../services/BaseService.js';

export class TelemetryService extends BaseService {
    static TRACER_NAME = 'puter-tracer';
    static #sharedSdk = null;
    static #sharedTracer = null;
    static #telemetryStarted = false;

    /** @type {import('@opentelemetry/api').Tracer} */
    #tracer = null;

    constructor (service_resources, ...args) {
        super(service_resources, ...args);
        const { sdk, tracer } = TelemetryService.#startTelemetry({
            serviceConfig: this.config,
        });
        this.sdk = sdk;
        this.#tracer = tracer;
    }

    _init () {
        if ( ! this.#tracer ) {
            return;
        }
        const svc_context = this.services.get('context', { optional: true });
        if ( ! svc_context ) {
            return;
        }
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

    static #normalizeRoute (route) {
        if ( Array.isArray(route) ) {
            for ( const entry of route ) {
                if ( typeof entry === 'string' ) {
                    return entry;
                }
            }
            return undefined;
        }
        if ( typeof route === 'string' ) {
            return route;
        }
        if ( route instanceof RegExp ) {
            return route.toString();
        }
    }

    static #buildRoute (req, route) {
        const normalized = TelemetryService.#normalizeRoute(route);
        if ( ! normalized ) {
            return undefined;
        }
        const baseUrl = typeof req?.baseUrl === 'string' ? req.baseUrl : '';
        const combined = `${baseUrl}${normalized}`;
        return combined || normalized;
    }

    static #applyRouteToSpan (span, req, route) {
        if ( ! route ) {
            return;
        }
        span.setAttribute(SemanticAttributes.HTTP_ROUTE, route);
        if ( typeof span.updateName === 'function' && req?.method ) {
            span.updateName(`HTTP ${req.method} ${route}`);
        }
    }

    static #buildInstrumentationConfig () {
        return {
            '@opentelemetry/instrumentation-http': {
                responseHook: (span, response) => {
                    const req = response?.req;
                    const route = TelemetryService.#buildRoute(req, req?.route?.path);
                    TelemetryService.#applyRouteToSpan(span, req, route);
                },
            },
            '@opentelemetry/instrumentation-express': {
                spanNameHook: (info, defaultName) => {
                    if ( info.layerType !== 'request_handler' ) {
                        return defaultName;
                    }
                    const route = TelemetryService.#buildRoute(info.request, info.route);
                    if ( !route || !info.request?.method ) {
                        return defaultName;
                    }
                    return `HTTP ${info.request.method} ${route}`;
                },
                requestHook: (span, info) => {
                    const route = TelemetryService.#buildRoute(info.request, info.route);
                    if ( route ) {
                        span.setAttribute(SemanticAttributes.HTTP_ROUTE, route);
                    }
                },
            },
        };
    }

    static #resolveExporterConfig (serviceConfig) {
        return config.jaeger ?? serviceConfig?.jaeger;
    }

    static #getConfiguredExporter (serviceConfig) {
        const exporterConfig = TelemetryService.#resolveExporterConfig(serviceConfig);
        if ( exporterConfig ) {
            return new OTLPTraceExporter(exporterConfig);
        }
        if ( serviceConfig?.console ) {
            return new ConsoleSpanExporter();
        }
    }

    static #getMetricExporter (serviceConfig) {
        const exporterConfig = TelemetryService.#resolveExporterConfig(serviceConfig);
        if ( exporterConfig ) {
            return new OTLPMetricExporter(exporterConfig);
        }
        if ( serviceConfig?.console ) {
            return new ConsoleMetricExporter();
        }
    }

    static #startTelemetry ({ serviceConfig } = {}) {
        if ( TelemetryService.#telemetryStarted ) {
            return { sdk: TelemetryService.#sharedSdk, tracer: TelemetryService.#sharedTracer };
        }
        TelemetryService.#telemetryStarted = true;

        const effectiveConfig = serviceConfig ?? config.services?.telemetry ?? {};
        const traceExporter = TelemetryService.#getConfiguredExporter(effectiveConfig);
        const metricExporter = TelemetryService.#getMetricExporter(effectiveConfig);

        if ( !traceExporter && !metricExporter ) {
            console.log('TelemetryService not configured, skipping initialization.');
            return { sdk: null, tracer: null };
        }

        const resource = Resource.default().merge(
                        new Resource({
                            [SemanticResourceAttributes.SERVICE_NAME]: 'puter-backend',
                            [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
                        }));

        const sdkConfig = {
            resource,
            instrumentations: [
                getNodeAutoInstrumentations(TelemetryService.#buildInstrumentationConfig()),
            ],
        };

        if ( traceExporter ) {
            sdkConfig.traceExporter = traceExporter;
        }
        if ( metricExporter ) {
            sdkConfig.metricReader = new PeriodicExportingMetricReader({
                exporter: metricExporter,
            });
        }

        TelemetryService.#sharedSdk = new NodeSDK(sdkConfig);
        TelemetryService.#sharedSdk.start();
        TelemetryService.#sharedTracer = trace.getTracer(TelemetryService.TRACER_NAME);

        return { sdk: TelemetryService.#sharedSdk, tracer: TelemetryService.#sharedTracer };
    }
}
