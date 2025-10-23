const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const StringParam = require("../../api/filesystem/StringParam");
const { is_valid_url } = require("../../helpers");
const { PuterFSProvider } = require("../../modules/puterfs/lib/PuterFSProvider");
const { Context } = require("../../util/context");

module.exports = eggspress('/update-fsentry-thumbnail', {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    parameters: {
        fsNode: new FSNodeParam('path'),
        thumbnail: new StringParam('thumbnail'),
    },
}, async (req, res, next) => {
    if ( ! is_valid_url(req.values.thumbnail) ) {
        throw new APIError.create('field_invalid', null, {
            key: 'thumbnail',
            expected: 'a valid URL',
            got: typeof req.values.thumbnail,
        });
    }
    
    if ( ! await req.values.fsNode.exists() ) {
        throw new APIError.create('subject_does_not_exist');
    }
    
    const svc = Context.get('services');
    
    const svc_mountpoint = svc.get('mountpoint');
    const provider =
        await svc_mountpoint.get_provider(req.values.fsNode.selector);
        
    provider.update_thumbnail({
        context: Context.get(),
        node: req.values.fsNode,
        thumbnail: req.body.thumbnail,
    });
    
    res.json({});
});
