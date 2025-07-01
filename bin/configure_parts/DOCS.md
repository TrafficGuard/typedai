# Requirements for setup scripts (./bin/configure etc.)

# Configure script

`./bin/configure` is the project setup/configuration script that is run interactively by the user.

It should support running in bash or zsh, and if running on OSX should update both the .bashrc and .zshrc files.


# ./bin/configure_test

Runs the `./bin/configure` script in a Docker container with a non-root user to test the configure scripts in a clean environment.

When run interactively, it will prompt the user for input.

Can pass `TYPEDAI_TEST_` prefixed environment variables to the script for non-interactive automated setup and testing.

Example:
`./configure_test TYPEDAI_TEST_DB_TYPE=postgres TYPEDAI_TEST_USE_GCP=n TYPEDAI_TEST_FNM_INSTALL_CHOICE=1 TYPEDAI_TEST_PYENV_INSTALL_CHOICE=1 TYPEDAI_TEST_RG_INSTALL_CHOICE=1`

# ./bin/configure_parts/Dockerfile

This is used from configure_test to manually test the setup script in a fresh environment
