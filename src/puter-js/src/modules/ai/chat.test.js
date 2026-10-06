import { describe, expect, it } from 'vitest';
import { normalizeToolChoice } from './chat.js';

describe('normalizeToolChoice', () => {
    it('maps the OpenAI-style shorthand strings to the normalized object form', () => {
        expect(normalizeToolChoice('auto')).toEqual({ type: 'auto' });
        expect(normalizeToolChoice('none')).toEqual({ type: 'none' });
        expect(normalizeToolChoice('required')).toEqual({ type: 'any' });
    });

    it('passes the object form (including a named tool) through unchanged', () => {
        expect(normalizeToolChoice({ type: 'auto' })).toEqual({ type: 'auto' });
        expect(normalizeToolChoice({ type: 'tool', name: 'Bash' })).toEqual({
            type: 'tool',
            name: 'Bash',
        });
    });

    it('passes an unrecognized string through unchanged rather than dropping it', () => {
        expect(normalizeToolChoice('something-else')).toBe('something-else');
    });

    it('passes undefined through unchanged', () => {
        expect(normalizeToolChoice(undefined)).toBeUndefined();
    });
});
