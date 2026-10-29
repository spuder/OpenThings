# TestFlight

`.github/workflows/testflight.yml` archives the iOS app with its widget (`.widgets`) and share (`.share`) extensions, signs it for App Store distribution and uploads it to TestFlight. *Tag release* starts it on every new `v*` tag, along with Desktop, Container and Android. You can also run it by hand: Actions → TestFlight → Run workflow. It only uploads commits that are on `main`, and it skips with a notice when the secrets below aren't set. Submitting a build for App Store review is still manual.

The build number (`CURRENT_PROJECT_VERSION`) comes from the workflow's run number, because App Store Connect rejects a second upload with the same number. The version (`MARKETING_VERSION`) is the one `scripts/bump-version.sh` sets in `ios/App/Config/OpenThings.xcconfig`.

## One-time setup

The account holder (or an Admin) needs to do these steps once.

1. **Identifiers:** go to [developer.apple.com → Identifiers](https://developer.apple.com/account/resources/identifiers/list). Register the App Group `group.io.github.spuder.openthings`. Then register the app IDs `io.github.spuder.openthings`, `io.github.spuder.openthings.widgets` and `io.github.spuder.openthings.share`, each with the **App Groups** capability turned on and pointing to that group.
2. **App record:** in [App Store Connect](https://appstoreconnect.apple.com) → Apps → + → New App, choose iOS and the bundle ID `io.github.spuder.openthings`.
3. **API key role:** the `APP_STORE_CONNECT_API_KEY_*` key that notarization already uses needs the **App Manager** role or higher to upload builds and create provisioning profiles. Check it under Users and Access → Integrations. If Xcode can't create the profiles or a development certificate with the key, give the key **Admin**.
4. **Distribution certificate:** create an **Apple Distribution** certificate. The *Developer ID Application* certificate that signs the Mac app won't work here. Create it in Xcode → Settings → Accounts → Manage Certificates → + → Apple Distribution, then in Keychain Access, under *My Certificates*, export it as a `.p12` file with a password.
5. **Secrets:**

   ```sh
   base64 -i AppleDistribution.p12 | gh secret set APPLE_DISTRIBUTION_CERTIFICATE --repo spuder/OpenThings
   gh secret set APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD --repo spuder/OpenThings
   gh secret set APPLE_TEAM_ID --repo spuder/OpenThings --body MDV7B53NY3
   ```

   The workflow also uses the existing `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID` and `APP_STORE_CONNECT_API_KEY_CONTENT` secrets (see [desktop.md](desktop.md#signing-and-notarization)).
6. **Testers:** in App Store Connect → the app → TestFlight, add yourself as an internal tester (or add an internal group that includes you), so new builds show up in the TestFlight app.

## Verify a release

- `gh run list -R spuder/OpenThings -w TestFlight -L 1` succeeded, and its summary names the uploaded build.
- The build appears in App Store Connect → the app → TestFlight after processing (usually 5–30 minutes), and in the TestFlight app on your iPhone.
