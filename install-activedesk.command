#!/bin/bash

# ActiveDesk Installer - Just double-click to install

set -e

echo "🚀 Installing ActiveDesk..."

# Download latest release
LATEST_URL=$(curl -s https://api.github.com/repos/KodeKenobi/ActiveDesk/releases/latest | grep -i "arm64.dmg" | grep browser_download_url | head -1 | cut -d'"' -f4)

if [ -z "$LATEST_URL" ]; then
    echo "❌ Could not find download link. Check your internet connection."
    exit 1
fi

# Download DMG
TEMP_DIR=$(mktemp -d)
DMG_PATH="$TEMP_DIR/ActiveDesk.dmg"

echo "📥 Downloading ActiveDesk..."
curl -L -o "$DMG_PATH" "$LATEST_URL"

# Mount DMG
MOUNT_POINT=$(mktemp -d)
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse

# Copy app to Applications
echo "📦 Installing to Applications folder..."
cp -r "$MOUNT_POINT/ActiveDesk.app" /Applications/

# Remove quarantine
xattr -rd com.apple.quarantine /Applications/ActiveDesk.app

# Unmount DMG
hdiutil detach "$MOUNT_POINT"

# Cleanup
rm -rf "$TEMP_DIR"

echo "✅ ActiveDesk installed successfully!"
echo "🎉 Opening ActiveDesk now..."

# Open the app
open /Applications/ActiveDesk.app

exit 0
