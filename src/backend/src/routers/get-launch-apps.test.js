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

const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const kvjs = require('@heyputer/kv.js');
const uuid = require('uuid');

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
            uid: 'app-' + uuid.v5(name, TEST_UUID_NAMESPACE),
            name,
            title: 'App Name',
            icon: 'icon-goes-here',
            godmode: false,
            maximize_on_start: false,
            index_url: 'index-url'
        });
    }

    // An additional app that won't show up in taskbar
    data_mockapps.push({
        uid: 'app-' + uuid.v5('hidden-app', TEST_UUID_NAMESPACE),
        name: 'hidden-app',
        title: 'Hidden App',
        icon: 'icon-goes-here',
        godmode: false,
        maximize_on_start: false,
        index_url: 'index-url'
    });

    // An additional app tha only shows up in recents
    data_mockapps.push({
        uid: 'app-' + uuid.v5('recent-app', TEST_UUID_NAMESPACE),
        name: 'recent-app',
        title: 'Recent App',
        icon: 'icon-goes-here',
        godmode: false,
        maximize_on_start: false,
        index_url: 'index-url'
    });

    return data_mockapps;
})();

const data_appopens = [
    {
        app_uid: 'app-' + uuid.v5('app-center', TEST_UUID_NAMESPACE),
    },
    {
        app_uid: 'app-' + uuid.v5('editor', TEST_UUID_NAMESPACE),
    },
    {
        app_uid: 'app-' + uuid.v5('recent-app', TEST_UUID_NAMESPACE),
    },
];

const get_mock_context = () => {
    const database_mock = {
        read: async (query) => {
            if ( query.includes('FROM app_opens') ) {
                return data_appopens;
            }
        }
    };
    const services_mock = {
        get: (key) => {
            if (key === 'database') {
                return {
                    get: () => database_mock,
                }
            }
        }
    };

    const req_mock = {
        user: {
            id: 1 + Math.floor(Math.random() * 1000**3),
        },
        services: services_mock,
        send: sinon.spy(),
    };

    const res_mock = {
        send: sinon.spy(),
    };

    const get_app = sinon.spy(async ({ uid, name }) => {
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
        }
    });

    return {
        get_launch_apps, req_mock, res_mock,
        spies: {
            get_app,
        }
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

            expect(res_mock.send.calledOnce).to.equal(true, 'res.send should be called once');

            const call = res_mock.send.firstCall;
            response = call.args[0];
            console.log('response', response);
        
            expect(response).to.be.an('object');

            expect(response).to.have.property('recommended');
            expect(response.recommended).to.be.an('array');
            expect(response.recommended).to.have.lengthOf(apps_names_expected_to_exist.length);
            expect(response.recommended).to.deep.equal(
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
                    }))
            );

            expect(response).to.have.property('recent');
            expect(response.recent).to.be.an('array');
            expect(response.recent).to.have.lengthOf(data_appopens.length);
            expect(response.recent).to.deep.equal(
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
                    }))
            );

            // << HOW TO FIX >>
            // If you updated the list of recommended apps,
            // you can simply update this number to match the new length
            expect(spies.get_app.callCount).to.equal(26);
        }
        
        // Second call
        {
            const { get_launch_apps, req_mock, res_mock, spies } = get_mock_context();
            req_mock.query = {};
            await get_launch_apps(req_mock, res_mock);

            expect(res_mock.send.calledOnce).to.equal(true, 'res.send should be called once');

            const call = res_mock.send.firstCall;
            response = call.args[0];
        
            expect(response).to.be.an('object');

            expect(response).to.have.property('recommended');
            expect(response.recommended).to.be.an('array');
            expect(response.recommended).to.have.lengthOf(apps_names_expected_to_exist.length);
            expect(response.recommended).to.deep.equal(
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
                    }))
            );

            expect(response).to.have.property('recent');
            expect(response.recent).to.be.an('array');
            expect(response.recent).to.have.lengthOf(data_appopens.length);
            expect(response.recent).to.deep.equal(
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
                    }))
            );
            
            expect(spies.get_app.callCount).to.equal(
                data_appopens.length, 'get_app only called for recents on second call');
        }
    })
});