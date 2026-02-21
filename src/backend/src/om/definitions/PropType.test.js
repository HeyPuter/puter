import { describe, expect, it } from 'vitest';

const { PropType } = require('./PropType');

describe('PropType adapt chain ordering', () => {
    it('runs subtype adapters before supertype adapters on every call', async () => {
        const callOrder = [];
        const typ = new PropType({
            name: 'test',
            chains: {
                adapt: [
                    value => {
                        callOrder.push('super');
                        if ( typeof value !== 'string' ) {
                            throw new Error('expected string');
                        }
                        return value;
                    },
                    value => {
                        callOrder.push('sub');
                        if ( value && typeof value === 'object' && typeof value.url === 'string' ) {
                            return value.url;
                        }
                        return value;
                    },
                ],
            },
        });

        await expect(typ.adapt({ url: 'https://example.com/icon-a.png' }))
            .resolves.toBe('https://example.com/icon-a.png');
        await expect(typ.adapt({ url: 'https://example.com/icon-b.png' }))
            .resolves.toBe('https://example.com/icon-b.png');

        expect(callOrder).toEqual(['sub', 'super', 'sub', 'super']);
    });
});
