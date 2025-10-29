#! /usr/bin/env python3

# test the client-replica feature
# - need browser environment (following features require browser environment: fs naive-cache, client-replica, wspush)
# - test multi-server setup
# - test change-propagation-time
# - test local read
# - test consistency

# first stage: test in the existing workspace, test single server + multiple sessions
# second stage: test from a fresh clone, test single server + multiple sessions
# third stage: test in the existing workspace, test multiple servers + multiple sessions
# fourth stage: test from a fresh clone, test multiple servers + multiple sessions

import time
import os
import json
import requests
import yaml

import cxc_toolkit

import common

ENABLE_FS_TREE_MANAGER = False
PUTER_ROOT = common.PUTER_ROOT


def init_backend_config():
    """
    TODO: replace with common.init_backend_config
    """
    # init config.json
    server_process = cxc_toolkit.exec.run_background("npm start")
    # wait 10s for the server to start
    time.sleep(10)
    server_process.terminate()

    example_config_path = f"{PUTER_ROOT}/volatile/config/config.json"
    config_path = f"{PUTER_ROOT}/volatile/config/config.json"

    # load
    with open(example_config_path, "r") as f:
        config = json.load(f)

    # update
    if ENABLE_FS_TREE_MANAGER:
        config["services"]["client-replica"] = {
            "enabled": True,
            "fs_tree_manager_url": "localhost:50052",
        }

    # write
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def init_fs_tree_manager_config():
    example_config_path = f"{PUTER_ROOT}/src/fs_tree_manager/example-config.yaml"
    config_path = f"{PUTER_ROOT}/src/fs_tree_manager/config.yaml"

    # load
    with open(example_config_path, "r") as f:
        config = yaml.safe_load(f)

    # update
    config["database"]["driver"] = "sqlite3"
    config["database"]["sqlite3"][
        "path"
    ] = f"{PUTER_ROOT}/volatile/runtime/puter-database.sqlite"

    # write
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, indent=2)

    print(f"fs-tree-manager config initialized at {config_path}")


def run():
    # =========================================================================
    # clean ports
    # =========================================================================

    # clean port 4100 for backend server
    cxc_toolkit.exec.run_command("fuser -k 4100/tcp", ignore_failure=True)

    # clean port 50052 for fs-tree-manager server
    cxc_toolkit.exec.run_command("fuser -k 50052/tcp", ignore_failure=True)

    # =========================================================================
    # config server
    # =========================================================================
    cxc_toolkit.exec.run_command("npm install")
    init_backend_config()
    admin_password = common.get_admin_password()

    # =========================================================================
    # start backend server
    # =========================================================================
    cxc_toolkit.exec.run_background(
        "npm start", work_dir=PUTER_ROOT, log_path="/tmp/backend.log"
    )
    # wait 10s for the server to start
    time.sleep(10)

    # =========================================================================
    # config client
    # =========================================================================
    token = common.get_token(admin_password)
    common.init_client_config(token)

    # =========================================================================
    # start fs-tree-manager server
    # =========================================================================
    if ENABLE_FS_TREE_MANAGER:
        init_fs_tree_manager_config()

        cxc_toolkit.exec.run_command(
            "go mod download",
            work_dir=f"{PUTER_ROOT}/src/fs_tree_manager",
        )

        cxc_toolkit.exec.run_background(
            "go run server.go",
            work_dir=f"{PUTER_ROOT}/src/fs_tree_manager",
            log_path="/tmp/fs-tree-manager.log",
        )

        # NB: "go mod download" and "go run server.go" may take a long time in github
        # action environment, I don't know why.
        time.sleep(60)

    # =========================================================================
    # run the test
    # =========================================================================
    cxc_toolkit.exec.run_command(
        "npx playwright test",
        work_dir=f"{PUTER_ROOT}/tests/playwright",
    )


if __name__ == "__main__":
    run()
