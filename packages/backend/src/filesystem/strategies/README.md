## Puter Filesystem Strategies

Each subdirectory is named in the format `<concern>_<class>`,
where `<concern>` specifies broadly what that strategies contained within
the directory are concerned with (storage, fsentry, etc), and `<class>`
is a letter from A-Z indicating the layer/level of concern.

The class **A** indicates that this is the highest level of swappable
behaviour, which generally means there will be two strategies:
- one which supports legacy behaviour that is coupled with multiple concerns
- one which adapts more cohesive strategies to an interface which
  supports the case above.
