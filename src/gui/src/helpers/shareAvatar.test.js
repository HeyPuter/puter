import { describe, expect, it } from 'vitest';
import { avatarHue, avatarInitial } from './shareAvatar.js';

describe('avatarHue', () => {
    it('gives the same person the same color every time', () => {
        expect(avatarHue('juan')).toBe(avatarHue('juan'));
    });

    it('stays a usable hue', () => {
        for ( const name of ['a', 'juan', 'someone@example.com', '𝒥'.repeat(40)] ) {
            const hue = avatarHue(name);
            expect(Number.isInteger(hue)).toBe(true);
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });

    it('tells different people apart', () => {
        expect(avatarHue('ann')).not.toBe(avatarHue('bob'));
    });

    it('handles a missing name instead of throwing', () => {
        expect(avatarHue(undefined)).toBe(0);
        expect(avatarHue(null)).toBe(0);
        expect(avatarHue('')).toBe(0);
    });
});

describe('avatarInitial', () => {
    it('uppercases the first letter', () => {
        expect(avatarInitial('juan')).toBe('J');
        expect(avatarInitial('Ann')).toBe('A');
    });

    it('ignores surrounding whitespace', () => {
        expect(avatarInitial('  ann ')).toBe('A');
    });

    it('falls back to ? when there is no name', () => {
        // A pending invite has no username until the recipient joins.
        expect(avatarInitial('')).toBe('?');
        expect(avatarInitial('   ')).toBe('?');
        expect(avatarInitial(undefined)).toBe('?');
        expect(avatarInitial(null)).toBe('?');
    });

    it('keeps an astral first character whole', () => {
        // charAt(0) would return half a surrogate pair and render as tofu.
        expect(avatarInitial('😀 team')).toBe('😀');
    });
});
