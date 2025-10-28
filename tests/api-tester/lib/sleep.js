module.exports = async function sleep (ms) {
    await new Promise(rslv => {
        setTimeout(rslv, ms);
    })
}
