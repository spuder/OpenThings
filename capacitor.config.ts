import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Used by the Capacitor CLI. The bundle id that Xcode actually builds lives in ios/App/Config/Shared.xcconfig.
  appId: 'io.github.spuder.openthings',
  appName: 'OpenThings',
  webDir: 'dist',
  ios: {
    // The page is served from capacitor://localhost. Keep scheme + hostname fixed:
    // IndexedDB (all task data) is keyed by origin, so changing either would start an empty database.
    scheme: 'capacitor',
    contentInset: 'never',
  },
  server: {
    hostname: 'localhost',
  },
  plugins: {
    // Don't resize the web view for the keyboard: the app reads keyboardWillShow and makes room itself
    // (src/lib/keyboard.ts), which keeps fixed panels and the list layout stable.
    Keyboard: { resize: 'none' },
    // Android: the status bar icon (android/app/src/main/res/drawable/ic_stat_openthings.xml) and its
    // tint, --accent in src/app.css. Without it Android shows a generic "i". iOS ignores both.
    LocalNotifications: { smallIcon: 'ic_stat_openthings', iconColor: '#2f6fed' },
  },
};

export default config;
