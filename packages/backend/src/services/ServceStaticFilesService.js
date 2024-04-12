const BaseService = require("./BaseService");

class ServeStaticFilesService extends BaseService {
    async _init (args) {
        this.directories = args.directories;
    }

    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');

        for ( const { prefix, path } of this.directories ) {
            app.use(prefix, require('express').static(path));
        }
    }
}

module.exports = ServeStaticFilesService;
