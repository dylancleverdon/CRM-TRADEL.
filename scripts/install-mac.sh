#!/bin/bash
# One-line installer for TradeLink CRM on macOS. Usage:
#   curl -fsSL https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/install-mac.sh | bash
set -e
URL="https://github.com/dylancleverdon/CRM-TRADEL./releases/latest/download/TradeLink-CRM-mac.zip"
echo "⬇️  Downloading TradeLink CRM…"
TMP="$(mktemp -d)"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"
/usr/bin/ditto -x -k "$TMP/app.zip" "$TMP/x"
DEST="/Applications"
if [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
pkill -x "TradeLink CRM" 2>/dev/null || true
sleep 1
rm -rf "$DEST/TradeLink CRM.app"
/usr/bin/ditto "$TMP/x/TradeLink CRM.app" "$DEST/TradeLink CRM.app"
/usr/bin/xattr -cr "$DEST/TradeLink CRM.app" 2>/dev/null || true
rm -rf "$TMP"
echo "✅ Installed to $DEST/TradeLink CRM.app — opening it now. It will keep itself updated automatically."
open "$DEST/TradeLink CRM.app"
