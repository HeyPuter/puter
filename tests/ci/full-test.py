#! /usr/bin/env python3

import os
import signal
import time
import json
import yaml

import cxc_toolkit

import common

PUTER_ROOT = common.PUTER_ROOT


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
    common.init_backend_config()
    admin_password = common.get_admin_password()

    # =========================================================================
    # start backend server
    # =========================================================================
    cxc_toolkit.exec.run_command("npm install --save-dev c8")

    backend_process = cxc_toolkit.exec.run_background(
        "npx c8 --all --include=src/backend --include=extensions --reporter='text' --reporter='html' node ./tools/run-selfhosted.js",
        work_dir=PUTER_ROOT,
        log_path="/tmp/backend.log",
    )
    # wait 10s for the server to start
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
        "npx playwright test -g 'stat with uid'",
        work_dir=f"{PUTER_ROOT}/tests/playwright",
    )

    import psutil
    p = psutil.Process(backend_process.pid)
    for child in p.children(recursive=True):
        # print(f"terminating child process {child.pid}")
        # child.kill()
        print(f"sending SIGINT to child process {child.pid}")
        os.kill(child.pid, signal.SIGINT)

    # import psutil
    # p = psutil.Process(backend_process.pid)
    print(f"sending SIGINT to backend process {backend_process.pid}")
    os.kill(backend_process.pid, signal.SIGINT)
    print(f"waiting for backend process {backend_process.pid} to exit")
    backend_process.process.wait()
    print(f"backend process {backend_process.pid} exited")


if __name__ == "__main__":
    run()
