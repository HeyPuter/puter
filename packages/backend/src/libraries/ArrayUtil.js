const Library = require("../definitions/Library");

class ArrayUtil extends Library {
    /**
     * 
     * @param {*} marked_map 
     * @param {*} subject 
     */
    remove_marked_items (marked_map, subject) {
        for ( let i=0 ; i < marked_map.length ; i++ ) {
            let ii = marked_map[i];
            // track: type check
            if ( ! Number.isInteger(ii) ) {
                throw new Error(
                    'marked_map can only contain integers'
                );
            }
            // track: bounds check
            if ( ii < 0 && ii >= subject.length ) {
                throw new Error(
                    'each item in `marked_map` must be within that bounds ' +
                    'of `subject`'
                );
            }
        }

        marked_map.sort((a, b) => b - a);
        
        for ( let i=0 ; i < marked_map.length ; i++ ) {
            let ii = marked_map[i];
            subject.splice(ii, 1);
        }
        
        return subject;
    }

    _test ({ assert }) {
        // inner indices
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            //   0    1    2    3    4    5    6    7
            const marked_map = [2, 5];
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'abdegh');
        }
        // left edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0]
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'bcdefgh');
        }
        // right edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            //   0    1    2    3    4    5    6    7
            const marked_map = [7]
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'abcdefg');
        }
        // both edges
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0, 7]
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'bcdefg');
        }
    }
}

module.exports = ArrayUtil;
