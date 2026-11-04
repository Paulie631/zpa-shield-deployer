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
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:3001"
echo ""
echo "   Press Ctrl+C to stop."
echo ""
npm run dev
LAUNCHER
chmod +x "$INSTALL_DIR/start.sh"

# --- macOS: create app shortcut ---
if [[ "$OSTYPE" == "darwin"* ]]; then
  # Try /usr/local/bin first, fall back to ~/bin
  if [ -w "/usr/local/bin" ]; then
    SHORTCUT="/usr/local/bin/zpa-shield"
  else
    mkdir -p "$HOME/bin"
    SHORTCUT="$HOME/bin/zpa-shield"
    # Add ~/bin to PATH if not already there
    if ! echo "$PATH" | grep -q "$HOME/bin"; then
      for RCFILE in "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc"; do
        if [ -f "$RCFILE" ]; then
          echo '' >> "$RCFILE"
          echo '# Added by ZPA Shield Deployer installer' >> "$RCFILE"
          echo 'export PATH="$HOME/bin:$PATH"' >> "$RCFILE"
          break
        fi
      done
    fi
  fi
  cat > "$SHORTCUT" << SHORTCUTSCRIPT
#!/bin/bash
cd "$INSTALL_DIR"
npm run dev
SHORTCUTSCRIPT
  chmod +x "$SHORTCUT"
  echo -e "${GREEN}✓ macOS shortcut created: ${BLUE}${SHORTCUT}${NC}"
fi

# --- Done ---
echo ""
echo "========================================"
echo -e "${GREEN}🎉 ZPA Shield Deployer ${VERSION} installed!${NC}"
echo ""
echo -e "  ${BLUE}To start:${NC}"
echo -e "    cd $INSTALL_DIR && npm run dev"
echo -e "    ${YELLOW}— or —${NC}"
echo -e "    bash $INSTALL_DIR/start.sh"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo -e "    ${YELLOW}— or —${NC}"
  echo -e "    ${SHORTCUT}"
fi
echo ""
echo -e "  Then open: ${BLUE}http://localhost:3000${NC}"
echo "========================================"
echo ""
