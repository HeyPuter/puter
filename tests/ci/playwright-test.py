#! /usr/bin/env python3

# test the client-replica feature
# - need browser environment
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


# create the admin user and print its password
def get_admin_password():
    output, _ = cxc_toolkit.exec.run_command(
        "npm start",
        stream_output=False,
        kill_on_output="password for admin",
    )

    # wait for the server to terminate
    time.sleep(10)

    # print the line that contains "password"
    lines = output.splitlines()
    admin_password = None
    for line in lines:
        if "password" in line:
            print(f"found password line: ---{line}---")
            # Parse password from "password for admin is: bbb236b2"
            if "password for admin is:" in line:
                admin_password = line.split("password for admin is:")[1].strip()
                print(f"Extracted admin password: {admin_password}")
                break

    print(f"password for admin: {admin_password}")

    CONTEXT.ADMIN_PASSWORD = admin_password


def init_client_config():
    # Load the example config
    example_config_path = f"{os.getcwd()}/tests/example-client-config.yaml"
    config_path = f"{os.getcwd()}/tests/client-config.yaml"

    with open(example_config_path, "r") as f:
        config = yaml.safe_load(f)

    # Update the token
    if not CONTEXT.TOKEN:
        print("Warning: No token available in CONTEXT")
        exit(1)

    config["auth_token"] = CONTEXT.TOKEN

    # Write the updated config
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, indent=2)


def run():
    WORK_DIR = "."
    os.chdir(WORK_DIR)

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
    get_admin_password()

    # =========================================================================
    # start backend server
    # =========================================================================
    cxc_toolkit.exec.run_background(
        "npm start", work_dir=WORK_DIR, log_path="/tmp/backend.log"
    )
    # wait 10s for the server to start
    time.sleep(10)

    # =========================================================================
    # config client
    # =========================================================================
    get_token()
    init_client_config()

    # =========================================================================
    # start fs-tree-manager server
    # =========================================================================
    cxc_toolkit.exec.run_background(
        "go run server.go",
        work_dir=f"{WORK_DIR}/src/fs_tree_manager",
        log_path="/tmp/fs-tree-manager.log",
    )
    time.sleep(10)

    # =========================================================================
    # run the test
    # =========================================================================
    cxc_toolkit.exec.run_command(
        "npx playwright test --reporter=line",
        work_dir=f"{WORK_DIR}/tests/playwright",
    )


if __name__ == "__main__":
    run()
