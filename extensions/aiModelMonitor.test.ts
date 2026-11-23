import axios from 'axios';
import { AlarmClient } from '../src/backend/clients/alarm/AlarmClient';
import { buildSlackMessage } from '../src/backend/clients/alarm/slack';
import { JobScheduler } from '../src/backend/services/jobs/JobScheduler';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AIModelMonitorService } from './aiModelMonitor';
import { setupTestServer } from '../src/backend/testUtil';
import type { PuterServer } from '../src/backend/server';
import type { IConfig } from '../src/backend/types';
import type { AlertPayload } from '../src/backend/clients/alarm/types';
import type { JobRunContext } from '../src/backend/services/jobs/JobScheduler';

let backend: PuterServer;
let upstream: Server;
let origin: string;
let body: unknown;
let status = 200;
let requests: Array<{
    url: string;
    headers: Record<string, string | string[] | undefined>;
}>;
let responder: ((url: string) => unknown) | undefined;
const alerts: AlertPayload[] = [];
let seq = 0;
const ctx = (): JobRunContext => ({
    signal: new AbortController().signal,
    state: null,
    saveState: async () => {},
});
const service = (key = 'openai', extra: Record<string, unknown> = {}) =>
    new AIModelMonitorService(
        {
            providers: {
                [key]: {
                    apiKey: `fixture-${++seq}`,
                    apiBaseUrl: origin,
                    ...extra,
                },
            },
        } as IConfig,
        backend.clients,
        backend.stores,
        backend.services,
    );

beforeAll(async () => {
    backend = await setupTestServer();
    backend.clients.alarm.addAlertHandler(
        async (alert) => {
            alerts.push(alert);
        },
        { minSeverity: 'info' },
    );
    upstream = createServer((req, res) => {
        requests.push({ url: req.url!, headers: req.headers });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responder ? responder(req.url!) : body));
    });
    await new Promise<void>((resolve) =>
        upstream.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
});
afterAll(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await backend.shutdown();
});
beforeEach(() => {
    alerts.length = 0;
    requests = [];
    status = 200;
    body = { data: [{ id: 'old' }, { id: 'kept' }] };
    responder = undefined;
});

it('baselines quietly, persists across instances, and reports additions and removals once', async () => {
    const monitor = service();
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(0);
    body = { data: [{ id: 'new' }, { id: 'kept' }, { id: 'new' }] };
    await monitor.scan(ctx());
    expect(
        alerts.map((alert) => [
            alert.fields.change.replaceAll("'", ''),
            alert.fields.model.replaceAll("'", ''),
        ]),
    ).toEqual([
        ['added', 'new'],
        ['removed', 'old'],
    ]);
    expect(
        alerts.every(
            (alert) =>
                alert.channel === 'ai_providers' && alert.severity === 'info',
        ),
    ).toBe(true);
    expect(alerts.map((alert) => alert.summary)).toEqual([
        'New OpenAI model: new',
        'Removed OpenAI model: old',
    ]);
    const message = buildSlackMessage(alerts[0], { serverId: 'sydney' });
    expect(message.text).toBe(':information_source: New OpenAI model: new');
    expect(message.attachments[0].fields).toEqual([]);
    expect(message.attachments[0].footer).not.toContain(alerts[0].id);
    const restarted = new AIModelMonitorService(
        {
            providers: {
                openai: { apiKey: `fixture-${seq}`, apiBaseUrl: origin },
            },
        } as IConfig,
        backend.clients,
        backend.stores,
        backend.services,
    );
    await restarted.scan(ctx());
    expect(alerts).toHaveLength(2);
});

it.each([
    null,
    { data: [{}] },
    { data: [{ id: 'x' }], has_more: true },
    { error: 'denied' },
])(
    'retains the baseline for an invalid or incomplete response %j',
    async (invalid) => {
        const monitor = service();
        await monitor.scan(ctx());
        body = invalid;
        await monitor.scan(ctx());
        expect(alerts.at(-1)?.message).toBe(
            'AI provider model catalog fetch failed',
        );
        alerts.length = 0;
        body = { data: [{ id: 'kept' }] };
        await monitor.scan(ctx());
        expect(
            alerts.map((alert) => alert.fields.model?.replaceAll("'", '')),
        ).toEqual(['old']);
    },
);

it('keeps failures isolated and never includes upstream error text or credentials', async () => {
    const monitor = service();
    status = 401;
    body = { error: 'secret-response' };
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(1);
    expect(alerts[0].summary).toBe('OpenAI model catalog could not be fetched');
    expect(JSON.stringify(alerts)).not.toContain('secret-response');
    expect(JSON.stringify(alerts)).not.toContain(`fixture-${seq}`);
});

it.each([
    'openrouter',
    'together-ai',
    'together-image-generation',
    'together-video-generation',
    'infron',
    'neuralwatt',
    'alibaba',
    'xai',
    'xai-image-generation',
    'cloudflare-image-generation',
])(
    'skips %s because its model catalog includes pricing automatically',
    async (configKey) => {
        await service(configKey).scan(ctx());
        expect(requests).toHaveLength(0);
        expect(alerts).toHaveLength(0);
    },
);

it('follows Claude pagination with the correct authentication', async () => {
    responder = (url) =>
        url.includes('after_id=first')
            ? { data: [{ id: 'last' }], has_more: false }
            : { data: [{ id: 'first' }], has_more: true, last_id: 'first' };
    await service('claude').scan(ctx());
    expect(requests.map((req) => req.url)).toEqual([
        '/models',
        '/models?after_id=first',
    ]);
    expect(requests[0].headers['x-api-key']).toBe(`fixture-${seq}`);
    expect(requests[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(alerts).toHaveLength(0);
});

it('reads ElevenLabs model_id and reports an empty successful catalog as removals', async () => {
    const monitor = service('elevenlabs');
    body = [{ model_id: 'voice-model' }];
    await monitor.scan(ctx());
    body = [];
    await monitor.scan(ctx());
    expect(
        alerts.map((alert) => alert.fields.model?.replaceAll("'", '')),
    ).toEqual(['voice-model']);
    expect(requests[0].headers['xi-api-key']).toBe(`fixture-${seq}`);
});

it('rejects Replicate pagination that would forward credentials to another host', async () => {
    body = {
        results: [{ owner: 'vendor', name: 'model' }],
        next: 'https://other.example/models',
    };
    await service('replicate-image-generation').scan(ctx());
    expect(requests).toHaveLength(1);
    expect(alerts.at(-1)?.message).toBe(
        'AI provider model catalog fetch failed',
    );
});

it('does not query dynamically refreshed providers or disabled credentials', async () => {
    await service('openrouter').scan(ctx());
    await service('openai', { enabled: false }).scan(ctx());
    expect(requests).toHaveLength(0);
});

it('stops before I/O after lease loss', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
        service().scan({ ...ctx(), signal: controller.signal }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
});

it('treats credential rotation as a new baseline', async () => {
    await service().scan(ctx());
    body = { data: [{ id: 'different-account' }] };
    await service().scan(ctx());
    expect(alerts).toHaveLength(0);
});

it('rejects a looping page cursor without replacing the baseline', async () => {
    body = { data: [{ id: 'one' }], has_more: true, last_id: 'one' };
    await service('claude').scan(ctx());
    expect(requests).toHaveLength(2);
    expect(alerts.at(-1)?.message).toBe(
        'AI provider model catalog fetch failed',
    );
});

it('caps pagination rather than treating a truncated listing as complete', async () => {
    let page = 0;
    responder = () => ({
        data: [{ id: `m-${++page}` }],
        has_more: true,
        last_id: `m-${page}`,
    });
    await service('claude').scan(ctx());
    expect(requests).toHaveLength(1_000);
    expect(alerts.at(-1)?.message).toBe(
        'AI provider model catalog fetch failed',
    );
});

it('isolates a failing provider from a successful provider', async () => {
    const monitor = new AIModelMonitorService(
        {
            providers: {
                openai: {
                    apiKey: `failure-${++seq}`,
                    apiBaseUrl: `${origin}/broken`,
                },
                groq: { apiKey: `success-${seq}`, apiBaseUrl: origin },
            },
        } as IConfig,
        backend.clients,
        backend.stores,
        backend.services,
    );
    responder = (url) =>
        url.startsWith('/broken') ? { error: 'upstream' } : body;
    await monitor.scan(ctx());
    body = { data: [{ id: 'kept' }, { id: 'new' }] };
    await monitor.scan(ctx());
    expect(
        alerts.filter((alert) => alert.message === 'AI provider model added'),
    ).toHaveLength(1);
    expect(
        alerts.filter((alert) => alert.message === 'AI provider model removed'),
    ).toHaveLength(1);
});

it('paginates the native Gemini catalog using API key headers', async () => {
    const get = vi
        .spyOn(axios, 'get')
        .mockResolvedValueOnce({
            data: {
                models: [{ name: 'models/first' }],
                nextPageToken: 'second',
            },
        })
        .mockResolvedValueOnce({ data: { models: [{ name: 'models/last' }] } });
    try {
        const monitor = new AIModelMonitorService(
            { providers: { gemini: { apiKey: `google-${++seq}` } } } as IConfig,
            backend.clients,
            backend.stores,
            backend.services,
        );
        await monitor.scan(ctx());
        expect(get).toHaveBeenCalledTimes(2);
        expect(get.mock.calls[1][0]).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models?pageToken=second',
        );
        expect(get.mock.calls[0][1]?.headers).toEqual({
            'x-goog-api-key': `google-${seq}`,
        });
        expect(alerts).toHaveLength(0);
    } finally {
        get.mockRestore();
    }
});

it('registers a fleet job at boot without monitor configuration', async () => {
    class InspectJobs extends JobScheduler {
        definition(name: string) {
            return this.definitionOf(name);
        }
    }
    const config = {
        providers: {},
    } as IConfig;
    const jobs = new InspectJobs(
        config,
        backend.clients,
        backend.stores,
        backend.services,
    );
    const monitor = new AIModelMonitorService(
        config,
        backend.clients,
        backend.stores,
        { ...backend.services, jobs },
    );
    monitor.onServerStart();
    const job = jobs.definition('ai-model-monitor');
    expect(job.every).toBe(30 * 60_000);
    expect(job.scope).toBe('fleet');
    await job.run(ctx());
    expect(requests).toHaveLength(0);
    const controller = new AbortController();
    controller.abort();
    await expect(
        job.run({ ...ctx(), signal: controller.signal }),
    ).rejects.toThrow();
});

it.each([
    { data: [{ id: 'm'.repeat(257) }] },
    { data: Array.from({ length: 20_001 }, (_, i) => ({ id: `m-${i}` })) },
    {
        data: Array.from({ length: 2_000 }, (_, i) => ({
            id: `${'m'.repeat(200)}-${i}`,
        })),
    },
])(
    'rejects catalog bounds without emitting model changes',
    async (oversized) => {
        body = oversized;
        await service().scan(ctx());
        expect(alerts).toHaveLength(1);
        expect(alerts[0].message).toBe(
            'AI provider model catalog fetch failed',
        );
    },
);

it('follows same-origin Replicate pages and reads owner/name identifiers', async () => {
    responder = (url) =>
        url.includes('cursor=two')
            ? { results: [{ owner: 'vendor', name: 'two' }], next: null }
            : {
                  results: [{ owner: 'vendor', name: 'one' }],
                  next: `${origin}/models?cursor=two`,
              };
    await service('replicate-image-generation').scan(ctx());
    expect(requests).toHaveLength(2);
    expect(alerts).toHaveLength(0);
});

it('completes a Replicate catalog with more than 100 pages', async () => {
    let page = 0;
    responder = () => ({
        results: [{ owner: 'vendor', name: `model-${++page}` }],
        next: page < 101 ? `${origin}/models?cursor=${page}` : null,
    });
    await service('replicate-image-generation').scan(ctx());
    expect(requests).toHaveLength(101);
    expect(alerts).toHaveLength(0);
});

it('diffs bogus models across reordered, changed, failed, and recovered catalogs', async () => {
    const alarm = new AlarmClient({} as IConfig);
    alarm.addAlertHandler(async (alert) => {
        alerts.push(alert);
    });
    const monitor = new AIModelMonitorService(
        {
            providers: {
                openai: { apiKey: `bogus-${++seq}`, apiBaseUrl: origin },
            },
        } as IConfig,
        { ...backend.clients, alarm },
        backend.stores,
        backend.services,
    );
    body = { data: [{ id: 'bogus-stays' }, { id: 'bogus-retired' }] };
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(0);

    body = {
        data: [
            { id: 'bogus-retired' },
            { id: 'bogus-stays' },
            { id: 'bogus-stays' },
        ],
    };
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(0);

    body = { data: [{ id: 'bogus-new' }, { id: 'bogus-stays' }] };
    await monitor.scan(ctx());
    expect(
        alerts.map((alert) => ({
            change: alert.fields.change,
            model: alert.fields.model,
            channel: alert.channel,
        })),
    ).toEqual([
        { change: "'added'", model: "'bogus-new'", channel: 'ai_providers' },
        {
            change: "'removed'",
            model: "'bogus-retired'",
            channel: 'ai_providers',
        },
    ]);

    await monitor.scan(ctx());
    expect(alerts).toHaveLength(2);

    status = 503;
    body = { error: 'bogus provider is offline' };
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(3);
    expect(alerts[2].message).toBe('AI provider model catalog fetch failed');

    status = 200;
    body = { data: [{ id: 'bogus-stays' }] };
    await monitor.scan(ctx());
    expect(alerts).toHaveLength(4);
    expect(alerts[3].fields.change).toBe("'removed'");
    expect(alerts[3].fields.model).toBe("'bogus-new'");
    expect(requests).toHaveLength(6);
});

it.each(['read', 'write'] as const)(
    'does not emit model changes when a snapshot %s fails and recovers without replaying alerts',
    async (operation) => {
        const alarm = new AlarmClient({} as IConfig);
        alarm.addAlertHandler(async (alert) => {
            alerts.push(alert);
        });
        const monitor = new AIModelMonitorService(
            {
                providers: {
                    openai: {
                        apiKey: `kv-failure-${++seq}`,
                        apiBaseUrl: origin,
                    },
                },
            } as IConfig,
            { ...backend.clients, alarm },
            backend.stores,
            backend.services,
        );
        await monitor.scan(ctx());
        expect(alerts).toHaveLength(0);
        body = { data: [{ id: 'kept' }, { id: 'new' }] };
        const failure = vi
            .spyOn(backend.clients.dynamo, operation === 'read' ? 'get' : 'put')
            .mockRejectedValueOnce(
                new Error('Injected storage failure with internal details'),
            );
        try {
            await monitor.scan(ctx());
        } finally {
            failure.mockRestore();
        }
        expect(alerts).toHaveLength(1);
        expect(alerts[0].message).toBe(
            'AI provider model catalog snapshot failed',
        );
        expect(alerts[0].fields.operation).toBe(`'${operation}'`);
        expect(alerts[0].channel).toBe('ai_providers');
        expect(JSON.stringify(alerts)).not.toContain('internal details');
        const { res } = await backend.stores.kv.get(
            { key: 'openai', consistentRead: true },
            { systemPartition: 'aiModelMonitor' },
        );
        expect((res as { models: string[] }).models).toEqual(['kept', 'old']);
        await monitor.scan(ctx());
        expect(alerts.map((alert) => alert.message)).toEqual([
            'AI provider model catalog snapshot failed',
            'AI provider model added',
            'AI provider model removed',
        ]);
        await monitor.scan(ctx());
        expect(alerts).toHaveLength(3);
    },
);
