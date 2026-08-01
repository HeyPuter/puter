import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { extensionStore } from '../src/backend/extensions.ts';
import type { IConfig } from '../src/backend/types';
import './devWatcher.ts';

type Lifecycle = {
    onServerStart: () => Promise<void>;
    onServerShutdown: () => Promise<void>;
};

// The extension registers itself on import; that registry entry is the
// only handle on the service class.
const DevWatcherService = extensionStore.services.devWatcher as unknown as new (
    config: IConfig,
    clients: unknown,
    stores: unknown,
    services: unknown,
) => Lifecycle;

const makeService = (config: Record<string, unknown>): Lifecycle =>
    new DevWatcherService(config as unknown as IConfig, {}, {}, {});

let workdir: string;

const write = (relative: string, contents: string): string => {
    const abs = path.join(workdir, relative);
    writeFileSync(abs, contents);
    return abs;
};

/** Poll until `predicate` holds or the budget runs out. */
const waitFor = async (
    predicate: () => boolean,
    label: string,
    timeoutMs = 15_000,
): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${label}`);
};

const logLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
    spy.mock.calls.map((call) => call.map(String).join(' '));

describe('devWatcher extension', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
        workdir = mkdtempSync(path.join(tmpdir(), 'devwatch-test-'));
    });

    afterAll(() => {
        rmSync(workdir, { recursive: true, force: true });
        delete (extensionStore.services as Record<string, unknown>).devWatcher;
    });

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        log.mockRestore();
        warn.mockRestore();
        error.mockRestore();
    });

    const started = () =>
        logLines(log).some((line) =>
            line.startsWith('[devwatch] starting watchers from'),
        );

    // -- start gating -------------------------------------------------

    it('does nothing when the server is not running in dev', async () => {
        await makeService({ env: 'production' }).onServerStart();
        expect(started()).toBe(false);
    });

    it('does nothing when devwatch is explicitly disabled', async () => {
        await makeService({
            env: 'dev',
            devwatch: { enabled: false },
        }).onServerStart();
        expect(started()).toBe(false);
    });

    it('does nothing when the server opts out with no_devwatch', async () => {
        await makeService({
            env: 'dev',
            no_devwatch: true,
            devwatch: { enabled: true },
        }).onServerStart();
        expect(started()).toBe(false);
    });

    it('starts in dev even with no explicit devwatch block', async () => {
        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();
        expect(started()).toBe(true);
        await service.onServerShutdown();
    });

    it('starts outside dev when devwatch is explicitly enabled', async () => {
        const service = makeService({
            env: 'production',
            devwatch: {
                enabled: true,
                root: workdir,
                commands: [],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();
        expect(started()).toBe(true);
        await service.onServerShutdown();
    });

    it('ignores a devwatch config that is not an object', async () => {
        // Falls back to `{}`, so the dev-env rule decides — and the
        // default webpack entries would be used, so pin it off instead.
        await makeService({
            env: 'production',
            devwatch: 'yes',
        }).onServerStart();
        expect(started()).toBe(false);
    });

    it('only starts once even if the lifecycle hook fires again', async () => {
        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();
        await service.onServerStart();
        expect(
            logLines(log).filter((line) =>
                line.startsWith('[devwatch] starting watchers from'),
            ),
        ).toHaveLength(1);
        await service.onServerShutdown();
    });

    it('waits out the configured ready delay before resolving', async () => {
        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [],
                ready_delay_ms: 60,
            },
        });
        const start = Date.now();
        await service.onServerStart();
        expect(Date.now() - start).toBeGreaterThanOrEqual(50);
        await service.onServerShutdown();
    });

    // -- child commands -----------------------------------------------

    it('spawns a command, line-buffers its output and flushes the tail', async () => {
        write(
            'chatty.js',
            [
                "process.stdout.write('one\\ntwo\\n');",
                "process.stderr.write('bad thing\\n');",
                // No trailing newline: only the stream `end` flushes it.
                "process.stdout.write('tail-no-newline');",
            ].join('\n'),
        );

        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [
                    {
                        name: 'chatty',
                        directory: '.',
                        command: 'node',
                        args: ['chatty.js'],
                    },
                ],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();

        await waitFor(
            () =>
                logLines(log).some((l) =>
                    l.includes('[devwatch:chatty:1] tail-no-newline'),
                ),
            'child stdout',
        );

        const lines = logLines(log);
        expect(lines).toContain('[devwatch:chatty:1] one');
        expect(lines).toContain('[devwatch:chatty:1] two');
        expect(logLines(warn)).toContain('[devwatch:chatty:2] bad thing');

        await waitFor(
            () =>
                logLines(log).some((l) =>
                    l.includes('[devwatch:chatty:exit] process exited'),
                ),
            'child exit',
        );
        await service.onServerShutdown();
    });

    it('passes literal and computed env values to the child', async () => {
        write(
            'env.js',
            'process.stdout.write(`STATIC=${process.env.STATIC_VALUE} ORIGIN=${process.env.FROM_CONFIG} MISSING=${process.env.BLOWS_UP}\\n`);',
        );

        const service = makeService({
            env: 'dev',
            origin: 'http://puter.localhost:4100',
            devwatch: {
                root: workdir,
                commands: [
                    {
                        name: 'envtest',
                        directory: '.',
                        command: 'node',
                        args: ['env.js'],
                        env: {
                            STATIC_VALUE: 'literal',
                            FROM_CONFIG: ({
                                global_config,
                            }: {
                                global_config: Record<string, unknown> | null;
                            }) => String(global_config?.origin ?? ''),
                            // Reading through a null is the "config not
                            // loaded yet" shape the extension deliberately
                            // stays quiet about.
                            BLOWS_UP: () => {
                                const nothing = null as unknown as {
                                    x: string;
                                };
                                return nothing.x;
                            },
                            NOISY: () => {
                                throw new Error('unexpected failure');
                            },
                        },
                    },
                ],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();

        await waitFor(
            () => logLines(log).some((l) => l.includes('STATIC=literal')),
            'env output',
        );
        const line = logLines(log).find((l) => l.includes('STATIC=literal'))!;
        expect(line).toContain('ORIGIN=http://puter.localhost:4100');
        expect(line).toContain('MISSING=undefined');

        // A null-property read is expected noise and stays silent; any
        // other failure is reported.
        const warnings = logLines(warn);
        expect(
            warnings.some((w) => w.includes('could not evaluate env function')),
        ).toBe(true);
        expect(warnings.some((w) => w.includes('for BLOWS_UP'))).toBe(false);
        expect(warnings.some((w) => w.includes('for NOISY'))).toBe(true);

        await service.onServerShutdown();
    });

    it('kills a still-running child on shutdown', async () => {
        write('forever.js', 'setInterval(() => {}, 1000);');

        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [
                    {
                        name: 'forever',
                        directory: '.',
                        command: 'node',
                        args: ['forever.js'],
                    },
                ],
                webpack: [],
                ready_delay_ms: 0,
            },
        });
        await service.onServerStart();
        await service.onServerShutdown();

        expect(logLines(log)).toContain('[devwatch:forever] stopping process');
        await waitFor(
            () =>
                logLines(log).some((l) =>
                    l.includes('[devwatch:forever:exit] process exited'),
                ),
            'child killed',
        );
    });

    // -- webpack watchers ---------------------------------------------

    const makeWebpackProject = (
        name: string,
        configFile: string,
        contents: string,
        packageJson?: string,
    ): string => {
        const dir = path.join(workdir, name);
        rmSync(dir, { recursive: true, force: true });
        writeFileSync(
            path.join(
                (() => {
                    const { mkdirSync } =
                        require('node:fs') as typeof import('node:fs');
                    mkdirSync(path.join(dir, 'src'), { recursive: true });
                    return dir;
                })(),
                'src/entry.js',
            ),
            "console.log('hello');\n",
        );
        writeFileSync(path.join(dir, configFile), contents);
        if (packageJson) {
            writeFileSync(path.join(dir, 'package.json'), packageJson);
        }
        return name;
    };

    it('compiles a CommonJS webpack config and reports later rebuilds', async () => {
        const dir = makeWebpackProject(
            'cjs-project',
            'webpack.config.cjs',
            `module.exports = {
                mode: 'development',
                entry: './src/entry.js',
                output: { path: __dirname + '/out', filename: 'bundle.js' },
            };`,
        );

        let onConfigSaw: Record<string, unknown> | undefined;
        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [
                    {
                        name: 'cjs',
                        directory: dir,
                        onConfig: (cfg: Record<string, unknown>) => {
                            onConfigSaw = cfg;
                        },
                    },
                ],
                ready_delay_ms: 0,
            },
        });

        await service.onServerStart();
        expect(onConfigSaw).toBeDefined();
        // The watcher context is anchored at <root>/<directory> so relative
        // entries resolve regardless of the server's cwd.
        expect(onConfigSaw!.context).toBe(path.join(workdir, dir));

        // First build is silent by design; force a rebuild and assert the
        // update line shows up.
        await new Promise((r) => setTimeout(r, 500));
        writeFileSync(
            path.join(workdir, dir, 'src/entry.js'),
            "console.log('hello again');\n",
        );
        await waitFor(
            () =>
                logLines(log).some((l) =>
                    l.includes('[devwatch] updated cjs using Webpack'),
                ),
            'webpack rebuild',
        );

        await service.onServerShutdown();
    });

    it('resolves an ESM webpack config declared through package.json type', async () => {
        const dir = makeWebpackProject(
            'esm-project',
            'webpack.config.js',
            `export default {
                mode: 'development',
                entry: './src/entry.js',
                output: { filename: 'bundle.js' },
            };`,
            JSON.stringify({ name: 'esm-project', type: 'module' }),
        );

        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [{ directory: dir }],
                ready_delay_ms: 0,
            },
        });

        await service.onServerStart();
        await service.onServerShutdown();
        // Falling back to the directory as the display name is the
        // documented behaviour when `name` is omitted.
        expect(error).not.toHaveBeenCalled();
    });

    it('calls a config exported as a function and honours an explicit context', async () => {
        const dir = makeWebpackProject(
            'fn-project',
            'webpack.config.cjs',
            `module.exports = () => ({
                mode: 'development',
                context: 'src',
                entry: './entry.js',
                name: process.env.WEBPACK_MARKER,
                output: { path: __dirname + '/out', filename: 'bundle.js' },
            });`,
        );

        let seen: Record<string, unknown> | undefined;
        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [
                    {
                        name: 'fn',
                        directory: dir,
                        env: { WEBPACK_MARKER: 'set-during-load' },
                        onConfig: (cfg: Record<string, unknown>) => {
                            seen = cfg;
                        },
                    },
                ],
                ready_delay_ms: 0,
            },
        });

        await service.onServerStart();
        // Relative `context` resolves against <root>/<directory>.
        expect(seen!.context).toBe(path.join(workdir, dir, 'src'));
        // The entry's env map is applied while the config module runs, and
        // restored afterwards.
        expect(seen!.name).toBe('set-during-load');
        expect(process.env.WEBPACK_MARKER).toBeUndefined();
        await service.onServerShutdown();
    });

    it('reports a failing compilation instead of crashing the server', async () => {
        const dir = makeWebpackProject(
            'broken-project',
            'webpack.config.cjs',
            `module.exports = {
                mode: 'development',
                entry: './src/does-not-exist.js',
                output: { path: __dirname + '/out', filename: 'bundle.js' },
            };`,
        );

        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [{ name: 'broken', directory: dir }],
                ready_delay_ms: 0,
            },
        });

        await service.onServerStart();
        await waitFor(
            () =>
                logLines(error).some((l) =>
                    l.includes('[devwatch] failed to update broken'),
                ),
            'webpack failure',
        );
        expect(
            logLines(error).some((l) =>
                l.includes('[devwatch] error information: broken'),
            ),
        ).toBe(true);
        await service.onServerShutdown();
    });

    it('fails loudly when a directory has no webpack config at all', async () => {
        const dir = path.join('no-config');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(path.join(workdir, dir), { recursive: true });

        const service = makeService({
            env: 'dev',
            devwatch: {
                root: workdir,
                commands: [],
                webpack: [{ name: 'missing', directory: dir }],
                ready_delay_ms: 0,
            },
        });

        await expect(service.onServerStart()).rejects.toThrow(
            'could not find webpack config for: no-config',
        );
        await service.onServerShutdown();
    });
});
