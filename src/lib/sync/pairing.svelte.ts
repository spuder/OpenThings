/**
 * A server URL from a pairing link (`openthings://pair?server=…`, opened by the Camera app) that
 * Settings → Sync should fill in. The native shell sets it and opens Settings; Settings takes it.
 */
export const pairing = $state<{ server: string | null }>({ server: null });
