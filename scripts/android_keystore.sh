#!/usr/bin/env bash
#
# The Android release key for TrustWeb (wave 11), made ONCE and kept out of git:
#   ~/.config/trustweb/android-release.keystore   (RSA 4096, alias trustweb, valid 27 years)
#   ~/.config/trustweb/android-release.env        (its passwords, mode 0600)
# Then: prints the signing certificate's SHA-256, writes it into apps/trustweb/pwa/.well-known/assetlinks.json (the
# origin's half of the Trusted Web Activity pairing), and shows (or, with --push-secrets, runs) the `gh secret set`
# commands the release workflow (.github/workflows/android-release.yml) needs.
#
#   scripts/android_keystore.sh                   make the key if absent, write assetlinks.json, print the secret commands
#   scripts/android_keystore.sh --push-secrets    the same, and set the four repository secrets with gh
#   scripts/android_keystore.sh --assetlinks-only an existing key: only rewrite assetlinks.json
#
# Losing this key means a new package identity: phones would have to uninstall and reinstall. Back the two files up.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${TW_ANDROID_KEY_DIR:-$HOME/.config/trustweb}"
KS="$DIR/android-release.keystore"
ENVF="$DIR/android-release.env"
ALIAS=trustweb
ASSETLINKS="$REPO/apps/trustweb/pwa/.well-known/assetlinks.json"
GH_REPO="${TW_GH_REPO:-Evobiosys/trustweb}"
PUSH=0; ONLY_ASSETLINKS=0
for a in "$@"; do
  case "$a" in
    --push-secrets) PUSH=1 ;;
    --assetlinks-only) ONLY_ASSETLINKS=1 ;;
    *) echo "unknown option: $a (use --push-secrets or --assetlinks-only)" >&2; exit 2 ;;
  esac
done

echo "... android_keystore script running ..."
echo "--------"
command -v keytool >/dev/null || { echo "keytool (a JDK) is needed" >&2; exit 1; }
mkdir -p "$DIR"; chmod 700 "$DIR"

if [ ! -f "$KS" ]; then
  [ "$ONLY_ASSETLINKS" = 1 ] && { echo "no key at $KS yet: run without --assetlinks-only first" >&2; exit 1; }
  PW="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
  umask 077
  printf 'ANDROID_KEYSTORE_PASSWORD=%s\nANDROID_KEY_ALIAS=%s\nANDROID_KEY_PASSWORD=%s\n' "$PW" "$ALIAS" "$PW" > "$ENVF"
  keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$PW" -keypass "$PW" -dname "CN=TrustWeb, O=EvoBioSys, L=Vienna, C=AT" >/dev/null
  echo "made $KS (passwords in $ENVF)"
else
  echo "key exists: $KS"
fi
# shellcheck disable=SC1090
. "$ENVF"

FP="$(keytool -list -v -keystore "$KS" -storepass "$ANDROID_KEYSTORE_PASSWORD" -alias "$ALIAS" | sed -n 's/^.*SHA256: //p' | head -1)"
[ -n "$FP" ] || { echo "could not read the certificate fingerprint" >&2; exit 1; }
echo "signing certificate SHA-256: $FP"

mkdir -p "$(dirname "$ASSETLINKS")"
cat > "$ASSETLINKS" <<EOF
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "one.trustweb.app",
    "sha256_cert_fingerprints": ["$FP"]
  }
}]
EOF
echo "wrote $ASSETLINKS (commit it; it goes live with the next app deploy)"
[ "$ONLY_ASSETLINKS" = 1 ] && exit 0

echo "--------"
echo "GitHub secrets for the release workflow ($GH_REPO):"
B64CMD="base64 < '$KS' | tr -d '\\n'"
if [ "$PUSH" = 1 ]; then
  command -v gh >/dev/null || { echo "gh is needed for --push-secrets" >&2; exit 1; }
  base64 < "$KS" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_B64 --repo "$GH_REPO"
  gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$GH_REPO" --body "$ANDROID_KEYSTORE_PASSWORD"
  gh secret set ANDROID_KEY_ALIAS --repo "$GH_REPO" --body "$ANDROID_KEY_ALIAS"
  gh secret set ANDROID_KEY_PASSWORD --repo "$GH_REPO" --body "$ANDROID_KEY_PASSWORD"
  echo "set: ANDROID_KEYSTORE_B64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD"
else
  echo "  $B64CMD | gh secret set ANDROID_KEYSTORE_B64 --repo $GH_REPO"
  echo "  gh secret set ANDROID_KEYSTORE_PASSWORD --repo $GH_REPO --body \"\$ANDROID_KEYSTORE_PASSWORD\"   # from $ENVF"
  echo "  gh secret set ANDROID_KEY_ALIAS --repo $GH_REPO --body $ALIAS"
  echo "  gh secret set ANDROID_KEY_PASSWORD --repo $GH_REPO --body \"\$ANDROID_KEY_PASSWORD\"           # from $ENVF"
  echo "(or run this script again with --push-secrets)"
fi
echo "--------"
echo "release: git tag v<version> && git push origin v<version>   -> https://github.com/$GH_REPO/releases/latest/download/trustweb.apk"
