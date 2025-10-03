//@extension priority -10000

extension.exports = {};

extension.exports.sleep = async (seconds) => {
    await new Promise(resolve => {
        setTimeout(resolve, seconds);
    });
};
