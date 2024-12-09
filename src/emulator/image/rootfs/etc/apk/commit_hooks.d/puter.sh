#!/bin/sh

if [ "$1" = "pre-commit" ]; then
    echo Running with puter integration
elif [ "$1" = "post-commit" ]; then
    echo Queuing puter save...
    puter-save
fi
exit 0