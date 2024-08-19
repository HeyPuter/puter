const LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];

let curr_letter_ = 0;

const ind = () => {
    let v = curr_letter_;
    curr_letter_++;
    curr_letter_ = curr_letter_ % LETTERS.length;
    return v;
};

module.exports = {
    get_a_letter: () => LETTERS[ind()],
    cylog: (...a) => {
        console.log(`\x1B[36;1m`, ...a);
    }
};
