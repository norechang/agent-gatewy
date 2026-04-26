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
# Create and fix ownership/permissions for cache and data directories that may be
# bind-mounted from the host. We attempt to chown; if it fails we continue but
# emit a warning so operators can inspect host-side permissions.
mkdir -p /home/coder/.cache/opencode /home/coder/.local/share/opencode /home/coder/.config/opencode || true
if chown -R "$TARGET_UID:$TARGET_GID" /home/coder/.cache/opencode /home/coder/.local/share/opencode /home/coder/.config/opencode 2>/dev/null; then
    chmod -R 0755 /home/coder/.cache/opencode /home/coder/.local/share/opencode /home/coder/.config/opencode || true
else
    echo "warning: unable to chown OpenCode cache/data directories. Check host mount permissions." >&2
fi

# Use setpriv to drop privileges and exec the command as the mapped user
exec setpriv --reuid="$TARGET_UID" --regid="$TARGET_GID" --init-groups \
    bash -c "source \$NVM_DIR/nvm.sh && exec \"\$@\"" \
    -- "$@"
