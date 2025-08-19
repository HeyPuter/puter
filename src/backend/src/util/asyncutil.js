const sleep = async ms => {
    await new Promise(rslv => setTimeout(rslv, ms));
}

const atimeout = async (ms, p) => {
    return await Promise.race([
        p,
        new Promise(async (rslv, rjct) => {
            await sleep(ms);
            rjct("timeout");
        }),
    ])
};

module.exports = {
    sleep,
    atimeout,
};
