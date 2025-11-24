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
// The OpenTelemetry SDK provides a very error-prone API for creating
// spans. This is a wrapper around the SDK that makes it convenient
// to create spans correctly. The path of least resistance should
// be the correct path, not a way to shoot yourself in the foot.

const { context, trace, SpanStatusCode } = require('@opentelemetry/api');
const { Context } = require('./context');
const { TeePromise } = require('@heyputer/putility').libs.promise;

/*
parallel span example from GPT-4:

promises.push(tracer.startActiveSpan(`job:${job.id}`, (span) => {
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      await job.run();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}));
*/

const spanify = (label, fn) => async (...args) => {
    const context = Context.get();
    if ( ! context ) {
        // We don't use the proper logger here because we would normally
        // be getting it from context
        console.error('spanify failed', new Error('missing context'));
    }

    const tracer = context.get('services').get('traceService').tracer;
    let result;
    await tracer.startActiveSpan(label, async span => {
        result = await fn(...args);
        span.end();
    });
    return result;
};

const abtest = async (label, impls) => {
    const context = Context.get();
    if ( ! context ) {
        // We don't use the proper logger here because we would normally
        // be getting it from context
        console.error('abtest failed', new Error('missing context'));
    }

    const tracer = context.get('services').get('traceService').tracer;
    let result;
    const impl_keys = Object.keys(impls);
    const impl_i = Math.floor(Math.random() * impl_keys.length);
    const impl_name = impl_keys[impl_i];
    const impl = impls[impl_name];

    await tracer.startActiveSpan(`${label }:${ impl_name}`, async span => {
        span.setAttribute('abtest.impl', impl_name);
        result = await impl();
        span.end();
    });
    return result;
};

class ParallelTasks {
    constructor ({ tracer, max } = {}) {
        this.tracer = tracer;
        this.max = max ?? Infinity;
        this.promises = [];

        this.queue_ = [];
        this.ongoing_ = 0;
    }

    add (name, fn, flags) {
        if ( this.ongoing_ >= this.max && !flags?.force ) {
            const p = new TeePromise();
            this.promises.push(p);
            this.queue_.push([name, fn, p]);
            return;
        }

        this.promises.push(this.run_(name, fn));
    }

    run_ (name, fn) {
        this.ongoing_++;
        const span = this.tracer.startSpan(name);
        return context.with(trace.setSpan(context.active(), span), async () => {
            try {
                const res = await fn();
                this.ongoing_--;
                this.check_queue_();
                return res;
            } catch ( error ) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                throw error;
            } finally {
                span.end();
            }
        });
    }

    check_queue_ () {
        while ( this.ongoing_ < this.max && this.queue_.length > 0 ) {
            const [name, fn, p] = this.queue_.shift();
            const run_p = this.run_(name, fn);
            run_p.then(p.resolve.bind(p), p.reject.bind(p));
        }
    }

    async awaitAll () {
        await Promise.all(this.promises);
    }

    async awaitAllAndDeferThrow () {
        const results = await Promise.allSettled(this.promises);
        const errors = [];
        for ( const result of results ) {
            if ( result.status === 'rejected' ) {
                errors.push(result.reason);
            }
        }
        if ( errors.length !== 0 ) {
            throw new AggregateError(errors);
        }
    }
}

module.exports = {
    ParallelTasks,
    spanify,
    abtest,
};
