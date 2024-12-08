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
import { JSDOM } from 'jsdom';

// Function to test
async function showGitWarningDialog() {
    try {
        // Check if the user has chosen to skip the warning
        const skipWarning = await global.puter.kv.get('skip-git-warning');

        // Log retrieved value for debugging
        console.log('Retrieved skip-git-warning:', skipWarning);

        // If the user opted to skip the warning, proceed without showing it
        if (skipWarning === true) {
            return true;
        }
    } catch (error) {
        console.error('Error accessing KV store:', error);
        // If KV store access fails, fall back to showing the dialog
    }

    // Create the modal dialog
    const modal = document.createElement('div');
    modal.innerHTML = `
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); z-index: 10000;">
            <h3 style="margin-top: 0;">Warning: Git Repository Detected</h3>
            <p>A .git directory was found in your deployment files. Deploying .git directories may:</p>
            <ul>
                <li>Expose sensitive information like commit history and configuration</li>
                <li>Significantly increase deployment size</li>
            </ul>
            <div style="margin-top: 15px; display: flex; align-items: center;">
                <input type="checkbox" id="skip-git-warning" style="margin-right: 10px;">
                <label for="skip-git-warning" style="margin-top:0;">Don't show this warning again</label>
            </div>
            <div style="margin-top: 15px; display: flex; justify-content: flex-end;">
                <button id="cancel-deployment" style="margin-right: 10px; padding: 10px 15px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="continue-deployment" style="padding: 10px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Continue Deployment</button>
            </div>
        </div>
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 9999;"></div>
    `;
    document.body.appendChild(modal);

    return new Promise((resolve) => {
        // Handle "Continue Deployment"
        document.getElementById('continue-deployment').addEventListener('click', async () => {
            try {
                const skipChecked = document.getElementById('skip-git-warning')?.checked;
                if (skipChecked) {
                    console.log("Saving 'skip-git-warning' preference as true");
                    await global.puter.kv.set('skip-git-warning', true);
                }
            } catch (error) {
                console.error('Error saving user preference to KV store:', error);
            } finally {
                document.body.removeChild(modal);
                resolve(true); // Continue deployment
            }
        });

        // Handle "Cancel Deployment"
        document.getElementById('cancel-deployment').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false); // Cancel deployment
        });
    });
}

describe('showGitWarningDialog', () => {
    let dom;
    let consoleLogs = [];
    let consoleErrors = [];

    // Mock console methods
    const mockConsole = {
        log: (msg) => consoleLogs.push(msg),
        error: (msg) => consoleErrors.push(msg)
    };

    // Mock puter.kv
    const mockPuterKV = {
        get: async () => false,
        set: async () => {}
    };

    beforeEach(() => {
        // Set up JSDOM with all required features
        dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
            url: 'http://localhost',
            runScripts: 'dangerously',
            resources: 'usable',
            pretendToBeVisual: true
        });
        
        // Set up global objects
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.Element = dom.window.Element;
        global.Node = dom.window.Node;
        global.navigator = dom.window.navigator;
        global.console = { ...console, ...mockConsole };
        global.puter = { kv: mockPuterKV };

        // Reset console logs
        consoleLogs = [];
        consoleErrors = [];
    });

    afterEach(() => {
        // Clean up
        dom.window.document.body.innerHTML = '';
    });

    describe('Skip Warning Behavior', () => {
        it('should skip dialog if warning is disabled', async () => {
            global.puter.kv.get = async () => true;
            
            const result = await showGitWarningDialog();
            
            assert.strictEqual(result, true);
            assert.strictEqual(dom.window.document.body.children.length, 0);
            assert.ok(consoleLogs.some(log => log.includes('Retrieved skip-git-warning')));
        });

        it('should show dialog if warning is not disabled', async () => {
            global.puter.kv.get = async () => false;
            
            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Check if dialog is shown
            assert.strictEqual(dom.window.document.body.children.length, 1);
            assert.ok(dom.window.document.querySelector('h3').textContent.includes('Git Repository Detected'));
            
            // Simulate clicking "Cancel" to resolve the promise
            dom.window.document.getElementById('cancel-deployment').click();
            const result = await dialogPromise;
            assert.strictEqual(result, false);
        });

        it('should handle KV store error gracefully', async () => {
            global.puter.kv.get = async () => {
                throw new Error('KV store error');
            };
            
            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Check if dialog is shown
            assert.strictEqual(dom.window.document.body.children.length, 1);
            assert.ok(consoleErrors.some(error => error.includes('Error accessing KV store')));
            
            // Cleanup
            dom.window.document.getElementById('cancel-deployment').click();
            await dialogPromise;
        });
    });

    describe('User Interaction', () => {
        it('should save preference when checkbox is checked', async () => {
            let kvSetCalled = false;
            global.puter.kv.set = async (key, value) => {
                assert.strictEqual(key, 'skip-git-warning');
                assert.strictEqual(value, true);
                kvSetCalled = true;
            };

            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            const checkbox = dom.window.document.getElementById('skip-git-warning');
            checkbox.checked = true;
            
            dom.window.document.getElementById('continue-deployment').click();
            const result = await dialogPromise;
            
            assert.strictEqual(result, true);
            assert.ok(kvSetCalled);
            assert.ok(consoleLogs.some(log => log.includes("Saving 'skip-git-warning' preference")));
        });

        it('should not save preference when checkbox is unchecked', async () => {
            let kvSetCalled = false;
            global.puter.kv.set = async () => {
                kvSetCalled = true;
            };

            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            dom.window.document.getElementById('continue-deployment').click();
            await dialogPromise;
            
            assert.strictEqual(kvSetCalled, false);
        });

        it('should handle KV set error gracefully', async () => {
            global.puter.kv.set = async () => {
                throw new Error('KV set error');
            };

            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            const checkbox = dom.window.document.getElementById('skip-git-warning');
            checkbox.checked = true;
            
            dom.window.document.getElementById('continue-deployment').click();
            const result = await dialogPromise;
            
            assert.strictEqual(result, true);
            assert.ok(consoleErrors.some(error => error.includes('Error saving user preference')));
        });
    });

    describe('Dialog UI', () => {
        it('should create dialog with all required elements', async () => {
            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            assert.ok(dom.window.document.querySelector('h3'));
            assert.ok(dom.window.document.querySelector('ul'));
            assert.ok(dom.window.document.getElementById('skip-git-warning'));
            assert.ok(dom.window.document.getElementById('cancel-deployment'));
            assert.ok(dom.window.document.getElementById('continue-deployment'));
            
            // Cleanup
            dom.window.document.getElementById('cancel-deployment').click();
            await dialogPromise;
        });

        it('should remove dialog after interaction', async () => {
            const dialogPromise = showGitWarningDialog();
            
            // Wait for the next tick to allow DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));
            
            assert.strictEqual(dom.window.document.body.children.length, 1);
            
            dom.window.document.getElementById('continue-deployment').click();
            await dialogPromise;
            
            assert.strictEqual(dom.window.document.body.children.length, 0);
        });
    });
});
