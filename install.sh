#!/bin/bash
# ============================================================
#  ZPA Shield Deployer — macOS / Linux Installer
#  Usage: bash install.sh
# ============================================================

set -euo pipefail

REPO="Paulie631/zpa-shield-deployer"
INSTALL_DIR="$HOME/zpa-shield-deployer"
AUTO_YES=false

# Parse flags
for arg in "$@"; do
  case $arg in
    -y|--yes) AUTO_YES=true ;;
    --dir=*) INSTALL_DIR="${arg#*=}" ;;
  esac
done
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BLUE}🛡️  ZPA Shield Deployer — Installer${NC}"
echo "========================================"
echo ""

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${NC}"
  echo ""
  echo "Install Node.js 18+ first:"
  echo "  macOS:  brew install node"
  echo "  Linux:  https://nodejs.org/en/download/package-manager"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}✗ Node.js $NODE_VER found — version 18+ required.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version)${NC}"

# --- Check curl / unzip ---
for cmd in curl unzip; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}✗ $cmd is required but not installed.${NC}"
    exit 1
  fi
done

# --- Fetch latest release ---
echo -e "${BLUE}→ Fetching latest release from GitHub...${NC}"
LATEST=$(curl -sf "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\(.*\)".*/\1/')
ZIP_URL=$(echo "$LATEST" | grep '"browser_download_url"' | grep '\.zip' | head -1 | sed 's/.*"browser_download_url": *"\(.*\)".*/\1/')

if [ -z "$ZIP_URL" ]; then
  echo -e "${RED}✗ Could not find release zip. Check https://github.com/${REPO}/releases${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Latest version: ${VERSION}${NC}"

# --- Download ---
# --- Clean up any leftover temp files first ---
rm -f /tmp/zpa-shield-*.zip 2>/dev/null || true
rm -rf /tmp/zpa-shield-extract-* 2>/dev/null || true

TMP_ZIP=$(mktemp /tmp/zpa-shield-XXXXXX.zip)
TMP_EXTRACT=$(mktemp -d /tmp/zpa-shield-extract-XXXXXX)
echo -e "${BLUE}→ Downloading ${VERSION}...${NC}"
curl -sL "$ZIP_URL" -o "$TMP_ZIP"
echo -e "${GREEN}✓ Downloaded${NC}"

# --- Kill any running instance before install ---
if lsof -ti :3001 > /dev/null 2>&1 || lsof -ti :3000 > /dev/null 2>&1; then
  echo -e "${YELLOW}→ Stopping existing ZPA Shield Deployer processes...${NC}"
  lsof -ti :3001 | xargs kill -9 2>/dev/null
  lsof -ti :3000 | xargs kill -9 2>/dev/null
  sleep 1
  echo -e "${GREEN}✓ Old processes stopped${NC}"
fi

# --- Install ---
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}⚠ Existing installation found at $INSTALL_DIR${NC}"
  if [ "$AUTO_YES" = true ]; then
    echo "  Auto-overwriting (-y flag)"
  else
    read -p "  Overwrite? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      exit 0
    fi
  fi
  rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"
unzip -q "$TMP_ZIP" -d "$TMP_EXTRACT"
EXTRACTED_DIR=$(ls "$TMP_EXTRACT" | head -1)
cp -r "$TMP_EXTRACT/$EXTRACTED_DIR/." "$INSTALL_DIR/"
rm -rf "$TMP_ZIP" "$TMP_EXTRACT"
echo -e "${GREEN}✓ Extracted to $INSTALL_DIR${NC}"

# --- npm install ---
echo -e "${BLUE}→ Installing dependencies (this takes ~30 seconds)...${NC}"
cd "$INSTALL_DIR"
npm run install:all --silent
echo -e "${GREEN}✓ Dependencies installed${NC}"

# --- Create launcher script ---
cat > "$INSTALL_DIR/start.sh" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")"
echo "🛡️  Starting ZPA Shield Deployer..."
# Kill any old instances on these ports first
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 1
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:3001"
echo ""
echo "   Press Ctrl+C to stop."
echo ""
npm run dev
LAUNCHER
chmod +x "$INSTALL_DIR/start.sh"

# --- macOS: create .app bundle on Desktop ---
if [[ "$OSTYPE" == "darwin"* ]]; then
  APP="$HOME/Desktop/ZPA Shield Deployer.app"
  APP_MACOS="$APP/Contents/MacOS"
  APP_RES="$APP/Contents/Resources"

  rm -rf "$APP"
  mkdir -p "$APP_MACOS" "$APP_RES"

  # Info.plist
  cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ZPA Shield Deployer</string>
  <key>CFBundleDisplayName</key><string>ZPA Shield Deployer</string>
  <key>CFBundleIdentifier</key><string>com.zscaler.zpa-shield-deployer</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><false/>
</dict>
</plist>
PLIST

  # Launcher — opens Terminal + browser
  ESCAPED_DIR=$(printf '%s' "$INSTALL_DIR" | sed "s/'/'\\\\''/g")
  cat > "$APP_MACOS/launcher" << LAUNCHER
#!/bin/bash
osascript -e 'tell application "Terminal" to do script "lsof -ti :3001 | xargs kill -9 2>/dev/null; lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1; cd '"$ESCAPED_DIR"' && npm run dev"'
sleep 3 && open http://localhost:3000
LAUNCHER
  chmod +x "$APP_MACOS/launcher"

  # Generate a simple blue PNG icon with Python3 (built-in macOS)
  python3 -c "
import struct, zlib, os
def png(r,g,b,s=256):
    rows=b''.join(b'\\x00'+bytes([r,g,b,255]*s) for _ in range(s))
    def ck(t,d):
        return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\\x89PNG\\r\\n\\x1a\\n'+ck(b'IHDR',struct.pack('>IIBBBBB',s,s,8,2,0,0,0))+ck(b'IDAT',zlib.compress(rows))+ck(b'IEND',b'')
p='$APP_RES/AppIcon.png'
open(p,'wb').write(png(0,102,204))
"

  # Convert to icns using built-in macOS tools
  ICONSET="$APP_RES/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for SIZE in 16 32 64 128 256 512; do
    sips -z $SIZE $SIZE "$APP_RES/AppIcon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" &>/dev/null
    sips -z $((SIZE*2)) $((SIZE*2)) "$APP_RES/AppIcon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" &>/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP_RES/AppIcon.icns" 2>/dev/null && \
    rm -rf "$ICONSET" "$APP_RES/AppIcon.png" || true

  echo -e "${GREEN}✓ Desktop icon created: ${BLUE}ZPA Shield Deployer${NC}"
fi

# --- Done ---
echo ""
echo "========================================"
echo -e "${GREEN}🎉 ZPA Shield Deployer ${VERSION} installed!${NC}"
echo ""
echo -e "  ${BLUE}To start:${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo -e "    🖥️  Double-click ${YELLOW}ZPA Shield Deployer${NC} on your Desktop"
  echo -e "    ${YELLOW}— or from terminal —${NC}"
fi
echo -e "    bash $INSTALL_DIR/start.sh"
echo ""
echo -e "  Then open: ${BLUE}http://localhost:3000${NC}"
echo "========================================"
echo ""
