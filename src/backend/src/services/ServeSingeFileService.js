const BaseService = require("./BaseService");

class ServeSingleFileService extends BaseService {
    async _init (args) {
        this.route = args.route;
        this.path = args.path;
    }
    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');
        
        app.get(this.route, (req, res) => {
            return res.sendFile(this.path);
        });
    }
}

module.exports =  {
    ServeSingleFileService,
};
