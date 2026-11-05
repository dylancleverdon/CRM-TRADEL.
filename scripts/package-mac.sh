#!/bin/bash
# Turns the built .app into: a self-update zip, a drag-to-install DMG, and a one-click .pkg installer.
set -euo pipefail
VERSION="${1:-$(node -p "require('./package.json').version")}"
APP="$(find release -maxdepth 2 -name '*.app' -type d | head -1)"
OUT="out"
rm -rf "$OUT" && mkdir -p "$OUT"
echo "Packaging $APP ($VERSION)"

# Ad-hoc sign so Apple Silicon will run it (no paid Apple Developer ID needed).
codesign --force --deep --sign - "$APP"

# 1) zip used by the in-app auto updater and the one-line installer
ditto -c -k --keepParent "$APP" "$OUT/TradeLink-CRM-mac.zip"

# 2) DMG (drag to Applications)
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "TradeLink CRM" -srcfolder "$STAGE" -ov -format UDZO "$OUT/TradeLink-CRM.dmg"

# 3) PKG installer: installs to /Applications, removes quarantine, hands ownership to the user
#    (so future auto-updates need no password) and opens the app when done.
ROOT="$(mktemp -d)"
cp -R "$APP" "$ROOT/"
pkgbuild --analyze --root "$ROOT" "$OUT/comp.plist"
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$OUT/comp.plist"
SCRIPTS="$(mktemp -d)"
cat > "$SCRIPTS/preinstall" <<'PRE'
#!/bin/bash
pkill -x "TradeLink CRM" 2>/dev/null || true
exit 0
PRE
cat > "$SCRIPTS/postinstall" <<'POST'
#!/bin/bash
APP="/Applications/TradeLink CRM.app"
U="$(stat -f%Su /dev/console)"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
if [ -n "$U" ] && [ "$U" != "root" ]; then
  chown -R "$U":staff "$APP" 2>/dev/null || true
  launchctl asuser "$(id -u "$U")" sudo -u "$U" /usr/bin/open "$APP" 2>/dev/null || true
fi
exit 0
POST
chmod +x "$SCRIPTS/preinstall" "$SCRIPTS/postinstall"
pkgbuild --root "$ROOT" --component-plist "$OUT/comp.plist" --install-location /Applications \
  --identifier com.tradelink.crm --version "$VERSION" --scripts "$SCRIPTS" "$OUT/TradeLink-CRM-Installer.pkg"
rm -f "$OUT/comp.plist"
ls -la "$OUT"
