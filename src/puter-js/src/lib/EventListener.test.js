import { describe, expect, it, vi } from 'vitest';
import EventListener from './EventListener.js';

describe('EventListener', () => {
    it('calls the next handler when one removes itself mid-emit', () => {
        const emitter = new EventListener(['tick']);
        const calls = [];
        const once = () => {
            calls.push('once');
            emitter.off('tick', once);
        };
        emitter.on('tick', once);
        emitter.on('tick', () => calls.push('second'));

        emitter.emit('tick');
        emitter.emit('tick');

        expect(calls).toEqual(['once', 'second', 'second']);
    });

    it('runs a handler added mid-emit from the next emit on', () => {
        const emitter = new EventListener(['tick']);
        const late = vi.fn();
        emitter.on('tick', () => emitter.on('tick', late));

        emitter.emit('tick');
        expect(late).not.toHaveBeenCalled();

        emitter.emit('tick');
        expect(late).toHaveBeenCalledOnce();
    });

    it('accepts event names that collide with Map members', () => {
        const emitter = new EventListener(['size', 'get', 'constructor']);
        const handler = vi.fn();
        emitter.on('size', handler);
        emitter.on('get', handler);
        emitter.on('constructor', handler);

        emitter.emit('size', 1);
        emitter.emit('get', 2);
        emitter.emit('constructor', 3);

        expect(handler.mock.calls).toEqual([[1], [2], [3]]);
    });

    it('reports and ignores an unsupported event', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const emitter = new EventListener(['tick']);
        expect(emitter.on('other', () => {})).toBeUndefined();
        expect(emitter.off('other', () => {})).toBeUndefined();
        emitter.emit('other');
        expect(error).toHaveBeenCalledTimes(3);
        error.mockRestore();
    });
});
