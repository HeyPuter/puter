// This sucks, but the concept is simple...

// When debugging memory leaks, sometimes plain objects (rather than instances
// of classes) are the culprit. However, theses are very difficult to identify
// in heap snapshots using the Memory tab in Chromium dev tools.

// These annotated classes provide a solution to wrap plain objects.


class AnnotatedObject {
    constructor (o) {
        for ( const k in o ) this[k] = o[k];
    }
}

class object_returned_by_get_app extends AnnotatedObject {};

module.exports = {
    object_returned_by_get_app,
};
