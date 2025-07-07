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

## Sourcing vs. Executing – Return/Exit Convention

Every script in `bin/configure_parts` **may** be either
1. sourced by `./bin/configure` (so control must come back), or  
2. executed directly for stand-alone testing.

To make this reliable, each part **must** finish with:

```bash
# If sourced, just return; if executed directly, exit.
(return 0 2>/dev/null) && return 0 || exit 0
```

• Use `exit <non-zero>` freely for **fatal errors**;  
• Never use `exit 0` for normal completion—use the pattern above instead.  
This keeps the parent `configure` script running while still allowing the
file to act as a self-contained executable.