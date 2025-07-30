// import crypto from 'node:crypto'
const crypto = require("node:crypto");

function sha1(input) {
    return crypto.createHash('sha1').update(input, 'utf8').digest().toString("hex").slice(0, 7)
}

function calculateWorkerNameNew(uuid, workerId) {

    return `${workerId}`; // Used to be ${workerId}-${uuid.replaceAll("-", "")}
}
module.exports = {
    sha1,
    calculateWorkerNameNew
}