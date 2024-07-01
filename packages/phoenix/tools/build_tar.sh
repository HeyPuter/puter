if [ $(basename "$(pwd)") != "phoenix" ]; then
    echo "This should be run in the dev-ansi-termial repo"
    exit 1
fi

export CONFIG_FILE='config/release.js'
npx rollup -c rollup.config.js

if [ -d ./release ]; then
    rm -rf ./release/*
fi

mkdir -p release
mkdir -p release/puter-shell

cp -r ./dist/* ./release

# cd ../dev-puter-shell
# npx rollup -c rollup.config.js
# cp -r ./dist/* ../phoenix/release/puter-shell
# cd -
