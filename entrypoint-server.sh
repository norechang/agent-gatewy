#!/bin/bash
set -e

# This script runs as root and handles UID/GID mapping before switching to coder user
# Based on https://github.com/glennvdv/opencode-dockerized/blob/main/entrypoint.sh

# Get target UID/GID from environment (default to 1000)
TARGET_UID=${HOST_UID:-1000}
TARGET_GID=${HOST_GID:-1000}

# Get current coder user UID/GID
CURRENT_UID=$(id -u coder)
CURRENT_GID=$(id -g coder)

# Update UID/GID if they don't match
if [ "$TARGET_UID" != "$CURRENT_UID" ] || [ "$TARGET_GID" != "$CURRENT_GID" ]; then
    echo "Adjusting coder user UID:GID from $CURRENT_UID:$CURRENT_GID to $TARGET_UID:$TARGET_GID"

    # Update group ID if needed
    if [ "$TARGET_GID" != "$CURRENT_GID" ]; then
        groupmod -g "$TARGET_GID" coder 2>/dev/null || true
    fi

    # Update user ID if needed
    if [ "$TARGET_UID" != "$CURRENT_UID" ]; then
        usermod -u "$TARGET_UID" coder 2>/dev/null || true
    fi

    # Fix ownership of essential home directory contents only
    echo "Fixing home directory permissions..."
    chown "$TARGET_UID:$TARGET_GID" /home/coder 2>/dev/null || true
    chown -R "$TARGET_UID:$TARGET_GID" /home/coder/.config 2>/dev/null || true
    chown -R "$TARGET_UID:$TARGET_GID" /home/coder/.local 2>/dev/null || true
    chown -R "$TARGET_UID:$TARGET_GID" /home/coder/.cache 2>/dev/null || true
    # NVM: only fix top-level ownership, not deeply nested files
    chown "$TARGET_UID:$TARGET_GID" /home/coder/.nvm 2>/dev/null || true
fi

# Set HOME explicitly to ensure it points to /home/coder
export HOME=/home/coder
export USER=coder

# Source NVM to make Node.js available
export NVM_DIR="/home/coder/.nvm"

# Ensure critical OpenCode directories exist and are writable by the mapped user
# These directories may be bind-mounted from the host, so we just ensure they exist
# and are owned by the target user at the top level (not recursively)
mkdir -p /home/coder/.cache/opencode/bin 2>/dev/null || true
mkdir -p /home/coder/.local/share/opencode 2>/dev/null || true
mkdir -p /home/coder/.config/opencode 2>/dev/null || true

# Attempt to set ownership at top level only (not recursive to avoid slowness with bind mounts)
chown "$TARGET_UID:$TARGET_GID" /home/coder/.cache/opencode 2>/dev/null || true
chown "$TARGET_UID:$TARGET_GID" /home/coder/.local/share/opencode 2>/dev/null || true
chown "$TARGET_UID:$TARGET_GID" /home/coder/.config/opencode 2>/dev/null || true

# Use setpriv to drop privileges and exec the command as the mapped user
exec setpriv --reuid="$TARGET_UID" --regid="$TARGET_GID" --init-groups \
    bash -c "source \$NVM_DIR/nvm.sh && exec \"\$@\"" \
    -- "$@"
