import { describe, expect, it } from 'vitest';
import { npmSpawnArgs, spawnNpm } from './npmSpawn.mjs';

describe('npmSpawnArgs', () => {
    it('runs npm.cmd through a shell on Windows, with no separate args', () => {
        expect(
            npmSpawnArgs(['run', 'build:ts'], { cwd: '.' }, 'win32'),
        ).toEqual(['npm.cmd run build:ts', [], { cwd: '.', shell: true }]);
    });

    it('spawns npm directly without a shell elsewhere', () => {
        for (const platform of ['linux', 'darwin']) {
            expect(npmSpawnArgs(['ci'], { cwd: '.' }, platform)).toEqual([
                'npm',
                ['ci'],
                { cwd: '.' },
            ]);
        }
    });
});

describe('spawnNpm', () => {
    it('runs npm on the current platform', async () => {
        const child = spawnNpm(['--version']);
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        const code = await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', resolve);
        });
        expect(code).toBe(0);
        expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }, 20_000);
});
