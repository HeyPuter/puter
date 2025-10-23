#!/usr/bin/env bash

set -euo pipefail


protoc \
  -I=src/backend/src/filesystem/definitions/proto \
  --plugin=protoc-gen-ts_proto=$(npm root)/.bin/protoc-gen-ts_proto \
  --ts_proto_out=src/backend/src/filesystem/definitions/ts \
  --ts_proto_opt=esModuleInterop=true,outputServices=none,outputJsonMethods=true,useExactTypes=false,snakeToCamel=false \
  src/backend/src/filesystem/definitions/proto/fsentry.proto