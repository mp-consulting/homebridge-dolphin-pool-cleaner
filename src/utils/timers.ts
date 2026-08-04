/**
 * Timer Utilities
 */

/**
 * Keep a timer from holding the Node event loop open.
 *
 * Plugin timers (retry backoffs, response timeouts, deferred refreshes) are
 * never a reason to delay shutdown — Homebridge's own handles keep the process
 * alive while it is running. `unref` is Node-only, hence the guarded call.
 */
export function unrefTimer<T extends ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>(timer: T): T {
  (timer as unknown as { unref?: () => void }).unref?.();
  return timer;
}
