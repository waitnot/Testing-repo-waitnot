#!/bin/bash
LOGO="Images/logo.jpg"
ASSET_DIR="client/ios/App/App/Assets.xcassets"
ICON_DIR="$ASSET_DIR/AppIcon.appiconset"
SPLASH_DIR="$ASSET_DIR/Splash.imageset"

mkdir -p "$ICON_DIR"
mkdir -p "$SPLASH_DIR"

# Generate Icons
sips -z 1024 1024 "$LOGO" --out "$ICON_DIR/icon-1024.png"
sips -z 180 180 "$LOGO" --out "$ICON_DIR/icon-60@3x.png"
sips -z 120 120 "$LOGO" --out "$ICON_DIR/icon-60@2x.png"
sips -z 167 167 "$LOGO" --out "$ICON_DIR/icon-83.5@2x.png"
sips -z 152 152 "$LOGO" --out "$ICON_DIR/icon-76@2x.png"
sips -z 76 76 "$LOGO" --out "$ICON_DIR/icon-76.png"
sips -z 40 40 "$LOGO" --out "$ICON_DIR/icon-20@2x.png"
sips -z 60 60 "$LOGO" --out "$ICON_DIR/icon-20@3x.png"
sips -z 58 58 "$LOGO" --out "$ICON_DIR/icon-29@2x.png"
sips -z 87 87 "$LOGO" --out "$ICON_DIR/icon-29@3x.png"
sips -z 80 80 "$LOGO" --out "$ICON_DIR/icon-40@2x.png"
sips -z 120 120 "$LOGO" --out "$ICON_DIR/icon-40@3x.png"

# Generate Splash (Square 1024x1024 centered for iOS)
sips -z 1024 1024 "$LOGO" --out "$SPLASH_DIR/splash.png"

echo "iOS Icons and Splash generated."
