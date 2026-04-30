#~!/bin/bash
# iterate through each folder in extensions/ if they contain a package.json, run npm install
for d in ./extensions/*/ ; do
    if [ -f "$d/package.json" ]; then
        echo "Installing dependencies for $d"
        (cd "$d" && npm install)
    fi
done