import { type Attributes, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('puter-backend');

type AttrsOrFactory = Attributes | (() => Attributes);

/**
 * Run `fn` inside an active span. Handles sync + async transparently,
 * records exceptions, and always closes the span.
 */
export function withSpan<T>(
    name: string,
    attrs: AttrsOrFactory,
    fn: () => T,
): T {
    return tracer.startActiveSpan(name, (span) => {
        try {
            const a = typeof attrs === 'function' ? attrs() : attrs;
            if (a) span.setAttributes(a);
            const result = fn();
            if (result instanceof Promise) {
                return result
                    .then(
                        (v) => {
                            span.setStatus({ code: SpanStatusCode.OK });
                            return v;
                        },
                        (err: unknown) => {
                            recordError(span, err);
                            throw err;
                        },
                    )
                    .finally(() => span.end()) as T;
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
        } catch (err) {
            recordError(span, err);
            span.end();
            throw err;
        }
    });
}

function recordError(span: ReturnType<typeof tracer.startSpan>, err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    span.recordException(e);
    span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
}

/**
 * Stage-3 method decorator: wrap the decorated method in a span.
 * Usage:
 *     class Foo {
 *         @Span()                // span name = "Foo.bar"
 *         async bar() { ... }
 *
 *         @Span('custom.name')   // span name = "custom.name"
 *         async baz() { ... }
 *     }
 */
export function Span(name?: string) {
    return function <This, Args extends unknown[], Return>(
        target: (this: This, ...args: Args) => Return,
        ctx: ClassMethodDecoratorContext<
            This,
            (this: This, ...args: Args) => Return
        >,
    ) {
        return function (this: This, ...args: Args): Return {
            const spanName =
                name ??
                `${(this as { constructor?: { name?: string } })?.constructor?.name ?? 'fn'}.${String(ctx.name)}`;
            return withSpan(spanName, {}, () => target.apply(this, args));
        };
    };
}
