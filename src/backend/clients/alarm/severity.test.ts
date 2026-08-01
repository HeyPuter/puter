import { describe, expect, it, vi } from 'vitest';
import { meetsMinSeverity, resolveSeverityOverride } from './severity';

describe('meetsMinSeverity', () => {
    it('accepts everything at or above the floor', () => {
        expect(meetsMinSeverity('critical', 'warning')).toBe(true);
        expect(meetsMinSeverity('error', 'warning')).toBe(true);
        expect(meetsMinSeverity('warning', 'warning')).toBe(true);
        expect(meetsMinSeverity('info', 'warning')).toBe(false);
    });

    it('lets an info floor take every severity', () => {
        for (const severity of [
            'critical',
            'error',
            'warning',
            'info',
        ] as const) {
            expect(meetsMinSeverity(severity, 'info')).toBe(true);
        }
    });
});

describe('resolveSeverityOverride', () => {
    it('returns undefined without overrides or on no match', () => {
        expect(resolveSeverityOverride('a:b', undefined)).toBeUndefined();
        expect(
            resolveSeverityOverride('a:b', { 'c:*': 'info' }),
        ).toBeUndefined();
    });

    it('matches an exact id', () => {
        expect(
            resolveSeverityOverride('cronMonitor:lowSignupRate', {
                'cronMonitor:lowSignupRate': 'info',
            }),
        ).toBe('info');
    });

    it('matches a prefix pattern', () => {
        expect(
            resolveSeverityOverride('cronMonitor:high_aiLogEntries', {
                'cronMonitor:*': 'warning',
            }),
        ).toBe('warning');
    });

    it('prefers the exact id over a prefix pattern', () => {
        expect(
            resolveSeverityOverride('cronMonitor:lowSignupRate', {
                'cronMonitor:*': 'warning',
                'cronMonitor:lowSignupRate': 'mute',
            }),
        ).toBe('mute');
    });

    it('prefers the longest matching prefix', () => {
        expect(
            resolveSeverityOverride('abuse:card-verification:setup-failed', {
                'abuse:*': 'info',
                'abuse:card-verification:*': 'mute',
            }),
        ).toBe('mute');
    });

    it('drops an unrecognized rule rather than guessing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(
            resolveSeverityOverride('a:b', {
                'a:b': 'silent' as unknown as 'mute',
            }),
        ).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
