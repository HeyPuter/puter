const eggspress = require("../api/eggspress");

const Endpoint = function Endpoint (spec) {
    return {
        attach (route) {
            const eggspress_options = {
                allowedMethods: spec.methods ?? ['GET'],
                ...(spec.mw ? { mw: spec.mw } : {}),
            };
            const eggspress_router = eggspress(
                spec.route,
                eggspress_options,
                spec.handler,
            );
            route.use(eggspress_router);
        }
    };
}

module.exports = {
    Endpoint,
};
