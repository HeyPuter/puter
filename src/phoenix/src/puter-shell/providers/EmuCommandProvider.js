import { Exit } from "../coreutils/coreutil_lib/exit";

export class EmuCommandProvider {
    static AVAILABLE = [
        'bash',
        'htop',
    ];

    static EMU_APP_NAME = 'test-emu';

    constructor () {
        this.available = this.constructor.AVAILABLE;
        this.emulator = null;
    }

    async aquire_emulator () {
        if ( this.emulator ) return this.emulator;

        // FUTURE: when we have a way to query instances
        // without exposing the real instance id
        /*
        const instances = await puter.ui.queryInstances();
        if ( instances.length < 0 ) {
            return;
        }
        const instance = instances[0];
        */

        const conn = await puter.ui.connectToInstance(this.constructor.EMU_APP_NAME);
        return this.emulator = conn;
    }

    async lookup (id, { ctx }) {
        if ( ! this.available.includes(id) ) {
            return;
        }

        const emu = await this.aquire_emulator();
        if ( ! emu ) {
            ctx.externs.out.write('No emulator available.\n');
            return new Exit(1);
        }

        ctx.externs.out.write(`Launching ${id} in emulator ${emu.appInstanceID}\n`);
    }
}
