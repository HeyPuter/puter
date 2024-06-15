const APIError = require("../../api/APIError");
const { BaseES } = require("./BaseES");

class ReadOnlyES extends BaseES {
    async upsert () {
        throw APIError.create('forbidden');
    }
    async delete () {
        throw APIError.create('forbidden');
    }
}

module.exports = ReadOnlyES;
