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

import { describe, it, expect, beforeEach, vi } from 'vitest';
const kvjs = require('@heyputer/kv.js');
const uuid = require('uuid');
const proxyquire = require('proxyquire');

const TEST_UUID_NAMESPACE = '5568ab95-229d-4d87-b98c-0b12680a9524';

const apps_names_expected_to_exist = [
    'app-center',
    'dev-center',
    'editor',
];

const data_mockapps = (() => {
    const data_mockapps = [];
    // List of app names that get-launch-apps expects to exist
    for ( const name of apps_names_expected_to_exist ) {
        data_mockapps.push({
            uid: `app-${ uuid.v5(name, TEST_UUID_NAMESPACE)}`,
            name,
            title: 'App Name',
            icon: 'icon-goes-here',
            godmode: false,
            maximize_on_start: false,
            index_url: 'index-url',
        });
    }

    // An additional app that won't show up in taskbar
    data_mockapps.push({
        uid: `app-${ uuid.v5('hidden-app', TEST_UUID_NAMESPACE)}`,
        name: 'hidden-app',
        title: 'Hidden App',
        icon: 'icon-goes-here',
        godmode: false,
        maximize_on_start: false,
        index_url: 'index-url',
    });

    // An additional app tha only shows up in recents
    data_mockapps.push({
        uid: `app-${ uuid.v5('recent-app', TEST_UUID_NAMESPACE)}`,
        name: 'recent-app',
        title: 'Recent App',
        icon: 'icon-goes-here',
        godmode: false,
        maximize_on_start: false,
        index_url: 'index-url',
    });

    return data_mockapps;
})();

const data_appopens = [
    {
        app_uid: `app-${ uuid.v5('app-center', TEST_UUID_NAMESPACE)}`,
    },
    {
        app_uid: `app-${ uuid.v5('editor', TEST_UUID_NAMESPACE)}`,
    },
    {
        app_uid: `app-${ uuid.v5('recent-app', TEST_UUID_NAMESPACE)}`,
    },
];

const get_mock_context = () => {
    const database_mock = {
        read: async (query) => {
            if ( query.includes('FROM app_opens') ) {
                return data_appopens;
            }
        },
    };
    const recommendedApps_mock = {
        get_recommended_apps: async ({ icon_size }) => {
            return data_mockapps
                .filter(app => apps_names_expected_to_exist.includes(app.name))
                .map(app => ({
                    uuid: app.uid,
                    name: app.name,
                    title: app.title,
                    icon: app.icon,
                    godmode: app.godmode,
                    maximize_on_start: app.maximize_on_start,
                    index_url: app.index_url,
                }));
        },
    };
    const services_mock = {
        get: (key) => {
            if ( key === 'database' ) {
                return {
                    get: () => database_mock,
                };
            }
            if ( key === 'recommended-apps' ) {
                return recommendedApps_mock;
            }
        },
    };

    const req_mock = {
        user: {
            id: 1 + Math.floor(Math.random() * 1000 ** 3),
        },
        services: services_mock,
        send: vi.fn(),
    };

    const res_mock = {
        send: vi.fn(),
    };

    const get_app = vi.fn(async ({ uid, name }) => {
        if ( uid ) {
            return data_mockapps.find(app => app.uid === uid);
        }
        if ( name ) {
            return data_mockapps.find(app => app.name === name);
        }
    });

    const get_launch_apps = proxyquire('./get-launch-apps', {
        '../helpers.js': {
            get_app,
        },
    });

    return {
        get_launch_apps,
        req_mock,
        res_mock,
        spies: {
            get_app,
        },
    };
};

describe('GET /launch-apps', () => {
    globalThis.kv = new kvjs();

    it('should return expected format', async () => {
        // First call
        {
            const { get_launch_apps, req_mock, res_mock, spies } = get_mock_context();
            req_mock.query = {};
            await get_launch_apps(req_mock, res_mock);

            // TODO: bring this back, figure out what it's testing,
            //       document why it needs to be here (if it does)
            //       or remove it.
            if ( false ) {

                expect(res_mock.send).toHaveBeenCalledOnce();

                const call = res_mock.send.mock.calls[0];
                const response = call[0];
                console.log('response', response);

                expect(response).toBeTypeOf('object');

                expect(response).toHaveProperty('recommended');
                expect(response.recommended).toBeInstanceOf(Array);
                expect(response.recommended).toHaveLength(apps_names_expected_to_exist.length);
                expect(response.recommended).toEqual(
                                data_mockapps
                                    .filter(app => apps_names_expected_to_exist.includes(app.name))
                                    .map(app => ({
                                        uuid: app.uid,
                                        name: app.name,
                                        title: app.title,
                                        icon: app.icon,
                                        godmode: app.godmode,
                                        maximize_on_start: app.maximize_on_start,
                                        index_url: app.index_url,
                                    })));

                expect(response).toHaveProperty('recent');
                expect(response.recent).toBeInstanceOf(Array);
                expect(response.recent).toHaveLength(data_appopens.length);
                expect(response.recent).toEqual(
                                data_mockapps
                                    .filter(app => data_appopens.map(app_open => app_open.app_uid).includes(app.uid))
                                    .map(app => ({
                                        uuid: app.uid,
                                        name: app.name,
                                        title: app.title,
                                        icon: app.icon,
                                        godmode: app.godmode,
                                        maximize_on_start: app.maximize_on_start,
                                        index_url: app.index_url,
                                    })));
            }

            // << HOW TO FIX >>
            // If you updated the list of recommended apps,
            // you can simply update this number to match the new length
            // expect(spies.get_app).toHaveBeenCalledTimes(3);
        }

        // Second call
        {
            const { get_launch_apps, req_mock, res_mock, spies } = get_mock_context();
            req_mock.query = {};
            await get_launch_apps(req_mock, res_mock);

            expect(res_mock.send).toHaveBeenCalledOnce();

            const call = res_mock.send.mock.calls[0];
            const response = call[0];

            expect(response).toBeTypeOf('object');

            expect(response).toHaveProperty('recommended');
            expect(response.recommended).toBeInstanceOf(Array);
            expect(response.recommended).toHaveLength(apps_names_expected_to_exist.length);
            expect(response.recommended).toEqual(
                            data_mockapps
                                .filter(app => apps_names_expected_to_exist.includes(app.name))
                                .map(app => ({
                                    uuid: app.uid,
                                    name: app.name,
                                    title: app.title,
                                    icon: app.icon,
                                    godmode: app.godmode,
                                    maximize_on_start: app.maximize_on_start,
                                    index_url: app.index_url,
                                })));

            expect(response).toHaveProperty('recent');
            expect(response.recent).toBeInstanceOf(Array);
            expect(response.recent).toHaveLength(data_appopens.length);
            expect(response.recent).toEqual(
                            data_mockapps
                                .filter(app => data_appopens.map(app_open => app_open.app_uid).includes(app.uid))
                                .map(app => ({
                                    uuid: app.uid,
                                    name: app.name,
                                    title: app.title,
                                    icon: app.icon,
                                    godmode: app.godmode,
                                    maximize_on_start: app.maximize_on_start,
                                    index_url: app.index_url,
                                })));

            expect(spies.get_app).toHaveBeenCalledTimes(
                            data_appopens.length);
        }
    });
});