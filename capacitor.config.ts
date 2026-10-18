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
};

export default config;
