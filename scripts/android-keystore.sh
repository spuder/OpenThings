#!/usr/bin/env bash
# Make the Android release signing key and store it as GitHub Actions secrets for the Android
# workflow (docs/android.md#signing). Run once, from the repo root, signed in with `gh`:
#
#   scripts/android-keystore.sh ~/somewhere-safe/openthings-release.jks
#
# Keep the .jks and the password it prints somewhere safe (a password manager): every Android
# build must be signed with this key to install over the last one. Losing it means testers have to
# uninstall (and lose local data) to move to builds signed with a new key.
set -euo pipefail

out="${1:?usage: scripts/android-keystore.sh path/to/openthings-release.jks}"
if [ -e "$out" ]; then
  echo "$out already exists; not overwriting a signing key." >&2
  exit 1
fi
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (Android Studio has one)." >&2; exit 1; }
gh auth status >/dev/null

alias=openthings
pass="$(openssl rand -base64 30 | tr -d '/+=\n')"

# PKCS12 keystores use one password for the store and the key.
keytool -genkeypair -keystore "$out" -storetype PKCS12 -alias "$alias" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$pass" -keypass "$pass" -dname "CN=OpenThings" >/dev/null 2>&1
chmod 600 "$out"

base64 < "$out" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
printf '%s' "$pass" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf '%s' "$alias" | gh secret set ANDROID_KEY_ALIAS
printf '%s' "$pass" | gh secret set ANDROID_KEY_PASSWORD

echo "Keystore: $out"
echo "Password (store and key): $pass"
echo "Certificate SHA-256 (put it in docs/android.md#signing):"
keytool -list -v -keystore "$out" -storepass "$pass" -alias "$alias" | sed -n 's/.*SHA256: //p'
echo "Saved the GitHub secrets ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD."
