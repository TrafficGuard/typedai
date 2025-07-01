# This is used from configure_test to manually test the setup script in a fresh environment
FROM ubuntu:latest

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies AND Python build dependencies
RUN apt-get update -y && \
    apt-get install -y sudo git curl unzip ca-certificates gnupg lsb-release rsync \
    make build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev \
    libsqlite3-dev wget llvm libncursesw5-dev xz-utils tk-dev \
    libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev cmake && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Optional: Install gcloud CLI if you want to test GCP parts thoroughly from a clean gcloud install
# RUN echo 'Installing gcloud CLI...' && \
#     mkdir -p /etc/apt/keyrings && \
#     curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg && \
#     echo 'deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
#     apt-get update && apt-get install -y google-cloud-cli && \
#     apt-get clean && \
#     rm -rf /var/lib/apt/lists/*

# Create testuser, grant passwordless sudo, and setup home directory:
RUN useradd --no-create-home -s /bin/bash -G sudo testuser && \
    echo 'testuser ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/testuser-nopasswd && \
    mkdir -p /home/testuser && \
    if [ -d "/etc/skel" ] && [ -n "$(ls -A /etc/skel)" ]; then \
        cp -rT /etc/skel /home/testuser; \
    fi && \
    chown -R testuser:testuser /home/testuser

# Set up the workspace directory
RUN mkdir -p /home/testuser/app && \
    chown testuser:testuser /home/testuser/app

# Set the working directory for subsequent commands
WORKDIR /app
