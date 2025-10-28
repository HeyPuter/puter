const CoverageModel = require("../lib/CoverageModel");

module.exports = new CoverageModel({
    source: {
        format: ['path', 'uid'],
    },
    destination: {
        format: ['path', 'uid'],
    },
    name: ['default', 'specified'],
    conditions: {
        destinationIsFile: []
    },
    overwrite: [false, 'overwrite', 'dedupe_name']
});
