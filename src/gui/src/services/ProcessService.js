import { InitProcess, Service } from "../definitions.js";

// The NULL UUID is also the UUID for the init process.
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

export class ProcessService extends Service {
    async _init () {
        this.processes = [];
        this.processes_map = new Map();
        this.uuid_to_treelist = new Map();

        const root = new InitProcess({
            uuid: NULL_UUID,
        });
        this.register_(root);
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
