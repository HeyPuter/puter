/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const logSeverity = (ordinal, label, esc, winst) => ({ ordinal, label, esc, winst });
const LOG_LEVEL_ERRO = logSeverity(0, 'ERRO', '31;1', 'error');
const LOG_LEVEL_WARN = logSeverity(1, 'WARN', '33;1', 'warn');
const LOG_LEVEL_INFO = logSeverity(2, 'INFO', '36;1', 'info');
const LOG_LEVEL_TICK = logSeverity(10, 'TICK', '34;1', 'info');
const LOG_LEVEL_DEBU = logSeverity(4, 'DEBU', '37;1', 'debug');
const LOG_LEVEL_NOTICEME = logSeverity(4, 'NOTICE_ME', '33;1', 'error');
const LOG_LEVEL_SYSTEM = logSeverity(4, 'SYSTEM', '33;1', 'system');

const winston = require('winston');
const { Context } = require('../../util/context');
const BaseService = require('../BaseService');
require('winston-daily-rotate-file');

const WINSTON_LEVELS = {
    system: 0,
    error: 1,
    warn: 10,
    info: 20,
    http: 30,
    verbose: 40,
    debug: 50,
    silly: 60
};

class LogContext {
    constructor (logService, { crumbs, fields }) {
        this.logService = logService;
        this.crumbs = crumbs;
        this.fields = fields;
    }

    sub (name, fields = {}) {
        return new LogContext(
            this.logService,
            {
                crumbs: name ? [...this.crumbs, name] : [...this.crumbs],
                fields: {...this.fields, ...fields},
            }
        );
    }

    info  (message, fields, objects) { this.log(LOG_LEVEL_INFO, message, fields, objects); }
    warn  (message, fields, objects) { this.log(LOG_LEVEL_WARN, message, fields, objects); }
    debug (message, fields, objects) { this.log(LOG_LEVEL_DEBU, message, fields, objects); }
    error (message, fields, objects) { this.log(LOG_LEVEL_ERRO, message, fields, objects); }
    tick  (message, fields, objects) { this.log(LOG_LEVEL_TICK, message, fields, objects); }
    called (fields = {}) {
        this.log(LOG_LEVEL_DEBU, 'called', fields);
    }
    noticeme (message, fields, objects) {
        this.log(LOG_LEVEL_NOTICEME, message, fields, objects);
    }
    system (message, fields, objects) {
        this.log(LOG_LEVEL_SYSTEM, message, fields, objects);
    }

    cache (isCacheHit, identifier, fields = {}) {
        this.log(
            LOG_LEVEL_DEBU,
            isCacheHit ? 'cache_hit' : 'cache_miss',
            { identifier, ...fields },
        );
    }

    log (log_level, message, fields = {}, objects = {}) {
        fields = { ...this.fields, ...fields };
        {
            const x = Context.get(undefined, { allow_fallback: true });
            if ( x && x.get('trace_request') ) {
                fields.trace_request = x.get('trace_request');
            }
        }
        this.logService.log_(
            log_level,
            this.crumbs,
            message, fields, objects,
        );
    }

    // convenience method to get a trace id that isn't as difficult
    // for a human to read as a uuid.
    mkid () {
        // generate trace id
        const trace_id = [];
        for ( let i = 0; i < 2; i++ ) {
            trace_id.push(Math.random().toString(36).slice(2, 8));
        }
        return trace_id.join('-');
    }

    // add a trace id to this logging context
    traceOn () {
        this.fields.trace_id = this.mkid();
        return this;
    }

    get_log_buffer () {
        return this.logService.get_log_buffer();
    }
}

let log_epoch = Date.now();
const stringify_log_entry = ({ prefix, log_lvl, crumbs, message, fields, objects }) => {
    const { colorize } = require('json-colorizer');

    let lines = [], m;
    const lf = () => {
        if ( ! m ) return;
        lines.push(m);
        m = '';
    }

    m = prefix ? `${prefix} ` : '';
    m += `\x1B[${log_lvl.esc}m[${log_lvl.label}\x1B[0m`;
    for ( const crumb of crumbs ) {
        m += `::${crumb}`;
    }
    m += `\x1B[${log_lvl.esc}m]\x1B[0m`;
    if ( fields.timestamp ) {
        // display seconds since logger epoch
        const n = (fields.timestamp - log_epoch) / 1000;
        m += ` (${n.toFixed(3)}s)`;
    }
    m += ` ${message} `;
    lf();
    for ( const k in fields ) {
        if ( k === 'timestamp' ) continue;
        let v; try {
            v = colorize(JSON.stringify(fields[k]));
        } catch (e) {
            v = '' + fields[k];
        }
        m += ` \x1B[1m${k}:\x1B[0m ${v}`;
        lf();
    }
    return lines.join('\n');
};


class DevLogger {
    // TODO: this should eventually delegate to winston logger
    constructor (log, opt_delegate) {
        this.log = log;
        this.off = false;

        if ( opt_delegate ) {
            this.delegate = opt_delegate;
        }
    }
    onLogMessage (log_lvl, crumbs, message, fields, objects) {
        if ( this.delegate ) {
            this.delegate.onLogMessage(
                log_lvl, crumbs, message, fields, objects,
            );
        }

        if ( this.off ) return;

        const ld = Context.get('logdent', { allow_fallback: true })
        const prefix = globalThis.dev_console_indent_on
            ? Array(ld ?? 0).fill('    ').join('')
            : '';
        this.log(stringify_log_entry({
            prefix,
            log_lvl, crumbs, message, fields, objects,
        }));
    }
}

class NullLogger {
    // TODO: this should eventually delegate to winston logger
    constructor (log, opt_delegate) {
        this.log = log;

        if ( opt_delegate ) {
            this.delegate = opt_delegate;
        }
    }
    onLogMessage () {
    }
}

class WinstonLogger {
    constructor (winst) {
        this.winst = winst;
    }
    onLogMessage (log_lvl, crumbs, message, fields, objects) {
        this.winst.log({
            ...fields,
            label: crumbs.join('.'),
            level: log_lvl.winst,
            message,
        });
    }
}

class TimestampLogger {
    constructor (delegate) {
        this.delegate = delegate;
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        fields = { ...fields, timestamp: new Date() };
        this.delegate.onLogMessage(log_lvl, crumbs, message, fields, ...a);
    }
}

class BufferLogger {
    constructor (size, delegate) {
        this.size = size;
        this.delegate = delegate;
        this.buffer = [];
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        this.buffer.push({ log_lvl, crumbs, message, fields, ...a });
        if ( this.buffer.length > this.size ) {
            this.buffer.shift();
        }
        this.delegate.onLogMessage(log_lvl, crumbs, message, fields, ...a);
    }
}

class CustomLogger {
    constructor (delegate, callback) {
        this.delegate = delegate;
        this.callback = callback;
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        // Logging is allowed to be performed without a context, but we
        // don't want log functions to be asynchronous which rules out
        // wrapping with Context.allow_fallback. Instead we provide a
        // context as a parameter.
        const context = Context.get(undefined, { allow_fallback: true });

        const {
            log_lvl: _log_lvl,
            crumbs: _crumbs,
            message: _message,
            fields: _fields,
            args,
        } = this.callback({
            context,
            log_lvl, crumbs, message, fields, args: a,
        });
        this.delegate.onLogMessage(
            _log_lvl ?? log_lvl,
            _crumbs ?? crumbs,
            _message ?? message,
            _fields ?? fields,
            ...(args ?? a ?? []),
        );
    }
}

class LogService extends BaseService {
    static MODULES = {
        path: require('path'),
    }
    async _construct () {
        this.loggers = [];
        this.bufferLogger = null;
    }
    register_log_middleware (callback) {
        this.loggers[0] = new CustomLogger(this.loggers[0], callback);
    }
    ['__on_boot.consolidation'] () {
        const commands = this.services.get('commands');
        commands.registerCommands('logs', [
            {
                id: 'show',
                description: 'toggle log output',
                handler: async (args, log) => {
                    this.devlogger && (this.devlogger.off = ! this.devlogger.off);
                }
            },
            {
                id: 'indent',
                description: 'toggle log indentation',
                handler: async (args, log) => {
                    globalThis.dev_console_indent_on =
                        ! globalThis.dev_console_indent_on;
                }
            }
        ]);
    }
    async _init () {
        const config = this.global_config;

        this.ensure_log_directory_();

        let logger;

        logger = new WinstonLogger(
            winston.createLogger({
                levels: WINSTON_LEVELS,
                transports: [
                    new winston.transports.DailyRotateFile({
                        filename: `${this.log_directory}/%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                    new winston.transports.DailyRotateFile({
                        level: 'error',
                        filename: `${this.log_directory}/error-%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                    new winston.transports.DailyRotateFile({
                        level: 'system',
                        filename: `${this.log_directory}/system-%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                ],
            }),
        );

        if ( config.env === 'dev' ) {
            logger = config.flag_no_logs // useful for profiling
                ? new NullLogger()
                : new DevLogger(console.log.bind(console), logger);
            
            this.devlogger = logger;
        }

        logger = new TimestampLogger(logger);

        logger = new BufferLogger(config.log_buffer_size ?? 20, logger);
        this.bufferLogger = logger;

        this.loggers.push(logger);

        this.output_lvl = LOG_LEVEL_INFO;
        if ( config.logger ) {
            // config.logger.level is a string, e.g. 'debug'

            // first we find the appropriate log level
            const output_lvl = Object.values({
                LOG_LEVEL_ERRO,
                LOG_LEVEL_WARN,
                LOG_LEVEL_INFO,
                LOG_LEVEL_DEBU,
                LOG_LEVEL_TICK,
            }).find(lvl => {
                return lvl.label === config.logger.level.toUpperCase() ||
                    lvl.winst === config.logger.level.toLowerCase() ||
                    lvl.ordinal === config.logger.level;
            });

            // then we set the output level to the ordinal of that level
            this.output_lvl = output_lvl.ordinal;
        }

        this.log = this.create('log-service');
        this.log.system('log service started', {
            output_lvl: this.output_lvl,
            log_directory: this.log_directory,
        });

        this.services.logger = this.create('services-container');
        globalThis.root_context.set('logger', this.create('root-context'));
    }

    create (prefix, fields = {}) {
        const logContext = new LogContext(
            this,
            {
                crumbs: [prefix],
                fields,
            },
        );

        return logContext;
    }

    log_ (log_lvl, crumbs, message, fields, objects) {
        try {
            // skip messages that are above the output level
            if ( log_lvl.ordinal > this.output_lvl ) return;

            for ( const logger of this.loggers ) {
                logger.onLogMessage(
                    log_lvl, crumbs, message, fields, objects,
                );
            }
        } catch (e) {
            // If logging fails, we don't want anything to happen
            // that might trigger a log message. This causes an
            // infinite loop and I learned that the hard way.
            console.error('Logging failed', e);

            // TODO: trigger an alarm either in a non-logging
            // context (prereq: per-context service overrides)
            // or with a cooldown window (prereq: cooldowns in AlarmService)
        }
    }

    ensure_log_directory_ () {
        // STEP 1: Try /var/puter/logs/heyputer
        {
            const fs = require('fs');
            const path = '/var/puter/logs/heyputer';
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 2: Try /tmp/heyputer
        {
            const fs = require('fs');
            const path = '/tmp/heyputer';
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 3: Try working directory
        {
            const fs = require('fs');
            const path = './heyputer';
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 4: Give up
        throw new Error('Unable to create or find log directory');
    }

    get_log_file (name) {
        // sanitize name: cannot contain path characters
        name = name.replace(/[^a-zA-Z0-9-_]/g, '_');
        return this.modules.path.join(this.log_directory, name);
    }

    get_log_buffer () {
        return this.bufferLogger.buffer;
    }
}

module.exports = {
    LogService,
    stringify_log_entry
};