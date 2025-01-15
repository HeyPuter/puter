const BaseService = require("./BaseService");

class RequestMeasureService extends BaseService {
    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        const svc_event = this.services.get('event');
        app.use(async (req, res, next) => {
            next();
            const measurements = await req.measurements;
            await svc_event.emit('request.measured', {
                measurements,
                req, res,
                ...(req.actor ? { actor: req.actor } : {}),
            });
        });
    }
    _init () {
        //
    }
}

module.exports = {
    RequestMeasureService,
};
