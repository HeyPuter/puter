import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildId } from './buildId.js';

const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'build-id-'));
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'index.js'), 'main');
    writeFileSync(join(root, 'nested', 'util.js'), 'util');
    const stamp = new Date('2026-01-01T00:00:00Z');
    for (const file of ['index.js', 'nested/util.js'])
        utimesSync(join(root, file), stamp, stamp);
    return root;
};

describe('buildId', () => {
    it('is the same for two trees with the same files, sizes and times', () => {
        expect(buildId(tree())).toBe(buildId(tree()));
        expect(buildId(tree())).toMatch(/^[0-9a-f]{16}$/);
    });

    it('changes when a file is rewritten at another time or size', () => {
        const root = tree();
        const before = buildId(root);
        const later = new Date('2026-01-02T00:00:00Z');
        utimesSync(join(root, 'nested', 'util.js'), later, later);
        const retimed = buildId(root);
        expect(retimed).not.toBe(before);
        writeFileSync(join(root, 'nested', 'util.js'), 'util v2');
        utimesSync(join(root, 'nested', 'util.js'), later, later);
        expect(buildId(root)).not.toBe(retimed);
    });

    it('ignores node_modules', () => {
        const root = tree();
        const before = buildId(root);
        mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
        writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'dep');
        expect(buildId(root)).toBe(before);
    });

    it('is null for a tree that cannot be read', () => {
        expect(buildId(join(tmpdir(), 'build-id-missing-' + Date.now()))).toBe(
            null,
        );
    });
});
