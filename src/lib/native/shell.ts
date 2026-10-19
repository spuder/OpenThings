/**
 * Native shell detection. Safe to import on the web: @capacitor/core is tiny and reports
 * `isNativePlatform() === false` in a browser, so web, PWA and Docker builds behave as before.
 * The iOS/Android integration itself lives in `./capacitor.svelte.ts` and is loaded lazily.
 */
import { Capacitor } from '@capacitor/core';

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
}
