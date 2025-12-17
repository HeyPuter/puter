#! /usr/bin/env python3

import time

import cxc_toolkit

import common


def run():
    # =========================================================================
    # clean ports
    # =========================================================================

    # clean port 4100 for backend server
    cxc_toolkit.exec.run_command("fuser -k 4100/tcp", ignore_failure=True)


    # =========================================================================
    # config server
    # =========================================================================
    cxc_toolkit.exec.run_command("npm install")
    common.init_backend_config()

    # =========================================================================
    # start backend server
    # =========================================================================
    cxc_toolkit.exec.run_background(
        "npm start", work_dir=common.PUTER_ROOT,  log_path="/tmp/backend.log"
    )
    admin_password = common.get_admin_password()
    # wait 10 more sec for the server to start  
    time.sleep(10)

    # =========================================================================
    # config client
    # =========================================================================
    token = common.get_token(admin_password)
    common.init_client_config(token)

    # =========================================================================
    # run the test
    # =========================================================================
    cxc_toolkit.exec.run_command(
        "npm run test:puterjs-api",
        work_dir=common.PUTER_ROOT,
    )


if __name__ == "__main__":
    run()
