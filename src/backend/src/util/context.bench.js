/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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

import { bench, describe } from 'vitest';
import { Context } from './context.js';

describe('Context - Creation', () => {
    bench('create empty context', () => {
        Context.create({});
    });

    bench('create context with single value', () => {
        Context.create({ user: 'testuser' });
    });

    bench('create context with multiple values', () => {
        Context.create({
            user: 'testuser',
            requestId: '12345',
            timestamp: Date.now(),
            metadata: { key: 'value' },
        });
    });

    bench('create 100 contexts', () => {
        for ( let i = 0; i < 100; i++ ) {
            Context.create({ index: i });
        }
    });
});

describe('Context - Sub-context creation', () => {
    const parentContext = Context.create({ parent: 'value' });

    bench('create sub-context (empty)', () => {
        parentContext.sub({});
    });

    bench('create sub-context with values', () => {
        parentContext.sub({ child: 'childValue' });
    });

    bench('create sub-context with name', () => {
        parentContext.sub({}, 'named-context');
    });

    bench('create deeply nested sub-contexts (5 levels)', () => {
        let ctx = parentContext;
        for ( let i = 0; i < 5; i++ ) {
            ctx = ctx.sub({ level: i });
        }
    });

    bench('create deeply nested sub-contexts (10 levels)', () => {
        let ctx = parentContext;
        for ( let i = 0; i < 10; i++ ) {
            ctx = ctx.sub({ level: i });
        }
    });
});

describe('Context - Get/Set operations', () => {
    const ctx = Context.create({
        key1: 'value1',
        key2: 'value2',
        key3: { nested: 'object' },
    });

    bench('get existing key', () => {
        ctx.get('key1');
    });

    bench('get non-existing key', () => {
        ctx.get('nonexistent');
    });

    bench('get nested object', () => {
        ctx.get('key3');
    });

    bench('set new value', () => {
        ctx.set('dynamic', Math.random());
    });

    bench('get/set cycle (100 operations)', () => {
        for ( let i = 0; i < 100; i++ ) {
            ctx.set(`key_${i}`, i);
            ctx.get(`key_${i}`);
        }
    });
});

describe('Context - Prototype chain lookup', () => {
    // Create a deep context chain
    let deepCtx = Context.create({ root: 'rootValue' });
    for ( let i = 0; i < 10; i++ ) {
        deepCtx = deepCtx.sub({ [`level${i}`]: `value${i}` });
    }

    bench('get value from root (10 levels up)', () => {
        deepCtx.get('root');
    });

    bench('get value from middle (5 levels up)', () => {
        deepCtx.get('level5');
    });

    bench('get value from current level', () => {
        deepCtx.get('level9');
    });
});

describe('Context - arun async execution', () => {
    const ctx = Context.create({ test: 'value' });

    bench('arun with simple callback', async () => {
        await ctx.arun(async () => {
            return 'result';
        });
    });

    bench('arun with Context.get inside', async () => {
        await ctx.arun(async () => {
            Context.get('test');
            return 'result';
        });
    });

    bench('nested arun calls (3 levels)', async () => {
        await ctx.arun(async () => {
            const subCtx = Context.get().sub({ level: 1 });
            await subCtx.arun(async () => {
                const subSubCtx = Context.get().sub({ level: 2 });
                await subSubCtx.arun(async () => {
                    return Context.get('level');
                });
            });
        });
    });
});

describe('Context - abind', () => {
    const ctx = Context.create({ bound: 'value' });

    bench('create bound function', () => {
        ctx.abind(() => 'result');
    });

    bench('execute bound function', async () => {
        const boundFn = ctx.abind(async () => Context.get('bound'));
        await boundFn();
    });
});

describe('Context - describe/debug', () => {
    const ctx = Context.create({ test: 'value' }, 'test-context');
    const deepCtx = ctx.sub({ level: 1 }, 'sub1').sub({ level: 2 }, 'sub2');

    bench('describe shallow context', () => {
        ctx.describe();
    });

    bench('describe deep context', () => {
        deepCtx.describe();
    });
});

describe('Context - unlink (memory cleanup)', () => {
    bench('create and unlink context', () => {
        const ctx = Context.create({
            user: 'test',
            data: { large: 'object' },
        });
        ctx.unlink();
    });
});

describe('Context - Real-world simulation', () => {
    bench('HTTP request context lifecycle', async () => {
        // Simulate creating a context for an HTTP request
        const reqCtx = Context.create({
            req: { method: 'GET', path: '/api/test' },
            res: {},
            trace_request: 'uuid-here',
        }, 'req');

        await reqCtx.arun(async () => {
            // Simulate middleware adding data
            const ctx = Context.get();
            ctx.set('user', { id: 1, name: 'test' });

            // Simulate sub-operation
            const opCtx = ctx.sub({ operation: 'readFile' });
            await opCtx.arun(async () => {
                Context.get('user');
                Context.get('operation');
            });
        });
    });
});
