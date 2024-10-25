const APIError = require("../api/APIError");

const anticsrf = options => async (req, res, next) => {
    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! req.body.anti_csrf ) {
        const err = APIError.create('anti-csrf-incorrect');
        err.write(res);
        return;
    }
    const has = svc_antiCSRF.consume_token(req.user.uuid, req.body.anti_csrf);
    if ( ! has ) {
        const err = APIError.create('anti-csrf-incorrect');
        err.write(res);
        return;
    }
    
    next();
};

module.exports = anticsrf;
