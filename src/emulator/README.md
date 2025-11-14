# Puter Emulator

To run locally:
1. Build the image in `image/`:
    - `./build-epoxy.sh` or provide a musl+i686 epoxy in `assets/`
    - `./build.sh`
2. Build the v86 frontend: `npm run start-webpack`
3. Build and run a local epoxy in `submodules/epoxy-tls/server/` or some other wisp server for the guest networking
4. Run Puter and log in as admin, then open the `puter-linux` app via URL
5. Optionally open the Terminal app if you want to test out the v86 integration
