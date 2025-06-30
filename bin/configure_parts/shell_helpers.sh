#!/bin/bash

# This function updates shell configuration files (~/.bashrc, ~/.zshrc)
# in an idempotent way. It checks for a unique comment before adding content.
#
# Usage: update_shell_profiles "unique_comment_identifier" "content_to_add"
#
# Example:
#   COMMENT="# Added by TypedAI for CLI"
#   CONTENT="export TYPEDAI_HOME=$(pwd)\nexport PATH=\$TYPEDAI_HOME/bin/path:\$PATH"
#   update_shell_profiles "$COMMENT" "$CONTENT"
#
update_shell_profiles() {
    local identifier_comment="$1"
    local content_to_add="$2"
    
    # Array of common shell profile files
    local shell_files=("$HOME/.bashrc" "$HOME/.zshrc")

    for profile_file in "${shell_files[@]}"; do
        # Check if the profile file exists. If not, we don't need to do anything.
        if [ -f "$profile_file" ]; then
            # Check if our identifying comment already exists in the file.
            if grep -qF "$identifier_comment" "$profile_file"; then
                echo "Configuration already present in $profile_file. Skipping."
            else
                echo "Adding configuration to $profile_file..."
                # Append the configuration to the file.
                {
                    echo "" # Add a newline for spacing
                    echo "$identifier_comment"
                    echo -e "$content_to_add"
                } >> "$profile_file"
            fi
        fi
    done
}
