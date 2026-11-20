import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import APICallLogger from './APICallLogger.js';

let log;
let error;

beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

const bold = text => `\x1b[1m${text}\x1b[22m`;

describe('APICallLogger', () => {
    it('logs nothing until enabled', () => {
        const logger = new APICallLogger();
        expect(logger.isEnabled()).toBe(false);
        logger.logRequest({ service: 'fs', operation: 'read', params: { path: '/a.txt' }, result: 'ok' });
        expect(log).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('logs a call as service, operation and parameters, with its result', () => {
        const logger = new APICallLogger({ enabled: true });
        logger.logRequest({ service: 'fs', operation: 'read', params: { path: '/a.txt' }, result: { size: 3 } });
        expect(log).toHaveBeenCalledWith(`fs - read - ${bold('{"path":"/a.txt"}')}`, { size: 3 });
        expect(error).not.toHaveBeenCalled();
    });

    it('logs a failed call as an error, with its message', () => {
        const logger = new APICallLogger({ enabled: true });
        logger.logRequest({ service: 'kv', operation: 'get', params: { key: 'k' }, error: new Error('Key too long') });
        logger.logRequest({ service: 'kv', operation: 'get', params: { key: 'k' }, error: 'offline', result: 'partial' });
        expect(error.mock.calls).toEqual([
            [`kv - get - ${bold('{"key":"k"}')}`, { error: 'Key too long', result: null }],
            [`kv - get - ${bold('{"key":"k"}')}`, { error: 'offline', result: 'partial' }],
        ]);
        expect(log).not.toHaveBeenCalled();
    });

    it('fills in what a call leaves out, and survives parameters that cannot be serialized', () => {
        const logger = new APICallLogger({ enabled: true });
        const circular = {};
        circular.self = circular;
        logger.logRequest();
        logger.logRequest({ service: 'ai', operation: 'chat', params: circular });
        logger.logRequest({ service: 'ai', operation: 'chat', params: null });
        expect(log.mock.calls).toEqual([
            [`unknown - unknown - ${bold('{}')}`, null],
            [`ai - chat - ${bold('[Unable to serialize params]')}`, null],
            [`ai - chat - ${bold('{}')}`, null],
        ]);
    });

    it('can be switched on and off, and reports its configuration', () => {
        const logger = new APICallLogger({ enabled: false, verbose: true });
        logger.enable();
        expect(logger.isEnabled()).toBe(true);
        logger.disable();
        expect(logger.isEnabled()).toBe(false);

        logger.updateConfig({ enabled: true, tag: 'boot' });
        expect(logger.getStats()).toEqual({
            enabled: true,
            config: { enabled: true, verbose: true, tag: 'boot' },
        });
        logger.logRequest({ service: 'fs', operation: 'stat' });
        expect(log).toHaveBeenCalledTimes(1);
    });
});
