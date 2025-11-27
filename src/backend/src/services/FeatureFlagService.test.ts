import { describe, expect, it } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { FeatureFlagService } from './FeatureFlagService';

describe('FeatureFlagService', async () => {
    const testKernel = await createTestKernel({
        serviceMap: {
            'feature-flag': FeatureFlagService,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const featureFlagService = testKernel.services!.get('feature-flag') as FeatureFlagService;

    it('should be instantiated', () => {
        expect(featureFlagService).toBeInstanceOf(FeatureFlagService);
    });

    it('should register feature flags', () => {
        featureFlagService.register('test-flag', true);
        expect(featureFlagService.known_flags.has('test-flag')).toBe(true);
    });

    it('should register config flags', () => {
        featureFlagService.register('config-flag', { $: 'config-flag', value: true });
        expect(featureFlagService.known_flags.get('config-flag')).toEqual({ $: 'config-flag', value: true });
    });

    it('should check config flags', async () => {
        featureFlagService.register('enabled-flag', { $: 'config-flag', value: true });
        const result = await featureFlagService.check('enabled-flag');
        expect(result).toBe(true);
    });

    it('should check disabled config flags', async () => {
        featureFlagService.register('disabled-flag', { $: 'config-flag', value: false });
        const result = await featureFlagService.check('disabled-flag');
        expect(result).toBe(false);
    });

    it('should register function flags', () => {
        featureFlagService.register('fn-flag', {
            $: 'function-flag',
            fn: async () => true,
        });
        expect(featureFlagService.known_flags.has('fn-flag')).toBe(true);
    });

    it('should check function flags', async () => {
        featureFlagService.register('dynamic-flag', {
            $: 'function-flag',
            fn: async ({ actor }) => actor?.type?.user?.username === 'test',
        });
        
        const result = await featureFlagService.check({ actor: { type: { user: { username: 'test' } } } }, 'dynamic-flag');
        expect(result).toBe(true);
    });

    it('should support function flags with different conditions', async () => {
        featureFlagService.register('conditional-flag', {
            $: 'function-flag',
            fn: async ({ actor }) => actor?.type?.user?.username !== 'test',
        });
        
        const result = await featureFlagService.check({ actor: { type: { user: { username: 'other' } } } }, 'conditional-flag');
        expect(result).toBe(true);
    });

    it('should manage multiple flags', () => {
        featureFlagService.register('multi-flag-1', { $: 'config-flag', value: true });
        featureFlagService.register('multi-flag-2', { $: 'config-flag', value: false });
        featureFlagService.register('multi-flag-3', {
            $: 'function-flag',
            fn: async () => true,
        });
        
        expect(featureFlagService.known_flags.has('multi-flag-1')).toBe(true);
        expect(featureFlagService.known_flags.has('multi-flag-2')).toBe(true);
        expect(featureFlagService.known_flags.has('multi-flag-3')).toBe(true);
        expect(featureFlagService.known_flags.size).toBeGreaterThanOrEqual(3);
    });
});

