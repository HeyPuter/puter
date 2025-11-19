#! /usr/bin/env python3
#
# Usage:
# ./tools/api-tester/ci/run.py

import time
import os
import json
import requests
import yaml

import cxc_toolkit

import common


def update_server_config():
    # Load the config file
    config_file = f"{os.getcwd()}/volatile/config/config.json"

    with open(config_file, "r") as f:
        config = json.load(f)

    # Ensure services and mountpoint sections exist
    if "services" not in config:
        config["services"] = {}
    if "mountpoint" not in config["services"]:
        config["services"]["mountpoint"] = {}
    if "mountpoints" not in config["services"]["mountpoint"]:
        config["services"]["mountpoint"]["mountpoints"] = {}

    # Add the mountpoint configuration
    mountpoint_config = {
        "/": {"mounter": "puterfs"},
        # "/admin/tmp": {"mounter": "memoryfs"},
    }

    # Merge mountpoints (overwrite existing ones)
    config["services"]["mountpoint"]["mountpoints"].update(mountpoint_config)

    # Write the updated config back
    with open(config_file, "w") as f:
        json.dump(config, f, indent=2)


def run():
    # =========================================================================
    # free the port 4100
    # =========================================================================
    cxc_toolkit.exec.run_command("fuser -k 4100/tcp", ignore_failure=True)

    # =========================================================================
    # config server
    # =========================================================================
    cxc_toolkit.exec.run_command("npm install")
    common.init_backend_config()
    admin_password = common.get_admin_password()
    update_server_config()

    # =========================================================================
    # config client
    # =========================================================================
    cxc_toolkit.exec.run_background("npm start")
    # wait 10s for the server to start
    time.sleep(10)

    token = common.get_token(admin_password)
    common.init_client_config(token)

    # =========================================================================
    # run the test
    # =========================================================================
    cxc_toolkit.exec.run_command(
        "node ./tests/api-tester/apitest.js --unit --stop-on-failure"
    )


if __name__ == "__main__":
    run()
