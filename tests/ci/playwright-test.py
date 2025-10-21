#! /usr/bin/env python3

# test the client-replica feature
# - need browser environment (since socket.io doesn't work in node)
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


PUTER_ROOT = os.getcwd()
ENABLE_FS_TREE_MANAGER = False


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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
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


def get_admin_password():
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
        with open("/tmp/backend.log", "r") as f:
            print(f.read())
        exit(1)


def init_backend_config():
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


def init_client_config():
    example_config_path = f"{os.getcwd()}/tests/example-client-config.yaml"
    config_path = f"{os.getcwd()}/tests/client-config.yaml"

    # load
    with open(example_config_path, "r") as f:
        config = yaml.safe_load(f)

    if not CONTEXT.TOKEN:
        print("Warning: No token available in CONTEXT")
        exit(1)

    # update
    config["auth_token"] = CONTEXT.TOKEN

    # write
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, indent=2)


def run():
    os.chdir(PUTER_ROOT)

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
    get_admin_password()

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
    get_token()
    init_client_config()

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
        "npm install",
        work_dir=f"{PUTER_ROOT}/tests/playwright",
    )

    # # this command requires sudo privileges
    # cxc_toolkit.exec.run_command(
    #     "npx playwright install --with-deps",
    #     work_dir=f"{PUTER_ROOT}/tests/playwright",
    # )

    cxc_toolkit.exec.run_command(
        "npx playwright test",
        # "npx playwright test --reporter=line",
        # "npx playwright test --reporter=github",
        work_dir=f"{PUTER_ROOT}/tests/playwright",
    )


if __name__ == "__main__":
    run()
