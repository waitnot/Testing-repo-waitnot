#!/bin/bash
LOGO="Images/logo.jpg"
ASSET_DIR="client/ios/App/App/Assets.xcassets"
ICON_DIR="$ASSET_DIR/AppIcon.appiconset"
SPLASH_DIR="$ASSET_DIR/Splash.imageset"

# Function to resize and ensure it fits
generate_icon() {
  local size=$1
  local name=$2
  # iOS icons should be full square, sips -z does this.
  sips -z $size $size "$LOGO" --out "$ICON_DIR/$name"
}

generate_icon 1024 "icon-1024.png"
generate_icon 180 "icon-60@3x.png"
generate_icon 120 "icon-60@2x.png"
generate_icon 167 "icon-83.5@2x.png"
generate_icon 152 "icon-76@2x.png"
generate_icon 76 "icon-76.png"
generate_icon 40 "icon-20@2x.png"
generate_icon 60 "icon-20@3x.png"
generate_icon 58 "icon-29@2x.png"
generate_icon 87 "icon-29@3x.png"
generate_icon 80 "icon-40@2x.png"
generate_icon 120 "icon-40@3x.png"

# Splash
sips -z 1024 1024 "$LOGO" --out "$SPLASH_DIR/splash.png"
