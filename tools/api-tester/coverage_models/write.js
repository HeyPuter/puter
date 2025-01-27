const CoverageModel = require("../lib/CoverageModel");

// ?? What's a coverage model ??
//
//     See  doc/cartesian.md

module.exports = new CoverageModel({
    path: {
        format: ['path', 'uid'],
    },
    name: ['default', 'specified'],
    conditions: {
        destinationIsFile: []
    },
    overwrite: [false, 'overwrite', 'dedupe_name'],
});
