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
import { InitProcess, Service } from "../definitions.js";

// The NULL UUID is also the UUID for the init process.
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

export class ProcessService extends Service {
    static INITRC = [
        // 'puter-linux'
    ];

    async _init () {
        this.processes = [];
        this.processes_map = new Map();
        this.uuid_to_treelist = new Map();

        const root = new InitProcess({
            uuid: NULL_UUID,
        });
        this.register_(root);
    }

    ['__on_gui:ready'] () {
        const svc_exec = this.services.get('exec');
        for ( let spec of ProcessService.INITRC ) {
            if ( typeof spec === 'string' ) {
                spec = { name: spec };
            }

            svc_exec.launchApp({
                app_name: spec.name,
            });
        }
    }

    get_init () {
        return this.processes_map.get(NULL_UUID);
    }

    get_by_uuid (uuid) {
        return this.processes_map.get(uuid);
    }

    get_children_of (uuid) {
        if ( ! uuid ) {
            uuid = NULL_UUID;
        }

        return this.uuid_to_treelist.get(uuid);
    }

    select_by_name (name) {
        // TODO: figure out why 'this.processes' doesn't work here
        const processes = Array.from(this.processes_map.values())

        const list = [];
        for ( const process of processes ) {
            if ( process.name === name ) {
                list.push(process);
            }
        }
        return list;
    }

    register (process) {
        this.register_(process);
        this.attach_to_parent_(process);
    }

    register_ (process) {
        this.processes.push(process);
        this.processes_map.set(process.uuid, process);
        this.uuid_to_treelist.set(process.uuid, []);
    }

    attach_to_parent_ (process) {
        process.parent = process.parent ?? NULL_UUID;
        const parent_list = this.uuid_to_treelist.get(process.parent);
        parent_list.push(process);
    }

    unregister (uuid) {
        const process = this.processes_map.get(uuid);
        if ( ! process ) {
            throw new Error(`Process with uuid ${uuid} not found`);
        }

        this.processes_map.delete(uuid);
        this.processes.splice(this.processes.indexOf(process), 1);

        const parent_list = this.uuid_to_treelist.get(process.parent);
        parent_list.splice(parent_list.indexOf(process), 1);

        const children = this.uuid_to_treelist.get(process.uuid);

        delete this.uuid_to_treelist[process.uuid];
        this.processes.splice(this.processes.indexOf(process), 1);

        // Transfer children to init process
        for ( const child of children ) {
            child.parent = NULL_UUID;
            this.attach_to_parent_(child);
        }
    }
}
