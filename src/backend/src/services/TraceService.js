// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const opentelemetry = require("@opentelemetry/api");


/**
* @class TraceService
* @description This class is responsible for creating and managing
* traces for the Puter application using the OpenTelemetry API.
* It provides methods to start spans, which are used for tracking
* operations and measuring performance within the application.
*/
class TraceService {
    constructor () {
        this.tracer_ = opentelemetry.trace.getTracer(
            'puter-filesystem-tracer'
        );
    }


    /**
     * Retrieves the tracer instance used for creating spans.
     * This method is a getter that returns the current tracer object.
     * 
     * @returns {import("@opentelemetry/api").Tracer} The tracer instance for this service.
     */
    get tracer () {
        return this.tracer_;
    }


    /**
     * Starts an active span for executing a function with tracing.
     * This method wraps the provided function `fn` in a span, managing
     * span lifecycle, error handling, and status updates.
     *
     * @param {string} name - The name of the span.
     * @param {Function} fn - The asynchronous function to execute within the span.
     * @param {opentelemetry.SpanOptions} [options] - The opentelemetry options object
     * @returns {Promise} - A promise that resolves to the return value of `fn`.
     */
    async spanify (name, fn, options) {
        const args = [name];
        if ( options !== null && typeof options === 'object' ) {
            args.push(options);
        }
        args.push(async span => {
            try {
                return await fn({ span });
            } catch (error) {
                span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR, message: error.message });
                throw error;
            } finally {
                span.end();
            }
        });
        this.tracer.startActiveSpan('name', {  }, () => {})
        return await this.tracer.startActiveSpan(...args);
    }
}

module.exports = {
    TraceService,
};
