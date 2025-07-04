import { describe, it, expect } from 'vitest';

describe('versionutil', () => {
    it('works', () => {
        const objects = [
            { version: '1.2.0' },
            { version: '3.0.2' },
            { version: '1.2.1' },
            { version: '1.2.0' },
            { version: '3.1.0', h: true },
            { version: '1.2.2' },
        ];

        const { find_highest_version } = require('./versionutil');
        const highest_object = find_highest_version(objects);
        expect(highest_object).toEqual({ version: '3.1.0', h: true });
    });
});