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

// Setup for the `shared-worker` vitest project, whose files run with
// `isolate: false` and so share one module graph per worker. Resets the
// process-wide state that a fresh worker would otherwise have provided.
import MockRedis from 'ioredis-mock';
import { afterAll, beforeAll, vi } from 'vitest';
import { configContainer } from './exports';
import { extensionStore } from './extensions';
// Loaded before the snapshot so anything registered at import time is part
// of the pristine state.
import './server';

type Container = unknown[] | Record<string, unknown>;

// Copies one level deeper than the container: event listener lists are
// arrays inside `events`, and registering pushes into them.
const copyContainer = (value: Container): Container =>
    Array.isArray(value)
        ? [...value]
        : Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? [...v] : v,
              ]),
          );

// This file is re-evaluated for every test file, so the pristine snapshot
// lives on globalThis, taken before the first file in the worker runs.
const SNAPSHOT_KEY = Symbol.for('puter.test.extensionStoreSnapshot');
const globals = globalThis as {
    [SNAPSHOT_KEY]?: Record<string, Container>;
};
globals[SNAPSHOT_KEY] ??= Object.fromEntries(
    Object.entries(extensionStore).map(([k, v]) => [k, copyContainer(v)]),
);

const restoreExtensionStore = () => {
    for (const [key, pristine] of Object.entries(globals[SNAPSHOT_KEY]!)) {
        // The server reads these containers by reference, so refill in place.
        const live = (extensionStore as Record<string, Container>)[key];
        const fresh = copyContainer(pristine);
        if (Array.isArray(live)) {
            live.splice(0, live.length, ...(fresh as unknown[]));
        } else {
            for (const k of Object.keys(live)) delete live[k];
            Object.assign(live, fresh);
        }
    }
};

beforeAll(async () => {
    // Every mock client shares the default host/port store, so cached rows
    // from a previous file's server would otherwise survive.
    const redis = new MockRedis();
    await redis.flushall();
    redis.disconnect();

    for (const key of Object.keys(configContainer)) {
        delete (configContainer as unknown as Record<string, unknown>)[key];
    }
    restoreExtensionStore();
});

afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});
