// import crypto from 'node:crypto'
const crypto = require("node:crypto");

function sha1(input) {
    return crypto.createHash('sha1').update(input, 'utf8').digest().toString("hex").slice(0, 7)
}
function calculateWorkerName(username, workerId) {
    return `${username}-${sha1(workerId).slice(0, 7)}`
}

module.exports = {
    sha1,
    calculateWorkerName
}