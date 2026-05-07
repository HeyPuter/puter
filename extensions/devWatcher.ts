import { extension } from '@heyputer/backend/src/extensions';
import { PuterService } from '@heyputer/backend/src/services/types.js';
import { nativeImport } from '@heyputer/backend/src/util/nativeImport.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const requireFromHere = createRequire(__filename);
const webpack = requireFromHere('webpack') as typeof import('webpack');

type EnvFactory = (args: {
    global_config: Record<string, unknown> | null;
}) => string | undefined;

type EnvMap = Record<string, string | undefined | EnvFactory>;

type CommandEntry = {
    name: string;
    directory: string;
    command: string;
    args?: string[];
    env?: EnvMap;
};

type WebpackEntry = {
    name?: string;
    directory: string;
    env?: EnvMap;
    onConfig?: (config: Record<string, unknown>) => void;
};

type WebpackStats = {
    hasErrors: () => boolean;
    toJson: (options: Record<string, unknown>) => {
        errors?: Array<{ message?: string }>;
        warnings?: Array<{ message?: string }>;
    };
};

type DevWatcherConfig = {
    enabled?: boolean;
    root?: string;
    commands?: CommandEntry[];
    webpack?: WebpackEntry[];
    ready_delay_ms?: number;
};

class ProxyLogger {
    #buffer = '';

    constructor(private readonly log: (line: string) => void) {}

    attach(stream: NodeJS.ReadableStream | null): void {
        if (!stream) return;
        stream.on('data', (chunk) => {
            this.#buffer += chunk.toString();
            let lineEndIndex = this.#buffer.indexOf('\n');
            while (lineEndIndex !== -1) {
                const line = this.#buffer.substring(0, lineEndIndex);
                this.log(line);
                this.#buffer = this.#buffer.substring(lineEndIndex + 1);
                lineEndIndex = this.#buffer.indexOf('\n');
            }
        });

        stream.on('end', () => {
            if (this.#buffer.length) {
                this.log(this.#buffer);
                this.#buffer = '';
            }
        });
    }
}

const findPackageRoot = (): string => {
    let dir = __dirname;
    for (;;) {
        if (
            existsSync(path.join(dir, 'package.json')) &&
            existsSync(path.join(dir, 'src', 'gui')) &&
            existsSync(path.join(dir, 'src', 'puter-js'))
        ) {
            return dir;
        }

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return path.resolve(__dirname, '..', '..');
};

const resolveFromRoot = (root: string, value: string): string =>
    path.isAbsolute(value) ? value : path.resolve(root, value);

const defaultWebpackEntries: WebpackEntry[] = [
    {
        name: 'puter.js',
        directory: 'src/puter-js',
        onConfig: (config) => {
            const output = (config.output ?? {}) as Record<string, unknown>;
            output.filename = 'puter.dev.js';
            config.output = output;
            config.devtool = 'source-map';
        },
        env: {
            PUTER_ORIGIN: ({ global_config }) =>
                String(global_config?.origin ?? ''),
            PUTER_API_ORIGIN: ({ global_config }) =>
                String(global_config?.api_base_url ?? ''),
        },
    },
    {
        name: 'gui',
        directory: 'src/gui',
    },
];

class DevWatcherService extends PuterService {
    #processes: Array<{ name: string; proc: ChildProcess }> = [];
    #watchers: ReturnType<ReturnType<typeof webpack>['watch']>[] = [];
    #started = false;
    #packageRoot = findPackageRoot();

    override async onServerStart(): Promise<void> {
        if (!this.#shouldStart()) return;
        if (this.#started) return;
        this.#started = true;

        const devwatch = this.#devwatchConfig();
        const root = resolveFromRoot(
            this.#packageRoot,
            devwatch.root ?? this.#packageRoot,
        );
        const commands = devwatch.commands ?? [];
        const webpackEntries = devwatch.webpack ?? defaultWebpackEntries;

        console.log(`[devwatch] starting watchers from ${root}`);
        await Promise.all([
            ...commands.map((entry) => this.#startCommand(root, entry)),
            ...webpackEntries.map((entry) =>
                this.#startWebpackWatcher(root, entry),
            ),
        ]);

        const readyDelayMs = devwatch.ready_delay_ms ?? 5000;
        if (readyDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, readyDelayMs));
        }
    }

    override async onServerShutdown(): Promise<void> {
        await Promise.all(
            this.#watchers.map(
                (watcher) =>
                    new Promise<void>((resolve) => {
                        watcher?.close((err) => {
                            if (err) {
                                console.warn(
                                    '[devwatch] failed to close webpack watcher:',
                                    err,
                                );
                            }
                            resolve();
                        });
                    }),
            ),
        );
        this.#watchers = [];

        for (const { name, proc } of this.#processes) {
            if (proc.exitCode !== null || proc.killed) continue;
            console.log(`[devwatch:${name}] stopping process`);
            proc.kill();
        }
        this.#processes = [];
    }

    #devwatchConfig(): DevWatcherConfig {
        const raw = (this.config as Record<string, unknown>).devwatch;
        return raw && typeof raw === 'object' ? (raw as DevWatcherConfig) : {};
    }

    #shouldStart(): boolean {
        const config = this.config as Record<string, unknown>;
        const devwatch = this.#devwatchConfig();

        if (config.no_devwatch === true) return false;
        if (devwatch.enabled === false) return false;
        if (devwatch.enabled === true) return true;

        return this.config.env === 'dev';
    }

    async #startCommand(root: string, entry: CommandEntry): Promise<void> {
        const fullpath = resolveFromRoot(root, entry.directory);
        console.log(`[devwatch] starting ${entry.name} in ${fullpath}`);

        const proc = spawn(entry.command, entry.args ?? [], {
            shell: true,
            cwd: fullpath,
            env: {
                ...process.env,
                ...this.#evaluateEnv(entry.env),
            },
        });
        this.#processes.push({ name: entry.name, proc });

        new ProxyLogger((line) =>
            console.log(`[devwatch:${entry.name}:1] ${line}`),
        ).attach(proc.stdout);
        new ProxyLogger((line) =>
            console.warn(`[devwatch:${entry.name}:2] ${line}`),
        ).attach(proc.stderr);

        proc.on('exit', () => {
            console.log(
                `[devwatch:${entry.name}:exit] process exited (${proc.exitCode})`,
            );
            this.#processes = this.#processes.filter(
                (instance) => instance.proc !== proc,
            );
        });
    }

    async #startWebpackWatcher(
        root: string,
        entry: WebpackEntry,
    ): Promise<void> {
        const directory = entry.directory;
        let { configjsPath: webpackConfigPath, moduleType } = this.#getConfigJs(
            {
                root,
                directory,
                configIsFor: 'webpack',
                possibleConfigNames: [
                    ['webpack.config.js', 'package.json'],
                    ['webpack.config.cjs', 'commonjs'],
                    ['webpack.config.mjs', 'module'],
                ],
            },
        );

        let webpackConfig = await this.#withEnv(entry.env, async () => {
            if (moduleType === 'module') {
                webpackConfigPath = pathToFileURL(webpackConfigPath).href;
                const imported = await nativeImport<{ default?: unknown }>(
                    webpackConfigPath,
                );
                return imported.default ?? imported;
            }
            return requireFromHere(webpackConfigPath);
        });

        if (typeof webpackConfig === 'function') {
            webpackConfig = await this.#withEnv(entry.env, () =>
                (webpackConfig as () => unknown)(),
            );
        }

        this.#normalizeWebpackContext(root, directory, webpackConfig);
        if (entry.onConfig) {
            entry.onConfig(webpackConfig as Record<string, unknown>);
        }

        const compiler = webpack(
            webpackConfig as Parameters<typeof webpack>[0],
        );
        const watcher = compiler.watch({}, (err, stats) => {
            this.#handleWebpackUpdate(entry, err, stats);
        });
        this.#watchers.push(watcher);
    }

    #getConfigJs(args: {
        root: string;
        directory: string;
        configIsFor: string;
        possibleConfigNames: Array<
            [string, 'package.json' | 'commonjs' | 'module']
        >;
    }): {
        configjsPath: string;
        moduleType: 'commonjs' | 'module';
    } {
        const { root, directory, configIsFor, possibleConfigNames } = args;
        let configjsPath: string | undefined;
        let moduleType: 'package.json' | 'commonjs' | 'module' | undefined;

        for (const [configName, supposedModuleType] of possibleConfigNames) {
            const supposedPath = path.join(root, directory, configName);
            if (existsSync(supposedPath)) {
                configjsPath = supposedPath;
                moduleType = supposedModuleType;
                break;
            }
        }

        if (!configjsPath || !moduleType) {
            throw new Error(
                `could not find ${configIsFor} config for: ${directory}`,
            );
        }

        if (moduleType === 'package.json') {
            const packageJSONPath = path.join(root, directory, 'package.json');
            const packageJSONObject = JSON.parse(
                readFileSync(packageJSONPath, 'utf8'),
            ) as { type?: 'commonjs' | 'module' };
            moduleType = packageJSONObject.type ?? 'module';
        }

        return {
            configjsPath,
            moduleType,
        };
    }

    async #withEnv<T>(env: EnvMap | undefined, fn: () => T | Promise<T>) {
        if (!env) return fn();

        const oldEnv = process.env;
        process.env = {
            ...oldEnv,
            ...this.#evaluateEnv(env),
        };

        try {
            return await fn();
        } finally {
            process.env = oldEnv;
        }
    }

    #evaluateEnv(env: EnvMap | undefined): Record<string, string> {
        const out: Record<string, string> = {};
        if (!env) return out;

        for (const [key, value] of Object.entries(env)) {
            try {
                const evaluated =
                    typeof value === 'function'
                        ? value({
                              global_config: this.config as Record<
                                  string,
                                  unknown
                              >,
                          })
                        : value;
                if (evaluated) out[key] = String(evaluated);
            } catch (e) {
                const msg = (e as Error).message;
                if (
                    !msg.includes('Cannot read properties of null') &&
                    !msg.includes('Cannot read properties of undefined')
                ) {
                    console.warn(
                        `[devwatch] could not evaluate env function for ${key}: ${msg}`,
                    );
                }
            }
        }
        return out;
    }

    #normalizeWebpackContext(
        root: string,
        directory: string,
        webpackConfig: unknown,
    ): void {
        const configs = Array.isArray(webpackConfig)
            ? webpackConfig
            : [webpackConfig];

        for (const config of configs) {
            if (!config || typeof config !== 'object') continue;
            const obj = config as Record<string, unknown>;
            obj.context = obj.context
                ? path.resolve(path.join(root, directory), String(obj.context))
                : path.join(root, directory);
        }
    }

    #handleWebpackUpdate(
        entry: WebpackEntry,
        err: Error | null | undefined,
        stats: WebpackStats | undefined,
    ): void {
        const name = entry.name ?? entry.directory;
        const firstEventKey = `__devwatch_first_${entry.directory}`;
        const firstEvent = !(entry as Record<string, unknown>)[firstEventKey];
        (entry as Record<string, unknown>)[firstEventKey] = true;

        if (err || stats?.hasErrors()) {
            const info = stats?.toJson({
                all: false,
                errors: true,
                warnings: true,
            });
            console.error(
                `[devwatch] error information: ${name} using Webpack`,
                {
                    err: err ? err.message : null,
                    errors: info?.errors?.map((e) => e.message) ?? [],
                    warnings: info?.warnings?.map((w) => w.message) ?? [],
                },
            );
            console.error(`[devwatch] failed to update ${name} using Webpack`);
            return;
        }

        if (!firstEvent) {
            console.log(`[devwatch] updated ${name} using Webpack`);
        }
    }
}

extension.registerService('devWatcher', DevWatcherService);
