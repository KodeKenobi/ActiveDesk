#!/bin/bash

# ActiveDesk macOS Installer
# This script downloads and installs ActiveDesk with a single click

set -e

APP_NAME="ActiveDesk"
REPO="KodeKenobi/ActiveDesk"
DMG_FILE="/tmp/ActiveDesk.dmg"
MOUNT_POINT="/Volumes/ActiveDesk"
APP_SOURCE="$MOUNT_POINT/ActiveDesk.app"
APP_INSTALL="/Applications/ActiveDesk.app"

echo "🚀 Installing $APP_NAME..."

# Get the latest release download URL
echo "📥 Downloading latest version..."
DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" \
  | grep "browser_download_url.*arm64.dmg" \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "❌ Error: Could not find download link"
  exit 1
fi

# Download the DMG
curl -L "$DOWNLOAD_URL" -o "$DMG_FILE"

# Mount the DMG
echo "🔧 Installing..."
hdiutil attach "$DMG_FILE" -nobrowse

# Copy to Applications
if [ -d "$APP_INSTALL" ]; then
  rm -rf "$APP_INSTALL"
fi
cp -r "$APP_SOURCE" "$APP_INSTALL"

# Unmount the DMG
hdiutil detach "$MOUNT_POINT"
rm "$DMG_FILE"

# Remove quarantine
xattr -rd com.apple.quarantine "$APP_INSTALL"

echo "✅ Installation complete!"
echo "🎉 Launching $APP_NAME..."

# Open the app
open "$APP_INSTALL"
