const { AdvancedBase } = require("@heyputer/putility");

class Core2Module extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');
        useapi.def('std', require('./lib/__lib__.js'), { assign: true });
        
        // === SERVICES === //
        // const services = context.get('services');
    }
}

module.exports = {
    Core2Module,
};
