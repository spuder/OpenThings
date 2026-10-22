# Android app

Status: **preview, looking for testers** ([#6](https://github.com/spuder/OpenThings/issues/6)). The app is the same web code wrapped with [Capacitor](https://capacitorjs.com) 8, like the [iOS app](ios.md), plus one small Java plugin. It runs on Android 7.0 (API 24) and newer and targets Android 16 (API 36). It's tested in the Android 15 emulator; not yet on a phone.

| Today | Quick add | Multi-select |
| --- | --- | --- |
| ![Today on Android](screenshots/android-today.png) | ![Quick add above the Android keyboard](screenshots/android-quickadd.png) | ![Two to-dos selected on Android](screenshots/android-multiselect.png) |

| Piece | Where | State |
| --- | --- | --- |
| App shell (WebView, `https://localhost`) | `android/`, `capacitor.config.ts` | Implemented |
| Reminder notifications scheduled with Android | `src/lib/native/capacitor.svelte.ts` | Implemented |
| Tap a notification → open the task | same | Implemented |
| `openthings://` links: add to-dos, open lists, pairing ([url-scheme.md](url-scheme.md)) | `android/app/src/main/AndroidManifest.xml` | Implemented |
| Scan the pairing QR code (Settings → Sync → Scan QR code) | `android/app/src/main/java/io/github/spuder/openthings/OpenThingsPlugin.java` | Implemented |
| Multi-select (press and hold), quick add above the keyboard | the web app | Implemented |
| Back button / gesture: closes what's open, then back to Today, then leaves the app | `src/lib/native/back.ts` | Implemented |
| Dark mode: launch screen, background and system bar icons follow the app's theme | `android/app/src/main/res/values-night`, `MainActivity.java`, `capacitor.svelte.ts` | Implemented |
| App shortcuts (press and hold the icon): New to-do, Today, Inbox, Upcoming | `android/app/src/main/res/xml/shortcuts.xml` | Implemented |
| Home screen widgets | — | Not started (a Glance widget reading a snapshot in SharedPreferences) |
| Share to OpenThings from other apps | — | Not started (an `ACTION_SEND` intent filter) |
| Google Assistant | — | Not planned for now: automation apps (Tasker, …) can open `openthings://add?…&save=1` |

## Test builds

The **Android** workflow builds an APK for every pull request and every push to `main`, signed with the OpenThings key (see [Signing](#signing)), so each build installs over the last one and keeps your data.

**Easiest:** download [`OpenThings-android.apk`](https://github.com/spuder/OpenThings/releases/download/android-preview/OpenThings-android.apk) from the [Android preview](https://github.com/spuder/OpenThings/releases/tag/android-preview) pre-release, which always has the latest build from `main`.

1. Open that link on your phone (or copy the `.apk` over) and open the file. Android asks you to allow installing apps from the app you opened it with (Chrome, Files…).
2. To update, install the newer APK the same way; your to-dos stay. Or let [Obtainium](https://github.com/ImranR98/Obtainium) watch `https://github.com/spuder/OpenThings` with *Include prereleases* on, and it offers each new build.
3. With USB debugging on you can also run `adb install -r OpenThings-android.apk`.

Versioned releases (`v0.4.0`, …) have the APK too, next to the desktop downloads. Builds from a pull request are in that PR's workflow run, as the `OpenThings-android` artifact (sign in to GitHub to download it).

Pull requests from forks can't use the signing key, so they build a debug APK (`…-android-debug.apk`) signed with a throwaway key. It can't update the regular app, and the regular app can't update it: uninstall first, and local data goes with it. Turn on sync (Settings → Sync) to keep your to-dos on your server.

## Signing

Release APKs are signed with one key, kept as GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). `scripts/android-keystore.sh` makes the key and sets the secrets; keep the `.jks` and its password somewhere safe, because every future build must be signed with it to update installed apps.

`android/app/build.gradle` signs release builds when `ANDROID_KEYSTORE_FILE` and the passwords are in the environment, so you can build a signed APK locally the same way. Without them `assembleRelease` is unsigned and `assembleDebug` uses your local debug key.

Versions: `versionName` comes from `package.json` (with `-preview.<run>` on builds that aren't a release tag), and `versionCode` is the workflow's run number, so every build is newer than the one before, previews and releases alike.

## Back button

Android's back button or back gesture steps out one level at a time (`src/lib/native/back.ts`):

1. With the keyboard up, Android hides the keyboard first.
2. An open overlay (quick add, Quick Find, the command palette, a menu) closes, exactly as Escape does on a keyboard.
3. The list drawer closes.
4. The open to-do closes (its edits are saved), or a multi-selection ends.
5. In any list other than Today, back goes to Today.
6. On Today, back leaves the app. It keeps running in the background, as with the Home button.

## Reminders

Reminders are scheduled with Android's alarm manager, so they arrive with the app closed.

- **Notifications permission:** Android 13 and newer ask the first time, from Settings → Notifications → Allow notifications.
- **Exact timing:** Android 12 and newer only allow apps to set exact alarms if you turn on *Alarms & reminders* for them, and Android 14 and newer start with it off. While it's off, Android may deliver a reminder a few minutes late to save battery (in the emulator: about 1.5 minutes). Settings → Notifications → **Allow exact timing** opens that switch; reminders are rescheduled exactly when you come back.
- **While the app is open,** it plays the chime and shows the reminder itself, as on the other platforms. Android keeps the app running for a short while after you leave it, so a reminder that comes due in that window is posted as a notification straight away.
- **Force stop** (Settings → Apps → OpenThings → Force stop) deletes an app's alarms. Opening OpenThings again schedules them again.

## Build it yourself

You need [Android Studio](https://developer.android.com/studio) (its bundled JDK 21 and an Android SDK with API 36) and Node 22.

```sh
npm ci && npm run build && npx cap sync android
npx cap open android          # Android Studio: pick a device or emulator and press Run
```

Or from a terminal:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # macOS; any JDK 21 works
export ANDROID_HOME="$HOME/Library/Android/sdk"
(cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

After web changes: `npm run build && npx cap sync android`. `versionName` comes from `package.json`, so `scripts/bump-version.sh` covers Android too; `versionCode` is 1 for local builds (see [Signing](#signing)). A local debug build can't update a build from CI, or the other way round: they're signed with different keys.

## Notes

- **Origin and storage:** the page is served from `https://localhost`, Capacitor's Android default. IndexedDB (all task data) is keyed by origin, so keep it fixed. The iOS app uses `capacitor://localhost`; the two never share local data, only the sync server.
- **Native plugin:** Android registers the same `OpenThingsNative` plugin name as iOS, but implements only `scanQRCode`, with [Google's code scanner](https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner) from Play services. It shows its own camera screen and needs no camera permission. The first scan may wait while Play services downloads the scanner. The App Group methods (widgets, share inbox) are called on iOS only.
- **Icons:** `android/app/src/main/res/mipmap-*` are generated from `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` with `@capacitor/assets` (an adaptive icon on Android 8 and newer). The launch screen (`drawable/splash.xml`, the icon as a vector on the app's light or dark background) and the notification icon (`drawable/ic_stat_openthings.xml`, set in `capacitor.config.ts`) are vectors drawn for this project.

## Next

1. Test on phones from the [tester sign-up](https://docs.google.com/forms/d/e/1FAIpQLSf0Vke8v5YCE53KemDdbn5VFub2v2MIK32OaTM-B6Sf1psgVg/viewform).
2. Google Play (internal testing first), with the same signing key as the upload key.
3. Share to OpenThings, then a home screen widget.
