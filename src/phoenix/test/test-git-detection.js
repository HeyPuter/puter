/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import assert from 'assert';

// Function to test
async function hasGitDirectory(items) {
    // Case 1: Single Puter path
    if (typeof items === 'string' && (items.startsWith('/') || items.startsWith('~'))) {
        const stat = await global.puter.fs.stat(items);
        if (stat.is_dir) {
            const files = await global.puter.fs.readdir(items);
            return files.some(file => file.name === '.git' && file.is_dir);
        }
        return false;
    }
    
    // Case 2: Array of Puter items
    if (Array.isArray(items) && items[0]?.uid) {
        return items.some(item => item.name === '.git' && item.is_dir);
    }
    
    // Case 3: Local items (DataTransferItems)
    if (Array.isArray(items)) {
        for (let item of items) {
            if (item.fullPath?.includes('/.git/') || 
                item.path?.includes('/.git/') || 
                item.filepath?.includes('/.git/')) {
                return true;
            }
        }
    }
    
    return false;
}

describe('hasGitDirectory', () => {
    // Mock puter.fs for testing
    const mockPuterFS = {
        stat: async (path) => ({
            is_dir: path.endsWith('dir')
        }),
        readdir: async (path) => {
            if (path === '/path/to/git/dir') {
                return [
                    { name: '.git', is_dir: true },
                    { name: 'src', is_dir: true }
                ];
            }
            return [
                { name: 'src', is_dir: true },
                { name: 'test', is_dir: true }
            ];
        }
    };

    beforeEach(() => {
        // Set up global puter object before each test
        global.puter = { fs: mockPuterFS };
    });

    afterEach(() => {
        // Clean up global puter object after each test
        delete global.puter;
    });

    describe('Case 1: Single Puter path', () => {
        it('should return true for directory containing .git', async () => {
            const result = await hasGitDirectory('/path/to/git/dir');
            assert.strictEqual(result, true);
        });

        it('should return false for directory without .git', async () => {
            const result = await hasGitDirectory('/path/to/normal/dir');
            assert.strictEqual(result, false);
        });

        it('should return false for non-directory path', async () => {
            const result = await hasGitDirectory('/path/to/file');
            assert.strictEqual(result, false);
        });
    });

    describe('Case 2: Array of Puter items', () => {
        it('should return true when .git directory is present', async () => {
            const items = [
                { uid: '1', name: 'src', is_dir: true },
                { uid: '2', name: '.git', is_dir: true },
                { uid: '3', name: 'test', is_dir: true }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, true);
        });

        it('should return false when no .git directory is present', async () => {
            const items = [
                { uid: '1', name: 'src', is_dir: true },
                { uid: '2', name: 'test', is_dir: true }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, false);
        });
    });

    describe('Case 3: Local items (DataTransferItems)', () => {
        it('should return true when path contains .git directory', async () => {
            const items = [
                { fullPath: '/project/.git/config' },
                { fullPath: '/project/src/index.js' }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, true);
        });

        it('should return true when using alternative path properties', async () => {
            const items = [
                { path: '/project/.git/config' },
                { filepath: '/project/src/index.js' }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, true);
        });

        it('should return false when no .git directory is present', async () => {
            const items = [
                { fullPath: '/project/src/index.js' },
                { fullPath: '/project/test/test.js' }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, false);
        });
    });

    describe('Edge cases', () => {
        it('should handle empty array input', async () => {
            const result = await hasGitDirectory([]);
            assert.strictEqual(result, false);
        });

        it('should handle invalid input', async () => {
            const result = await hasGitDirectory(null);
            assert.strictEqual(result, false);
        });

        it('should handle mixed path formats', async () => {
            const items = [
                { fullPath: '/project/src/index.js' },
                { path: '/project/.git/config' },
                { filepath: '/project/test/test.js' }
            ];
            const result = await hasGitDirectory(items);
            assert.strictEqual(result, true);
        });
    });
});


