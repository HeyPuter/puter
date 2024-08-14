const APIError = require("../api/APIError");
const { Context } = require("../util/context");

const featureflag = options => async (req, res, next) => {
    const { feature } = options;
    
    const context = Context.get();
    const services = context.get('services');
    const svc_featureFlag = services.get('feature-flag');

    if ( ! await svc_featureFlag.check({
        actor: req.actor,
    }, feature) ) {
        const e = APIError.create('forbidden');
        e.write(res);
        return;
    }

    next();
};

module.exports = featureflag;
