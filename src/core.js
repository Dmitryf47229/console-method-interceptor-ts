/**
 * Core implementation.
 *
 * We wrap every enumerable method on the global `console` so that each call is
 * forwarded to the original method (so normal output is unchanged) AND captured
 * into a fixed-size ring buffer for later inspection.
 *
 * Design decisions (documented so the behaviour is unambiguous):
 *
 * 1. CAPTURED SHAPE — each entry is `{ method, args }` where `args` is a shallow
 *    copy of the call's arguments. We intentionally do NOT serialize the args,
 *    because a primary use case is asserting on structured values in tests.
 *    Objects are captured by reference; callers must not mutate them after
 *    logging if they want deterministic snapshots.
 *
 * 2. RING BUFFER — older entries are evicted once `capacity` is exceeded. This
 *    bounds memory for long-running processes.
 *
 * 3. METHODS WRAPPED — only own enumerable function-valued properties of
 *    `console` are intercepted. Non-function properties are left untouched.
 *
 * 4. NO STACK CAPTURE — capturing stack traces is expensive and non-deterministic
 *    across environments. Callers needing a stack should log it themselves.
 */

/**
 * @typedef {Object} LogEntry
 * @property {string} method  The console method name that was called.
 * @property {any[]} args     Shallow copy of the arguments passed to the call.
 */

/**
 * @typedef {Object} Interceptor
 * @property {() => LogEntry[]} entries      Returns a snapshot array of currently buffered entries (newest-last order).
 * @property {() => LogEntry[]} drain        Returns the buffered entries and clears the buffer.
 * @property {() => void} restore            Removes the wrappers and restores the original console methods.
 * @property {() => number} capacity         Returns the buffer capacity.
 * @property {() => number} size             Returns the number of entries currently buffered.
 */

/**
 * Creates and installs a console interceptor.
 *
 * @param {Object} [opts]
 * @param {number} [opts.capacity=100]  Maximum number of entries retained.
 * @param {Console} [opts.target=console]  The console-like object to wrap. Defaults to the global console.
 * @returns {Interceptor}
 */
export function createInterceptor(opts = {}) {
  const capacity = typeof opts.capacity === "number" && opts.capacity > 0
    ? Math.floor(opts.capacity)
    : 100;
  const target = opts.target ?? console;

  // Snapshot the original methods BEFORE we overwrite anything.
  const originals = new Map();
  const wrappedMethods = new Set();

  // We capture the keys up front so wrapping during iteration is not an issue.
  const methodNames = Object.getOwnPropertyNames(target).filter((name) => {
    try {
      return typeof target[name] === "function";
    } catch {
      return false;
    }
  });

  // The ring buffer: we push to the end and shift from the front when full.
  const buffer = [];

  function capture(method, args) {
    buffer.push({ method, args: Array.prototype.slice.call(args) });
    while (buffer.length > capacity) {
      buffer.shift();
    }
  }

  for (const name of methodNames) {
    originals.set(name, target[name]);
    const original = target[name];
    // Each wrapper closes over `name` and `original` from this iteration.
    target[name] = function (...args) {
      capture(name, args);
      return original.apply(target, args);
    };
    wrappedMethods.add(name);
  }

  return {
    entries() {
      // Return a shallow copy so callers can mutate without affecting the buffer.
      return buffer.slice();
    },
    drain() {
      const snapshot = buffer.slice();
      buffer.length = 0;
      return snapshot;
    },
    restore() {
      for (const [name, original] of originals) {
        target[name] = original;
      }
      originals.clear();
      wrappedMethods.clear();
    },
    capacity() {
      return capacity;
    },
    size() {
      return buffer.length;
    },
  };
}
