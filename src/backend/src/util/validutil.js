const valid_file_size = v => {
    v =  Number(v);
    if ( ! Number.isInteger(v) ) {
        return { ok: false, v };
    }
    if ( ! (v >= 0) ) {
        return { ok: false, v };
    }
    return { ok: true, v };
};

module.exports = {
    valid_file_size,
};
