const eggspress = require("../../api/eggspress");
const { deleteUser, invalidate_cached_user } = require("../../helpers");

const config = require("../../config");

module.exports = eggspress("/delete-own-user", {
    subdomain: "api",
    auth: true,
    allowedMethods: ["POST"],
}, async (req, res, next) => {
    const bcrypt = require('bcrypt');

    const validate_request = async () => {
        const user = req.user;

        // `user` should always have a value, but this is checked
        // any way in case the auth middleware is broken.
        if ( ! user ) return false;

        // temporary users don't require password verification
        if ( ! user.email && ! user.password ) {
            return true;
        }

        if ( ! req.body.password ) return false;
        if ( ! user || ! user.password ) return false;
        if ( ! await bcrypt.compare(req.body.password, req.user.password) ) {
            return false;
        }
        return true;
    }

    if ( ! await validate_request() ) {
        return res.status(400).send({ success: false });
    }

    res.clearCookie(config.cookie_name);

    await deleteUser(req.user.id);
    invalidate_cached_user(req.user);

    return res.send({ success: true });
});
