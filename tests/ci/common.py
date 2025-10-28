import os
import time

import cxc_toolkit
import requests
import yaml


PUTER_ROOT = os.getcwd()


def init_backend_config():
    """
    Initialize a default config in ./volatile/config/config.json.
    """
    # init config.json
    server_process = cxc_toolkit.exec.run_background("npm start")

    # wait 10s for the server to start
    time.sleep(10)
    server_process.terminate()


# Possible reasons for failure:
# - The backend server is not initialized, run "npm start" to initialize it.
# - Admin password in the kv service is flushed, have to trigger the creation of the admin user.
#   1. sqlite3 ./volatile/runtime/puter-database.sqlite
#   2. DELETE FROM user WHERE username = 'admin';
def get_admin_password() -> str:
    """
    Get the admin password from the backend server, throw an error if not found.
    """
    LOG_PATH = "/tmp/backend.log"
    backend_process = cxc_toolkit.exec.run_background("npm start", log_path=LOG_PATH)

    # NB: run_command + kill_on_output may wait indefinitely, use run_background + hard limit instead
    time.sleep(10)

    backend_process.terminate()

    # read the log file
    with open(LOG_PATH, "r") as f:
        lines = f.readlines()
    for line in lines:
        if "password for admin" in line:
            print(f"found password line: ---{line}---")
            admin_password = line.split("password for admin is:")[1].strip()
            print(f"Extracted admin password: {admin_password}")
            return admin_password

    raise RuntimeError(f"no admin password found, check {LOG_PATH} for details")


def get_token(admin_password: str) -> str:
    """
    Get the token from the backend server, throw an error if not found.
    """
    server_url = "http://api.puter.localhost:4100/login"
    login_data = {"username": "admin", "password": admin_password}
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

    response_json = response.json()
    if "token" not in response_json:
        raise RuntimeError("No token found")
    return response_json["token"]


def init_client_config(token: str):
    """
    Initialize a client config in ./tests/client-config.yaml.
    """
    example_config_path = f"{PUTER_ROOT}/tests/example-client-config.yaml"
    config_path = f"{PUTER_ROOT}/tests/client-config.yaml"

    # load
    with open(example_config_path, "r") as f:
        config = yaml.safe_load(f)

    # update
    config["auth_token"] = token

    # write
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, indent=2)
