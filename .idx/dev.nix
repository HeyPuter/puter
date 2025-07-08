# To learn more about how to use Nix to configure your environment
# see: https://developers.google.com/idx/guides/customize-idx-env
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "stable-25.05"; # or "unstable"

  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.python3
    pkgs.nodejs_24
  ];

  # Sets environment variables in the workspace
  env = {};
  idx = {
    # Search for the extensions you want on https://open-vsx.org/ and use "publisher.id"
    extensions = [
      # "vscodevim.vim"
    ];

    # Enable previews and customize configuration
    previews = {
      # Currently disabled because the preview system wasn't working
      enable = false;
      previews = {
        web = {
        command = [
          "npm"
          "run"
          "start"
          "--"
          "--port"
          "$PORT"
          "--host"
          "0.0.0.0"
          "--disable-host-check"
        ];
          manager = "web";
        };
      };
    };

    # Workspace lifecycle hooks
    workspace = {
      # Runs when a workspace is first created
      onCreate = {
        # npm-install = "npm install";
        # Currently disabled because the preview system wasn't working
      };
      # Runs when the workspace is (re)started
      onStart = {
        # npm-install = "npm install";
        # Currently disabled because the preview system wasn't working
      };
    };
  };
}
