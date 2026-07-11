import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Span, withSpan } from './span';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

afterAll(async () => {
    await provider.shutdown();
    trace.disable();
});

beforeEach(() => {
    exporter.reset();
});

describe('withSpan', () => {
    it('records a span around a sync function and returns its value', () => {
        const result = withSpan('sync.op', { a: 1 }, () => 42);
        expect(result).toBe(42);

        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0].name).toBe('sync.op');
        expect(spans[0].attributes).toMatchObject({ a: 1 });
        expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    });

    it('records a span around an async function', async () => {
        const result = await withSpan('async.op', {}, async () => 'ok');
        expect(result).toBe('ok');

        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0].name).toBe('async.op');
        expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    });

    it('marks the span errored and rethrows on async rejection', async () => {
        await expect(
            withSpan('async.fail', {}, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
        expect(spans[0].events.some((e) => e.name === 'exception')).toBe(true);
    });

    it('resolves an attribute factory lazily', () => {
        withSpan('factory.op', () => ({ computed: 'yes' }), () => null);
        expect(exporter.getFinishedSpans()[0].attributes).toMatchObject({
            computed: 'yes',
        });
    });
});

describe('Span decorator', () => {
    it('defaults the span name to Class.method', async () => {
        class Widget {
            @Span()
            async fetch() {
                return 'data';
            }
        }
        expect(await new Widget().fetch()).toBe('data');
        expect(exporter.getFinishedSpans()[0].name).toBe('Widget.fetch');
    });

    it('uses an explicit name and static attributes', async () => {
        class Widget {
            @Span('custom.name', { kind: 'static' })
            async fetch() {
                return 1;
            }
        }
        await new Widget().fetch();

        const [span] = exporter.getFinishedSpans();
        expect(span.name).toBe('custom.name');
        expect(span.attributes).toMatchObject({ kind: 'static' });
    });

    it('builds attributes from the call arguments via a factory', async () => {
        class Db {
            @Span('db.read', (query: string) => ({ 'db.statement': query }))
            async read(query: string, _params: unknown[] = []) {
                return [query];
            }
        }
        await new Db().read('SELECT 1', []);

        const [span] = exporter.getFinishedSpans();
        expect(span.name).toBe('db.read');
        expect(span.attributes).toMatchObject({ 'db.statement': 'SELECT 1' });
    });

    it('records errors thrown by the decorated method', async () => {
        class Db {
            @Span('db.read')
            async read() {
                throw new Error('nope');
            }
        }
        await expect(new Db().read()).rejects.toThrow('nope');
        expect(exporter.getFinishedSpans()[0].status.code).toBe(
            SpanStatusCode.ERROR,
        );
    });
});
