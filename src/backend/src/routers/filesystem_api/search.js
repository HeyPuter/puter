const eggspress = require("../../api/eggspress");
const { HLNameSearch } = require("../../filesystem/hl_operations/hl_name_search");

module.exports = eggspress('/search', {
    subdomain: 'api',
    auth2: true,
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const hl_name_search = new HLNameSearch();
    const result = await hl_name_search.run({
        actor: req.actor,
        term: req.body.text,
    });
    res.send(result);
});
