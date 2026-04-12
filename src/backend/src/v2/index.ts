
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { puterDrivers } from './drivers';
import { PuterServer } from './server';
import { puterServices } from './services';
import { puterStores } from './stores';

// if called directly, start the server
if ( require.main === module ) {
    const server = new PuterServer({ extensions: [], port: 1 }, puterClients, puterStores, puterServices, puterControllers, puterDrivers);
    server.start();
    // listen for shutdown signals to gracefully stop the server
    const shutDownProcess = async () => {
        await server.prepareShutdown();
        setTimeout( async () => {
            await server.shutdown();
            process.exit(0);
        }, 1000 * 90);
    };
    process.on('SIGINT', shutDownProcess);
    process.on('SIGTERM', shutDownProcess);
}