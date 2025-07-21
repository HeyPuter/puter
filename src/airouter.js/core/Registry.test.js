import { describe, it, expect } from 'vitest';
import { Registry } from './Registry.js';

describe('Registry', () => {
    it('should define and execute a simple provider', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const PAPER_PULP = Symbol('PAPER_PULP');
        const PAPER = Symbol('PAPER');

        define.howToGet(PAPER).from(PAPER_PULP).as(async x => {
            const paperPulp = x.get(PAPER_PULP);
            return `paper made from ${paperPulp}`;
        });

        const obtain = registry.getObtainAPI();

        const result = await obtain(PAPER, {
            [PAPER_PULP]: 'high-quality wood pulp',
        });

        expect(result).toBe('paper made from high-quality wood pulp');
    });

    it('should handle nested obtain calls', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const WOOD = Symbol('WOOD');
        const PAPER_PULP = Symbol('PAPER_PULP');
        const PAPER = Symbol('PAPER');

        // Define how to get paper pulp from wood
        define.howToGet(PAPER_PULP).from(WOOD).as(async x => {
            const wood = x.get(WOOD);
            return `pulp processed from ${wood}`;
        });

        // Define how to get paper from paper pulp
        define.howToGet(PAPER).as(async x => {
            const paperPulp = await x.obtain(PAPER_PULP, {
                [WOOD]: x.get(WOOD) || 'default wood'
            });
            return `paper made from ${paperPulp}`;
        });

        const obtain = registry.getObtainAPI();

        const result = await obtain(PAPER, {
            [WOOD]: 'oak trees',
        });

        expect(result).toBe('paper made from pulp processed from oak trees');
    });

    it('should throw error for undefined provider', async () => {
        const registry = new Registry();
        const obtain = registry.getObtainAPI();

        const UNKNOWN_TYPE = Symbol('UNKNOWN_TYPE');

        await expect(obtain(UNKNOWN_TYPE)).rejects.toThrow('No providers found for output type');
    });

    it('should throw error for incomplete provider definitions', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();
        const obtain = registry.getObtainAPI();

        const INCOMPLETE_TYPE = Symbol('INCOMPLETE_TYPE');

        // Provider with no .from() or .as()
        define.howToGet(INCOMPLETE_TYPE);
        
        await expect(obtain(INCOMPLETE_TYPE)).rejects.toThrow('no applicable providers');
    });

    it('should support multiple providers for the same output type', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const INPUT_A = Symbol('INPUT_A');
        const INPUT_B = Symbol('INPUT_B');
        const OUTPUT = Symbol('OUTPUT');

        // Provider 1: uses INPUT_A
        define.howToGet(OUTPUT).from(INPUT_A).as(async x => {
            return `result from A: ${x.get(INPUT_A)}`;
        });

        // Provider 2: uses INPUT_B
        define.howToGet(OUTPUT).from(INPUT_B).as(async x => {
            return `result from B: ${x.get(INPUT_B)}`;
        });

        const obtain = registry.getObtainAPI();

        // Should work with INPUT_A
        const resultA = await obtain(OUTPUT, { [INPUT_A]: 'value A' });
        expect(resultA).toBe('result from A: value A');

        // Should work with INPUT_B
        const resultB = await obtain(OUTPUT, { [INPUT_B]: 'value B' });
        expect(resultB).toBe('result from B: value B');

        // Should work with both (will pick one randomly)
        const resultBoth = await obtain(OUTPUT, { [INPUT_A]: 'value A', [INPUT_B]: 'value B' });
        expect(resultBoth).toMatch(/result from [AB]/);
    });

    it('should support predicates with .provided()', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const QUALITY = Symbol('QUALITY');
        const PAPER = Symbol('PAPER');

        // Provider 1: for high quality
        define.howToGet(PAPER).from(QUALITY)
            .provided(x => x.get(QUALITY) === 'high')
            .as(async x => 'premium paper');

        // Provider 2: for low quality
        define.howToGet(PAPER).from(QUALITY)
            .provided(x => x.get(QUALITY) === 'low')
            .as(async x => 'standard paper');

        const obtain = registry.getObtainAPI();

        const highQuality = await obtain(PAPER, { [QUALITY]: 'high' });
        expect(highQuality).toBe('premium paper');

        const lowQuality = await obtain(PAPER, { [QUALITY]: 'low' });
        expect(lowQuality).toBe('standard paper');

        // Should fail when no predicate matches
        await expect(obtain(PAPER, { [QUALITY]: 'medium' }))
            .rejects.toThrow('no applicable');
    });

    it('should handle context merging in nested calls', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const WATER = Symbol('WATER');
        const CHEMICALS = Symbol('CHEMICALS');
        const TREATED_PULP = Symbol('TREATED_PULP');

        define.howToGet(TREATED_PULP).from(WATER, CHEMICALS).as(async x => {
            const water = x.get(WATER);
            const chemicals = x.get(CHEMICALS);
            return `treated pulp using ${water} and ${chemicals}`;
        });

        const obtain = registry.getObtainAPI();

        const result = await obtain(TREATED_PULP, {
            [WATER]: 'filtered water',
            [CHEMICALS]: 'bleaching agents',
        });

        expect(result).toBe('treated pulp using filtered water and bleaching agents');
    });

    it('should pass context through calls to .obtain()', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const WATER = Symbol('WATER');
        const CHEMICALS = Symbol('CHEMICALS');
        const TREATED_PULP = Symbol('TREATED_PULP');
        
        define.howToGet(WATER).from(CHEMICALS).as(async x => {
            return `suspicious water`;
        })

        define.howToGet(TREATED_PULP).from(CHEMICALS).as(async x => {
            const water = await x.obtain(WATER);
            const chemicals = x.get(CHEMICALS);
            return `treated pulp using ${water} and ${chemicals}`;
        });

        const obtain = registry.getObtainAPI();

        const result = await obtain(TREATED_PULP, {
            [CHEMICALS]: 'bleaching agents',
        });

        expect(result).toBe('treated pulp using suspicious water and bleaching agents');
    });

    it('should allow obtaining or getting non-specified values', async () => {
        const registry = new Registry();
        const define = registry.getDefineAPI();

        const BURGER = Symbol('BURGER');
        const BURGER_STUFF = Symbol('BURGER_STUFF');
        const BURGER_BUNS = Symbol('BURGER_BUNS');
        
        define.howToGet(BURGER).as(async x => {
            const stuff = x.get(BURGER_STUFF);
            const buns = await x.obtain(BURGER_BUNS);
            
            return `burger with ${stuff} between two ${buns}`
        })

        const obtain = registry.getObtainAPI();

        const result = await obtain(BURGER, {
            [BURGER_BUNS]: 'multigrain buns',
            [BURGER_STUFF]: 'the works',
        });

        expect(result).toBe('burger with the works between two multigrain buns');
    });
});