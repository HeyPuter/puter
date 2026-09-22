import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
    spawn: vi.fn(() => ({})),
}));

import { spawn } from 'node:child_process';
import { npmCommand, npmSpawnOptions, spawnNpm } from './npmSpawn.mjs';

describe('npmCommand', () => {
    it('uses npm.cmd on Windows', () => {
        expect(npmCommand('win32')).toBe('npm.cmd');
    });

    it('uses npm on POSIX platforms', () => {
        expect(npmCommand('linux')).toBe('npm');
        expect(npmCommand('darwin')).toBe('npm');
    });
});

describe('npmSpawnOptions', () => {
    it('enables a shell on Windows so npm.cmd does not throw EINVAL', () => {
        expect(
            npmSpawnOptions({ cwd: '.', stdio: 'inherit' }, 'win32'),
        ).toEqual({
            cwd: '.',
            stdio: 'inherit',
            shell: true,
        });
    });

    it('spawns npm directly without a shell on POSIX', () => {
        expect(npmSpawnOptions({ cwd: '.' }, 'linux')).toEqual({ cwd: '.' });
    });
});

describe('spawnNpm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('spawns npm.cmd through a shell when running on Windows', () => {
        vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
        spawnNpm(['ci'], { cwd: '.' });
        expect(spawn).toHaveBeenCalledWith('npm.cmd', ['ci'], {
            cwd: '.',
            shell: true,
        });
    });

    it('spawns npm directly when not running on Windows', () => {
        vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
        spawnNpm(['install'], { cwd: '.' });
        expect(spawn).toHaveBeenCalledWith('npm', ['install'], { cwd: '.' });
    });
});
