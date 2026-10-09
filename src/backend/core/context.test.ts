import { describe, expect, it } from 'vitest';
import { Context, runInDerivedContext, runWithContext } from './context';

describe('Context', () => {
    it('reads back a known key set after the scope opened with it', () => {
        runWithContext({ driverName: 'initial' }, () => {
            Context.set('driverName', 'addressed');
            expect(Context.get('driverName')).toBe('addressed');
        });
    });

    it('reads every known key from where set writes it', () => {
        const signal = new AbortController().signal;
        runWithContext({}, () => {
            Context.set('requestId', 'r-1');
            Context.set('driverName', 'd');
            Context.set('abortSignal', signal);
            Context.set('strictUpstreamErrors', true);
            expect(Context.get('requestId')).toBe('r-1');
            expect(Context.get('driverName')).toBe('d');
            expect(Context.get('abortSignal')).toBe(signal);
            expect(Context.get('strictUpstreamErrors')).toBe(true);
            expect(Context.current()?.extra.size).toBe(0);
        });
    });

    it('keeps ad-hoc keys in the open map', () => {
        runWithContext({}, () => {
            Context.set('myService.txId', 'tx');
            expect(Context.get('myService.txId')).toBe('tx');
            expect(Context.get('toString')).toBeUndefined();
        });
    });

    it('keeps an untyped extra key passed to the scope readable', () => {
        const initial = { requestId: 'r', 'myService.txId': 'tx' };
        runWithContext(initial as { requestId: string }, () => {
            expect(Context.get('requestId')).toBe('r');
            expect(Context.get('myService.txId')).toBe('tx');
        });
    });

    it('isolates a derived scope from its parent', () => {
        runWithContext({ driverName: 'outer' }, () => {
            runInDerivedContext(() => {
                Context.set('driverName', 'inner');
                expect(Context.get('driverName')).toBe('inner');
            });
            expect(Context.get('driverName')).toBe('outer');
        });
    });
});
