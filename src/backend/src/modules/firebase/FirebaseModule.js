const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config");

class FirebaseModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        if ( !! config?.services?.['firebase-auth']) {
            const { FirebaseAuthService } = require("./FirebaseAuthService");
            services.registerService('firebase-auth', FirebaseAuthService);
        }
    }
}

module.exports = {
    FirebaseModule,
};
