#! /usr/bin/env python3
#
# Usage:
# ./tools/api-tester/ci/run.py

import argparse
import time
import sys
import os
import json
import datetime
import urllib
import requests
import yaml

import cxc_toolkit
import cxc_toolkit.exec


class Context:
    def __init__(self):
        self.ADMIN_PASSWORD = None
        self.TOKEN = None


CONTEXT = Context()


def get_token():
    # Send HTTP request to server and print response
    print("Sending HTTP request to server...")
    # Assuming the server runs on localhost:4100 (default Puter port)
    server_url = "http://api.puter.localhost:4100/login"

    # Prepare login data
    login_data = {"username": "admin", "password": CONTEXT.ADMIN_PASSWORD}

    # Send POST request using requests library
    response = requests.post(
        server_url,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": "http://api.puter.localhost:4100",
        },
        json=login_data,
        timeout=30,
    )

    print(f"Server response status: {response.status_code}")
    print(f"Server response body: {response.text}")

    response_json = response.json()
    print(f"Parsed JSON response: {json.dumps(response_json, indent=2)}")
    print(f"Token: {response_json['token']}")
    CONTEXT.TOKEN = response_json["token"]


def init_server_config():
    server_process = cxc_toolkit.exec.run_background("npm start")
    # wait 10s for the server to start
    time.sleep(10)
    server_process.terminate()


# create the admin user and print its password
def get_admin_password():
    # output_bytes, exit_code = cxc_toolkit.exec.run_command(
    #     "npm start",
    #     stream_output=False,
    #     kill_on_output="password for admin",
    # )

    backend_process = cxc_toolkit.exec.run_background(
        "npm start", log_path="/tmp/backend.log"
    )

    # NB: run_command + kill_on_output may wait indefinitely, use run_background + hard limit instead
    time.sleep(10)

    backend_process.terminate()

    # read the log file
    with open("/tmp/backend.log", "r") as f:
        lines = f.readlines()
    for line in lines:
        if "password for admin" in line:
            print(f"found password line: ---{line}---")
            admin_password = line.split("password for admin is:")[1].strip()
            print(f"Extracted admin password: {admin_password}")
            CONTEXT.ADMIN_PASSWORD = admin_password
            return

    if not CONTEXT.ADMIN_PASSWORD:
        print("Error: No admin password found")

        # print the log file
        with open("/tmp/backend.log", "r") as f:
            print(f.read())

        exit(1)


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
        "/admin/tmp": {"mounter": "memoryfs"},
    }

    # Merge mountpoints (overwrite existing ones)
    config["services"]["mountpoint"]["mountpoints"].update(mountpoint_config)

    # Write the updated config back
    with open(config_file, "w") as f:
        json.dump(config, f, indent=2)


def init_api_test():
    # Load the example config
    example_config_path = f"{os.getcwd()}/tools/api-tester/example_config.yml"
    config_path = f"{os.getcwd()}/tools/api-tester/config.yml"

    with open(example_config_path, "r") as f:
        config = yaml.safe_load(f)

    # Update the token
    if not CONTEXT.TOKEN:
        print("Warning: No token available in CONTEXT")
        exit(1)

    config["token"] = CONTEXT.TOKEN
    config["url"] = "http://api.puter.localhost:4100"

    # Write the updated config
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, indent=2)


def run():
    # =========================================================================
    # free the port 4100
    # =========================================================================
    cxc_toolkit.exec.run_command("fuser -k 4100/tcp", ignore_failure=True)

    # =========================================================================
    # config server
    # =========================================================================
    cxc_toolkit.exec.run_command("npm install")
    init_server_config()
    get_admin_password()
    update_server_config()

    # =========================================================================
    # config client
    # =========================================================================
    cxc_toolkit.exec.run_background("npm start")
    # wait 10s for the server to start
    time.sleep(10)

    get_token()
    init_api_test()

    # =========================================================================
    # run the test
    # =========================================================================
    cxc_toolkit.exec.run_command(
        "node ./tools/api-tester/apitest.js --unit --stop-on-failure"
    )


if __name__ == "__main__":
    run()
