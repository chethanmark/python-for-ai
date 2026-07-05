/**
 * =============================================================================
 * GLOBAL EVENT BUS
 * scripts/core/events.js
 * -----------------------------------------------------------------------------
 * Central publish/subscribe event system for the Python for AI educational
 * platform. Every module communicates through this bus — no component imports
 * another component directly. This is the single integration point that keeps
 * the entire architecture loosely coupled.
 *
 * ARCHITECTURE:
 *   EventBus (default export)
 *     ├─ ListenerRegistry   — stores listeners per event name, with priority
 *     │                       ordering, once-semantics, and weak-map metadata
 *     ├─ MiddlewareChain    — ordered pipeline of middleware fns; each can
 *     │                       inspect, modify, or cancel an event before
 *     │                       listeners are called
 *     ├─ EventHistory       — ring-buffer of emitted events with timestamps,
 *     │                       duration, and source labels
 *     └─ DeliveryScheduler  — per-event debounce and throttle wrappers,
 *                             living on the bus instance so they can be
 *                             cancelled on destroy()
 *
 * LISTENER PRIORITY:
 *   on(event, listener, { priority: 10 }) registers a listener with a numeric
 *   priority. Higher numbers run first. Default priority is 0. Within the same
 *   priority tier, registration order is preserved (FIFO).
 *
 * MIDDLEWARE CONTRACT:
 *   use(fn) appends fn to the middleware chain. Each middleware receives:
 *     { event, payload, source, timestamp }
 *   and must call next(modifiedPayload?) to continue, or return without calling
 *   next() to cancel the event entirely. Modifying payload creates a new object
 *   (middleware must not mutate the original).
 *
 * WILDCARD LISTENERS:
 *   on('*', listener) receives every event. Useful for logging and devtools.
 *   on('router:*', listener) receives every router:x event (prefix wildcard).
 *
 * NAMESPACED EVENTS:
 *   Namespaces are the portion before the first colon — e.g. the namespace of
 *   'progress:updated' is 'progress'. removeAllListeners('progress') removes
 *   every listener in that namespace. listenerCount('quiz') returns the total
 *   for all quiz:* events.
 *
 * DEBOUNCE / THROTTLE HOOKS:
 *   debounce(event, ms) — wraps the emit for one event in a debounce. All calls
 *     to emit(event, payload) within the window are coalesced to the last call.
 *   throttle(event, ms) — wraps emit with a throttle. The first call fires
 *     immediately; subsequent calls within the window are dropped (not delayed).
 *
 * ERROR ISOLATION:
 *   Every listener is called inside a try/catch. A failing listener never
 *   prevents subsequent listeners from receiving the event. Errors are reported
 *   via the internal 'bus:error' event (not re-thrown).
 *
 * MAX LISTENERS:
 *   Configurable via EVENT_DEFAULTS.MAX_LISTENERS. When the count for an event
 *   exceeds this threshold a warning is emitted — this guards against listener
 *   leaks from missing cleanup in SPA page transitions.
 *
 * EVENT HISTORY AND REPLAY:
 *   The last N events (configurable) are stored in a ring buffer. replay(event)
 *   re-emits the most recent payload for that event to newly registered
 *   listeners. clearHistory() wipes the buffer.
 *
 * GLOBAL REGISTRATION:
 *   The initialised bus is exposed as window.__pyaiEvents so every component
 *   can call window.__pyaiEvents.emit(name, detail) without importing this
 *   module directly (matching the existing contract in all prior components).
 *
 * USAGE (scripts/main.js):
 *
 *   import EventBus, { APP_EVENTS } from './core/events.js';
 *
 *   const bus = new EventBus({ maxListeners: 20, historySize: 100 });
 *   bus.initialize();
 *
 *   // Subscribe
 *   const unsub = bus.on(APP_EVENTS.ROUTER.NAVIGATED, (payload) => {
 *     console.log('Navigated to', payload.pathname);
 *   });
 *   unsub(); // remove listener
 *
 *   // Emit
 *   bus.emit(APP_EVENTS.QUIZ.SUBMITTED, { score: 9, total: 10 });
 *
 *   // Async emit (awaits all async listeners)
 *   await bus.emitAsync(APP_EVENTS.STATE.INIT, { state });
 *
 *   // Wildcard
 *   bus.on('*', ({ event, payload }) => console.log(event, payload));
 *
 *   // Debounce the editor:changed event
 *   bus.debounce(APP_EVENTS.EDITOR.CHANGED, 300);
 *
 *   // Replay last known payload for an event to a new subscriber
 *   bus.on(APP_EVENTS.STATE.UPDATED, handler);
 *   bus.replay(APP_EVENTS.STATE.UPDATED); // fires handler with last payload
 *
 *   // Middleware
 *   bus.use(({ event, payload, source, timestamp }, next) => {
 *     console.log(`[Bus] ${event}`, payload);
 *     next(); // continue
 *   });
 *
 * EXPORTS:
 *   EventBus       — primary class (default export)
 *   APP_EVENTS     — canonical event name catalogue for all modules
 *   EVENT_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// APP_EVENTS — canonical event name catalogue
// ---------------------------------------------------------------------------

/**
 * Complete catalogue of all event names used across the application.
 * Every module uses these constants instead of raw strings, preventing
 * typo-driven silent failures.
 *
 * Naming convention: DOMAIN:action in kebab-case.
 * The object is deeply frozen so no module can accidentally mutate a key.
 *
 * @type {Readonly<object>}
 */
export const APP_EVENTS = Object.freeze({

  // ── Application lifecycle ────────────────────────────────────────────────
  APP: Object.freeze({
    INIT:        'app:init',
    READY:       'app:ready',
    ERROR:       'app:error',
    DESTROY:     'app:destroy',
    ONLINE:      'app:online',
    OFFLINE:     'app:offline',
    VISIBILITY:  'app:visibility',
  }),

  // ── Router ───────────────────────────────────────────────────────────────
  ROUTER: Object.freeze({
    INIT:             'router:init',
    BEFORE_NAVIGATE:  'router:beforeNavigate',
    AFTER_NAVIGATE:   'router:afterNavigate',
    NAVIGATED:        'router:navigated',
    NOT_FOUND:        'router:notFound',
    ERROR:            'router:error',
    DESTROY:          'router:destroy',
  }),

  // ── State store ──────────────────────────────────────────────────────────
  STATE: Object.freeze({
    INIT:    'state:init',
    UPDATED: 'state:updated',
    RESET:   'state:reset',
    ERROR:   'state:error',
    DESTROY: 'state:destroy',
  }),

  // ── Storage ──────────────────────────────────────────────────────────────
  STORAGE: Object.freeze({
    INIT:    'storage:init',
    SET:     'storage:set',
    GET:     'storage:get',
    REMOVE:  'storage:remove',
    CLEAR:   'storage:clear',
    BACKUP:  'storage:backup',
    RESTORE: 'storage:restore',
    ERROR:   'storage:error',
    DESTROY: 'storage:destroy',
  }),

  // ── Dashboard ────────────────────────────────────────────────────────────
  DASHBOARD: Object.freeze({
    MOUNTED:   'dashboard:mounted',
    UPDATED:   'dashboard:updated',
    REFRESH:   'dashboard:refresh',
    ACTION:    'dashboard:action',
    ERROR:     'dashboard:error',
    DESTROYED: 'dashboard:destroyed',
  }),

  // ── Navigation ───────────────────────────────────────────────────────────
  NAVIGATION: Object.freeze({
    MOUNTED:       'nav:mounted',
    THEME_CHANGED: 'nav:theme:changed',
    MENU_OPENED:   'nav:menu:opened',
    MENU_CLOSED:   'nav:menu:closed',
    LINK_ACTIVE:   'nav:link:active',
    DESTROYED:     'nav:destroyed',
  }),

  // ── Header ───────────────────────────────────────────────────────────────
  HEADER: Object.freeze({
    MOUNTED:       'header:mounted',
    SEARCH_OPENED: 'header:search:opened',
    SEARCH_CLOSED: 'header:search:closed',
    SEARCH_QUERY:  'header:search:query',
    DESTROYED:     'header:destroyed',
  }),

  // ── Footer ───────────────────────────────────────────────────────────────
  FOOTER: Object.freeze({
    MOUNTED:           'footer:mounted',
    NEWSLETTER_SUBMIT: 'footer:newsletter:submit',
    THEME_TOGGLE:      'footer:theme:toggle',
    DESTROYED:         'footer:destroyed',
  }),

  // ── Progress tracker ─────────────────────────────────────────────────────
  PROGRESS: Object.freeze({
    UPDATED:              'progress:updated',
    XP_GAINED:            'progress:xp:gained',
    LEVEL_UP:             'progress:level:up',
    TUTORIAL_STARTED:     'progress:tutorial:started',
    TUTORIAL_COMPLETED:   'progress:tutorial:completed',
    QUIZ_ATTEMPTED:       'progress:quiz:attempted',
    PROJECT_UPDATED:      'progress:project:updated',
    ACHIEVEMENT_UNLOCKED: 'progress:achievement:unlocked',
    STREAK_UPDATED:       'progress:streak:updated',
    STREAK_WARNING:       'progress:streak:warning',
    RESET:                'progress:reset',
  }),

  // ── Quiz ─────────────────────────────────────────────────────────────────
  QUIZ: Object.freeze({
    STARTED:          'quiz:started',
    QUESTION_CHANGED: 'quiz:question:changed',
    ANSWERED:         'quiz:answered',
    BOOKMARKED:       'quiz:bookmarked',
    FLAGGED:          'quiz:flagged',
    SKIPPED:          'quiz:skipped',
    TIMER_TICK:       'quiz:timer:tick',
    TIMER_WARNING:    'quiz:timer:warning',
    TIMER_EXPIRED:    'quiz:timer:expired',
    PAUSED:           'quiz:paused',
    RESUMED:          'quiz:resumed',
    SUBMITTED:        'quiz:submitted',
    REVIEW_CHANGED:   'quiz:review:changed',
    RESET:            'quiz:reset',
    CONTINUE:         'quiz:continue',
  }),

  // ── Code editor ──────────────────────────────────────────────────────────
  EDITOR: Object.freeze({
    MOUNTED:    'editor:mounted',
    CHANGED:    'editor:changed',
    SAVED:      'editor:saved',
    RESTORED:   'editor:restored',
    RESET:      'editor:reset',
    COPY:       'editor:copy',
    DOWNLOAD:   'editor:download',
    UPLOAD:     'editor:upload',
    RUN:        'editor:run',
    FULLSCREEN: 'editor:fullscreen',
    WRAP:       'editor:wrap',
  }),

  // ── Achievements ─────────────────────────────────────────────────────────
  ACHIEVEMENT: Object.freeze({
    UNLOCKED:  'achievement:unlocked',
    VIEWED:    'achievement:viewed',
  }),

  // ── Notifications ────────────────────────────────────────────────────────
  NOTIFICATION: Object.freeze({
    ADDED:     'notification:added',
    DISMISSED: 'notification:dismissed',
    CLEARED:   'notification:cleared',
  }),

  // ── Theme ────────────────────────────────────────────────────────────────
  THEME: Object.freeze({
    CHANGED:  'theme:changed',
    RESOLVED: 'theme:resolved',
  }),

  // ── Authentication ───────────────────────────────────────────────────────
  AUTH: Object.freeze({
    LOGIN:       'auth:login',
    LOGOUT:      'auth:logout',
    SESSION:     'auth:session',
    ERROR:       'auth:error',
  }),

  // ── Internal bus events ──────────────────────────────────────────────────
  BUS: Object.freeze({
    ERROR:       'bus:error',
    WARN:        'bus:warn',
    MIDDLEWARE:  'bus:middleware',
  }),
});

// ---------------------------------------------------------------------------
// EVENT_DEFAULTS — default configuration values
// ---------------------------------------------------------------------------

/**
 * @type {Readonly<Record<string, *>>}
 */
export const EVENT_DEFAULTS = Object.freeze({
  /** Maximum listeners per event before a leak warning is emitted */
  MAX_LISTENERS:    20,

  /** Maximum entries in the event history ring buffer */
  HISTORY_SIZE:     200,

  /** Default listener priority (higher = runs first) */
  DEFAULT_PRIORITY: 0,

  /** Whether to log all events to the console in development */
  DEBUG:            false,

  /** Whether to expose the bus instance as window.__pyaiEvents on initialize() */
  EXPOSE_GLOBAL:    true,

  /** Maximum length of the event name for validation */
  MAX_EVENT_NAME_LENGTH: 128,

  /** Symbol used to mark once-listeners for internal cleanup */
  ONCE_SYMBOL:      Symbol('once'),
});

// ---------------------------------------------------------------------------
// Pure utilities (module-private)
// ---------------------------------------------------------------------------

/**
 * Returns a debounced wrapper around a function.
 * Consistent with state.js and router.js debounce implementations.
 * Exposes .flush() and .cancel() on the returned function.
 *
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { flush: () => void, cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer    = null;
  let lastArgs = null;

  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer    = null;
      const a  = lastArgs;
      lastArgs = null;
      fn(...a);
    }, ms);
  };

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      const a  = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer    = null;
    lastArgs = null;
  };

  return debounced;
}

/**
 * Returns a throttled wrapper around a function.
 * The first call fires immediately. Subsequent calls within `ms` are dropped.
 *
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { cancel: () => void }}
 */
function throttle(fn, ms) {
  let last    = 0;
  let timer   = null;

  const throttled = (...args) => {
    const now = Date.now();
    const remaining = ms - (now - last);

    if (remaining <= 0) {
      last = now;
      fn(...args);
    }
    // Drop calls within the throttle window (no trailing call)
  };

  throttled.cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    last = 0;
  };

  return throttled;
}

/**
 * Returns the namespace of an event name (portion before the first colon).
 * e.g. 'progress:updated' → 'progress', 'app:ready' → 'app', 'bare' → 'bare'
 *
 * @param {string} eventName
 * @returns {string}
 */
function getNamespace(eventName) {
  const idx = eventName.indexOf(':');
  return idx === -1 ? eventName : eventName.slice(0, idx);
}

/**
 * Check whether a pattern (potentially a wildcard) matches an event name.
 * Supports:
 *   '*'          — matches everything
 *   'router:*'   — matches all events with namespace 'router'
 *   exact string — matches only that event
 *
 * @param {string} pattern
 * @param {string} eventName
 * @returns {boolean}
 */
function matchesPattern(pattern, eventName) {
  if (pattern === '*') return true;
  if (pattern === eventName) return true;
  if (pattern.endsWith(':*')) {
    const ns = pattern.slice(0, -2);
    return getNamespace(eventName) === ns;
  }
  return false;
}

/**
 * Validate that an event name is a non-empty string within the allowed length.
 *
 * @param {*} name
 * @returns {boolean}
 */
function isValidEventName(name) {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.length <= EVENT_DEFAULTS.MAX_EVENT_NAME_LENGTH;
}

// ---------------------------------------------------------------------------
// ListenerRegistry — manages subscriptions per event
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:       number,
 *   fn:       Function,
 *   priority: number,
 *   once:     boolean,
 *   pattern:  string,
 * }} ListenerEntry
 */

/**
 * Stores and retrieves listeners for every registered event pattern.
 * Listeners within each pattern are maintained in descending priority order
 * so that high-priority listeners always run first without sorting on emit.
 *
 * Internally uses a Map from pattern → ListenerEntry[].
 * Wildcard patterns ('*' and 'ns:*') are stored in a separate list so they
 * can be iterated without scanning every per-event list on every emit.
 */
class ListenerRegistry {
  /** @type {Map<string, ListenerEntry[]>} — pattern → sorted listener list */
  #listeners = new Map();

  /** @type {ListenerEntry[]} — wildcard listeners ('*' and 'ns:*') */
  #wildcards = [];

  /** @type {number} */
  #nextId = 1;

  /** @type {number} */
  #maxListeners;

  /** @type {(warning: string) => void} */
  #onWarn;

  /**
   * @param {number}   maxListeners
   * @param {Function} onWarn — called when a listener count threshold is exceeded
   */
  constructor(maxListeners, onWarn) {
    this.#maxListeners = maxListeners;
    this.#onWarn       = onWarn;
  }

  /**
   * Register a listener.
   *
   * @param {string}   pattern   — Exact event name or wildcard pattern
   * @param {Function} fn
   * @param {{ priority?: number, once?: boolean }} [options]
   * @returns {number} Listener ID (for targeted removal)
   */
  add(pattern, fn, options = {}) {
    const entry = {
      id:       this.#nextId++,
      fn,
      priority: options.priority ?? EVENT_DEFAULTS.DEFAULT_PRIORITY,
      once:     options.once     ?? false,
      pattern,
    };

    const isWildcard = pattern === '*' || pattern.endsWith(':*');

    if (isWildcard) {
      // Insert in priority order (descending)
      const idx = this.#wildcards.findIndex((e) => e.priority < entry.priority);
      if (idx === -1) {
        this.#wildcards.push(entry);
      } else {
        this.#wildcards.splice(idx, 0, entry);
      }
    } else {
      if (!this.#listeners.has(pattern)) {
        this.#listeners.set(pattern, []);
      }
      const list = this.#listeners.get(pattern);
      const idx  = list.findIndex((e) => e.priority < entry.priority);
      if (idx === -1) {
        list.push(entry);
      } else {
        list.splice(idx, 0, entry);
      }

      // Max listener warning
      if (list.length > this.#maxListeners) {
        this.#onWarn(
          `Possible EventBus memory leak: ${list.length} listeners registered for "${pattern}". ` +
          `Max is ${this.#maxListeners}.`
        );
      }
    }

    return entry.id;
  }

  /**
   * Remove a listener by reference or by ID.
   *
   * @param {string}   pattern
   * @param {Function|number} fnOrId
   * @returns {boolean} Whether a listener was found and removed
   */
  remove(pattern, fnOrId) {
    const removeFrom = (list) => {
      const idx = typeof fnOrId === 'number'
        ? list.findIndex((e) => e.id === fnOrId)
        : list.findIndex((e) => e.fn === fnOrId);
      if (idx !== -1) { list.splice(idx, 1); return true; }
      return false;
    };

    const isWildcard = pattern === '*' || pattern.endsWith(':*');
    if (isWildcard) return removeFrom(this.#wildcards);

    const list = this.#listeners.get(pattern);
    if (!list) return false;

    const removed = removeFrom(list);
    if (list.length === 0) this.#listeners.delete(pattern);
    return removed;
  }

  /**
   * Remove a listener by its unique ID across all patterns.
   *
   * @param {number} id
   * @returns {boolean}
   */
  removeById(id) {
    // Check wildcards
    const wIdx = this.#wildcards.findIndex((e) => e.id === id);
    if (wIdx !== -1) { this.#wildcards.splice(wIdx, 1); return true; }

    // Check specific events
    for (const [pattern, list] of this.#listeners) {
      const idx = list.findIndex((e) => e.id === id);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) this.#listeners.delete(pattern);
        return true;
      }
    }
    return false;
  }

  /**
   * Collect all listeners that should receive the given event name.
   * Returns entries in the order they should be called (priority-sorted).
   *
   * Merges:
   *   1. Exact-match listeners for the event name
   *   2. All wildcard/namespace-wildcard listeners that match the event
   *
   * @param {string} eventName
   * @returns {ListenerEntry[]}
   */
  collect(eventName) {
    const exact     = this.#listeners.get(eventName) ?? [];
    const wildcards = this.#wildcards.filter((e) => matchesPattern(e.pattern, eventName));

    if (wildcards.length === 0) return [...exact];
    if (exact.length === 0)     return [...wildcards];

    // Merge two priority-sorted arrays
    const merged = [];
    let i = 0, j = 0;
    while (i < exact.length && j < wildcards.length) {
      if (exact[i].priority >= wildcards[j].priority) {
        merged.push(exact[i++]);
      } else {
        merged.push(wildcards[j++]);
      }
    }
    while (i < exact.length)     merged.push(exact[i++]);
    while (j < wildcards.length) merged.push(wildcards[j++]);
    return merged;
  }

  /**
   * Remove all once-listeners that fired.
   * Called after each emit to clean up exhausted listeners.
   *
   * @param {ListenerEntry[]} fired — The entries that were called during emit
   */
  removeOnce(fired) {
    for (const entry of fired) {
      if (entry.once) this.removeById(entry.id);
    }
  }

  /**
   * Remove all listeners for all patterns in the given namespace,
   * or all listeners if namespace is null/undefined.
   *
   * @param {string|null} namespace
   * @returns {number} Number of listeners removed
   */
  removeAll(namespace = null) {
    let count = 0;

    if (namespace === null) {
      for (const list of this.#listeners.values()) count += list.length;
      count += this.#wildcards.length;
      this.#listeners.clear();
      this.#wildcards = [];
      return count;
    }

    // Namespace removal
    const prefix = namespace + ':';
    for (const [pattern, list] of this.#listeners) {
      if (pattern === namespace || pattern.startsWith(prefix)) {
        count += list.length;
        this.#listeners.delete(pattern);
      }
    }
    const before = this.#wildcards.length;
    this.#wildcards = this.#wildcards.filter((e) => getNamespace(e.pattern) !== namespace);
    count += before - this.#wildcards.length;

    return count;
  }

  /**
   * Count listeners for the given event name (or namespace, or '*' for all).
   *
   * @param {string|null} [nameOrNamespace]
   * @returns {number}
   */
  count(nameOrNamespace = null) {
    if (nameOrNamespace === null) {
      let total = this.#wildcards.length;
      for (const list of this.#listeners.values()) total += list.length;
      return total;
    }

    // Check for namespace pattern ('router' counts 'router', 'router:*', 'router:x')
    const prefix = nameOrNamespace + ':';
    let total = 0;

    const exact = this.#listeners.get(nameOrNamespace);
    if (exact) total += exact.length;

    for (const [pattern, list] of this.#listeners) {
      if (pattern !== nameOrNamespace && pattern.startsWith(prefix)) {
        total += list.length;
      }
    }

    total += this.#wildcards.filter(
      (e) => e.pattern === nameOrNamespace || getNamespace(e.pattern) === nameOrNamespace
    ).length;

    return total;
  }

  /**
   * Return all distinct registered event patterns (not wildcard patterns).
   *
   * @returns {string[]}
   */
  names() {
    return [...this.#listeners.keys()];
  }
}

// ---------------------------------------------------------------------------
// MiddlewareChain — ordered pipeline for event interception
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   event:     string,
 *   payload:   *,
 *   source:    string,
 *   timestamp: number,
 * }} EventContext
 */

/**
 * @typedef {(ctx: EventContext, next: (payload?: *) => void) => void} MiddlewareFn
 */

/**
 * Manages a sequence of middleware functions that are executed for each
 * emitted event before listeners are called.
 *
 * Calling next() with a value replaces the payload for subsequent middleware
 * and ultimately for all listeners.
 * Not calling next() cancels the event: listeners never fire.
 */
class MiddlewareChain {
  /** @type {MiddlewareFn[]} */
  #fns = [];

  /**
   * @param {MiddlewareFn} fn
   */
  use(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('[EventBus] Middleware must be a function.');
    }
    this.#fns.push(fn);
  }

  /**
   * Run the middleware chain for the given context.
   * Resolves with the (possibly modified) final payload, or null if cancelled.
   *
   * @param {EventContext} ctx
   * @returns {Promise<{ ok: boolean, payload: * }>}
   */
  run(ctx) {
    return new Promise((resolve) => {
      if (this.#fns.length === 0) {
        resolve({ ok: true, payload: ctx.payload });
        return;
      }

      let idx     = 0;
      let payload = ctx.payload;

      const next = (modifiedPayload) => {
        if (modifiedPayload !== undefined) {
          payload = modifiedPayload;
        }

        if (idx >= this.#fns.length) {
          resolve({ ok: true, payload });
          return;
        }

        const fn = this.#fns[idx++];
        try {
          fn({ ...ctx, payload }, next);
        } catch (err) {
          console.error('[EventBus] Middleware threw:', err);
          resolve({ ok: false, payload });
        }
      };

      next();
    });
  }

  clear() { this.#fns = []; }

  /** @returns {number} */
  get size() { return this.#fns.length; }
}

// ---------------------------------------------------------------------------
// EventHistory — ring buffer of recent events
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:        number,
 *   event:     string,
 *   payload:   *,
 *   source:    string,
 *   timestamp: number,
 *   duration:  number,   — ms taken to call all listeners
 * }} HistoryEntry
 */

/**
 * Fixed-capacity ring buffer that stores the most recent N events.
 * When the buffer is full the oldest entry is overwritten.
 * O(1) push, O(N) search.
 */
class EventHistory {
  /** @type {HistoryEntry[]} */
  #buf;

  /** @type {number} */
  #head = 0;

  /** @type {number} */
  #size = 0;

  /** @type {number} */
  #capacity;

  /** @type {number} */
  #nextId = 1;

  /** @param {number} capacity */
  constructor(capacity = EVENT_DEFAULTS.HISTORY_SIZE) {
    this.#capacity = Math.max(1, capacity);
    this.#buf      = new Array(this.#capacity);
  }

  /**
   * Add an entry to the ring buffer.
   *
   * @param {Omit<HistoryEntry, 'id'>} entry
   * @returns {HistoryEntry}
   */
  push(entry) {
    const record = { ...entry, id: this.#nextId++ };
    this.#buf[this.#head] = record;
    this.#head  = (this.#head + 1) % this.#capacity;
    if (this.#size < this.#capacity) this.#size++;
    return record;
  }

  /**
   * Return the most recent entry for the given event name, or null.
   *
   * @param {string} eventName
   * @returns {HistoryEntry|null}
   */
  last(eventName) {
    // Iterate backwards from the most recent write position
    for (let i = 1; i <= this.#size; i++) {
      const idx   = (this.#head - i + this.#capacity) % this.#capacity;
      const entry = this.#buf[idx];
      if (entry?.event === eventName) return entry;
    }
    return null;
  }

  /**
   * Return all history entries in chronological order (oldest first).
   *
   * @param {string|null} [eventName] — Filter by event name (null = all)
   * @returns {HistoryEntry[]}
   */
  all(eventName = null) {
    const start  = this.#size < this.#capacity
      ? 0
      : this.#head;

    const result = [];
    for (let i = 0; i < this.#size; i++) {
      const idx   = (start + i) % this.#capacity;
      const entry = this.#buf[idx];
      if (entry && (eventName === null || entry.event === eventName)) {
        result.push(entry);
      }
    }
    return result;
  }

  /** Clear the ring buffer. */
  clear() {
    this.#buf  = new Array(this.#capacity);
    this.#head = 0;
    this.#size = 0;
  }

  /** @returns {number} Number of entries currently in the buffer */
  get size() { return this.#size; }

  /** @returns {number} Maximum capacity */
  get capacity() { return this.#capacity; }
}

// ---------------------------------------------------------------------------
// DeliveryScheduler — per-event debounce and throttle wrappers
// ---------------------------------------------------------------------------

/**
 * Manages debounce and throttle wrappers for individual event names.
 * When an event has a registered wrapper, calls to emit(event, payload) are
 * routed through the wrapper instead of firing immediately.
 *
 * All wrappers are cancelled and removed on destroy().
 */
class DeliveryScheduler {
  /**
   * @type {Map<string, {
   *   type:    'debounce' | 'throttle',
   *   ms:      number,
   *   wrapped: Function & { flush?: Function, cancel: Function },
   *   rawEmit: (event: string, payload: *) => void,
   * }>}
   */
  #wrappers = new Map();

  /**
   * Register a debounce wrapper for the given event name.
   * If a wrapper already exists for this event it is replaced.
   *
   * @param {string}   eventName
   * @param {number}   ms
   * @param {(event: string, payload: *) => void} rawEmit
   */
  setDebounce(eventName, ms, rawEmit) {
    this.#cancel(eventName);
    const wrapped = debounce((payload) => rawEmit(eventName, payload), ms);
    this.#wrappers.set(eventName, { type: 'debounce', ms, wrapped, rawEmit });
  }

  /**
   * Register a throttle wrapper for the given event name.
   *
   * @param {string}   eventName
   * @param {number}   ms
   * @param {(event: string, payload: *) => void} rawEmit
   */
  setThrottle(eventName, ms, rawEmit) {
    this.#cancel(eventName);
    const wrapped = throttle((payload) => rawEmit(eventName, payload), ms);
    this.#wrappers.set(eventName, { type: 'throttle', ms, wrapped, rawEmit });
  }

  /**
   * Remove the wrapper for an event (restores direct emit).
   *
   * @param {string} eventName
   */
  remove(eventName) {
    this.#cancel(eventName);
    this.#wrappers.delete(eventName);
  }

  /**
   * Check whether the event has a registered delivery wrapper.
   *
   * @param {string} eventName
   * @returns {boolean}
   */
  has(eventName) {
    return this.#wrappers.has(eventName);
  }

  /**
   * Route a call through the wrapper for the given event.
   * The caller must verify has(eventName) before calling dispatch().
   *
   * @param {string} eventName
   * @param {*}      payload
   */
  dispatch(eventName, payload) {
    this.#wrappers.get(eventName)?.wrapped(payload);
  }

  /**
   * Flush all pending debounced events immediately.
   */
  flushAll() {
    for (const wrapper of this.#wrappers.values()) {
      if (wrapper.type === 'debounce') {
        wrapper.wrapped.flush?.();
      }
    }
  }

  /**
   * Cancel and clean up all wrappers.
   */
  destroyAll() {
    for (const eventName of this.#wrappers.keys()) {
      this.#cancel(eventName);
    }
    this.#wrappers.clear();
  }

  #cancel(eventName) {
    const existing = this.#wrappers.get(eventName);
    if (existing) existing.wrapped.cancel?.();
  }
}

// ---------------------------------------------------------------------------
// EventBus — primary class
// ---------------------------------------------------------------------------

/**
 * Global publish/subscribe event bus.
 *
 * Lifecycle:
 *   1. new EventBus(config)          — no side-effects
 *   2. .initialize()                 — exposes global, runs startup middleware,
 *                                       emits bus:ready
 *   3. .on() / .once()               — subscribe
 *   4. .emit() / .emitAsync()        — publish
 *   5. .off() / .removeAllListeners() — unsubscribe
 *   6. .destroy()                    — flush debounces, clear all listeners
 */
export default class EventBus {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   maxListeners:  number,
   *   historySize:   number,
   *   debug:         boolean,
   *   exposeGlobal:  boolean,
   * }}
   */
  #config;

  // ---- Sub-systems ---------------------------------------------------------

  /** @type {ListenerRegistry}   */ #registry;
  /** @type {MiddlewareChain}    */ #middleware;
  /** @type {EventHistory}       */ #history;
  /** @type {DeliveryScheduler}  */ #scheduler;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean} */ #initialised = false;
  /** @type {boolean} */ #destroyed   = false;

  // ---- Statistics ----------------------------------------------------------

  /**
   * Aggregate emit statistics. Updated after every successful emit.
   *
   * @type {{
   *   totalEmits:    number,
   *   cancelledEmits: number,
   *   errorCount:    number,
   *   listenerCalls: number,
   *   eventCounts:   Map<string, number>,
   * }}
   */
  #stats = {
    totalEmits:     0,
    cancelledEmits: 0,
    errorCount:     0,
    listenerCalls:  0,
    eventCounts:    new Map(),
  };

  // ---- Cleanup -------------------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   maxListeners?: number,
   *   historySize?:  number,
   *   debug?:        boolean,
   *   exposeGlobal?: boolean,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      maxListeners:  config.maxListeners  ?? EVENT_DEFAULTS.MAX_LISTENERS,
      historySize:   config.historySize   ?? EVENT_DEFAULTS.HISTORY_SIZE,
      debug:         config.debug         ?? EVENT_DEFAULTS.DEBUG,
      exposeGlobal:  config.exposeGlobal  ?? EVENT_DEFAULTS.EXPOSE_GLOBAL,
    });

    this.#registry   = new ListenerRegistry(
      this.#config.maxListeners,
      (warning) => this.#warn(warning)
    );
    this.#middleware  = new MiddlewareChain();
    this.#history     = new EventHistory(this.#config.historySize);
    this.#scheduler   = new DeliveryScheduler();
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Initialise the event bus.
   * Attaches accessibility preference listeners and optionally registers
   * the bus instance on window.__pyaiEvents for global access.
   *
   * @returns {EventBus} this — for chaining
   */
  initialize() {
    if (this.#initialised) return this;
    this.#assertAlive();

    // Expose on window so all components can call window.__pyaiEvents.emit(...)
    if (this.#config.exposeGlobal && typeof window !== 'undefined') {
      window.__pyaiEvents = this;
    }

    // Accessibility: emit APP_EVENTS.APP.VISIBILITY when the page visibility changes
    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        this.emit(APP_EVENTS.APP.VISIBILITY, {
          hidden:  document.hidden,
          state:   document.visibilityState,
        });
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.#cleanupFns.push(() =>
        document.removeEventListener('visibilitychange', onVisibility)
      );
    }

    // Network online/offline events
    if (typeof window !== 'undefined') {
      const onOnline  = () => this.emit(APP_EVENTS.APP.ONLINE,  { online: true  });
      const onOffline = () => this.emit(APP_EVENTS.APP.OFFLINE, { online: false });
      window.addEventListener('online',  onOnline);
      window.addEventListener('offline', onOffline);
      this.#cleanupFns.push(() => {
        window.removeEventListener('online',  onOnline);
        window.removeEventListener('offline', onOffline);
      });
    }

    // Accessibility: track reduced-motion preference changes
    if (typeof window !== 'undefined') {
      const mqMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (mqMotion?.addEventListener) {
        const onMotion = (e) => {
          this.emit(APP_EVENTS.THEME.CHANGED, {
            type:          'reduced-motion',
            reducedMotion: e.matches,
          });
        };
        mqMotion.addEventListener('change', onMotion);
        this.#cleanupFns.push(() => mqMotion.removeEventListener('change', onMotion));
      }
    }

    this.#initialised = true;
    return this;
  }

  /**
   * Flush all pending debounced events, remove all listeners, cancel
   * all delivery wrappers, and tear down the global reference.
   */
  destroy() {
    if (this.#destroyed) return;

    // Flush pending debounced events before teardown
    this.#scheduler.flushAll();
    this.#scheduler.destroyAll();

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    this.#registry.removeAll();
    this.#middleware.clear();
    this.#history.clear();

    // Remove global reference
    if (this.#config.exposeGlobal && typeof window !== 'undefined') {
      if (window.__pyaiEvents === this) {
        delete window.__pyaiEvents;
      }
    }

    this.#destroyed   = true;
    this.#initialised = false;
  }

  // ---- Public API: subscription -------------------------------------------

  /**
   * Register a listener for the given event name or wildcard pattern.
   *
   * @param {string}   event    — Exact event name, 'ns:*', or '*'
   * @param {(payload: *) => void | Promise<void>} listener
   * @param {{
   *   priority?: number,    — Higher values run first (default: 0)
   *   replay?:   boolean,   — If true, immediately call with last known payload
   *   source?:   string,    — Label for debugging
   * }} [options={}]
   * @returns {() => void} Unsubscribe function — call to remove this listener
   */
  on(event, listener, options = {}) {
    this.#assertAlive();
    this.#assertValidEvent(event);

    if (typeof listener !== 'function') {
      throw new TypeError(`[EventBus] Listener for "${event}" must be a function.`);
    }

    const id = this.#registry.add(event, listener, {
      priority: options.priority ?? EVENT_DEFAULTS.DEFAULT_PRIORITY,
      once:     false,
    });

    // Replay the last known payload if requested
    if (options.replay) {
      const last = this.#history.last(event);
      if (last) {
        // Async-safe: dispatch on next microtask so the caller receives
        // the unsubscribe function first before the listener fires
        Promise.resolve().then(() => {
          if (!this.#destroyed) {
            this.#callListener({ id, fn: listener, priority: options.priority ?? 0, once: false, pattern: event }, last.payload, event);
          }
        });
      }
    }

    if (this.#config.debug) {
      console.debug(`[EventBus] on("${event}") registered — id=${id}`);
    }

    return () => this.#registry.removeById(id);
  }

  /**
   * Register a listener that auto-removes itself after the first call.
   *
   * @param {string}   event
   * @param {(payload: *) => void | Promise<void>} listener
   * @param {{ priority?: number, replay?: boolean }} [options={}]
   * @returns {() => void} Cancel function — removes the listener before it fires
   */
  once(event, listener, options = {}) {
    this.#assertAlive();
    this.#assertValidEvent(event);

    if (typeof listener !== 'function') {
      throw new TypeError(`[EventBus] Once-listener for "${event}" must be a function.`);
    }

    const id = this.#registry.add(event, listener, {
      priority: options.priority ?? EVENT_DEFAULTS.DEFAULT_PRIORITY,
      once:     true,
    });

    if (options.replay) {
      const last = this.#history.last(event);
      if (last) {
        Promise.resolve().then(() => {
          if (!this.#destroyed) {
            this.#callListener({ id, fn: listener, priority: options.priority ?? 0, once: true, pattern: event }, last.payload, event);
            this.#registry.removeById(id);
          }
        });
      }
    }

    return () => this.#registry.removeById(id);
  }

  /**
   * Remove a specific listener for the given event.
   *
   * @param {string}           event
   * @param {Function|number}  listenerOrId — The original listener fn or its ID
   * @returns {boolean} Whether the listener was found and removed
   */
  off(event, listenerOrId) {
    this.#assertAlive();
    return this.#registry.remove(event, listenerOrId);
  }

  /**
   * Remove all listeners.
   * If a namespace string is provided, removes only listeners in that namespace.
   *
   * @param {string|null} [namespace] — e.g. 'quiz', 'progress', or null for all
   * @returns {number} Number of listeners removed
   */
  removeAllListeners(namespace = null) {
    this.#assertAlive();
    return this.#registry.removeAll(namespace);
  }

  // ---- Public API: middleware ----------------------------------------------

  /**
   * Register a global middleware function.
   * Middleware runs before listeners for every emitted event.
   *
   * @param {MiddlewareFn} fn
   * @returns {EventBus} this
   */
  use(fn) {
    this.#assertAlive();
    this.#middleware.use(fn);
    return this;
  }

  // ---- Public API: emission -----------------------------------------------

  /**
   * Emit an event synchronously.
   * Middleware runs first; if middleware calls next(), listeners are invoked
   * in priority order. Listener errors are isolated — they never prevent
   * other listeners from receiving the event.
   *
   * @param {string} event
   * @param {*}      [payload={}]
   * @param {{ source?: string }} [options={}]
   * @returns {boolean} True if any listeners received the event
   */
  emit(event, payload = {}, options = {}) {
    this.#assertAlive();

    if (!isValidEventName(event)) {
      this.#warn(`emit(): "${event}" is not a valid event name.`);
      return false;
    }

    // Route through delivery wrapper if one is registered
    if (this.#scheduler.has(event)) {
      this.#scheduler.dispatch(event, payload);
      return true;
    }

    this.#rawEmit(event, payload, options.source ?? 'unknown');
    return true;
  }

  /**
   * Emit an event and wait for all async listeners to settle.
   * Middleware runs asynchronously before listeners are called.
   * Listener errors are isolated and collected in the returned result.
   *
   * @param {string} event
   * @param {*}      [payload={}]
   * @param {{ source?: string }} [options={}]
   * @returns {Promise<{ event: string, listenerCount: number, errors: Error[] }>}
   */
  async emitAsync(event, payload = {}, options = {}) {
    this.#assertAlive();

    if (!isValidEventName(event)) {
      this.#warn(`emitAsync(): "${event}" is not a valid event name.`);
      return { event, listenerCount: 0, errors: [] };
    }

    return this.#rawEmitAsync(event, payload, options.source ?? 'unknown');
  }

  // ---- Public API: delivery wrappers ---------------------------------------

  /**
   * Wrap the emission of an event in a debounce.
   * All calls to emit(event, payload) within `ms` are coalesced to the last.
   * The wrapper is applied BEFORE middleware runs.
   *
   * @param {string} event
   * @param {number} ms
   * @returns {EventBus} this
   */
  debounce(event, ms) {
    this.#assertAlive();
    this.#assertValidEvent(event);
    this.#scheduler.setDebounce(event, ms, (ev, payload) => this.#rawEmit(ev, payload, 'debounce'));
    return this;
  }

  /**
   * Wrap the emission of an event in a throttle.
   *
   * @param {string} event
   * @param {number} ms
   * @returns {EventBus} this
   */
  throttle(event, ms) {
    this.#assertAlive();
    this.#assertValidEvent(event);
    this.#scheduler.setThrottle(event, ms, (ev, payload) => this.#rawEmit(ev, payload, 'throttle'));
    return this;
  }

  /**
   * Remove a debounce or throttle wrapper from an event.
   *
   * @param {string} event
   * @returns {EventBus} this
   */
  clearWrapper(event) {
    this.#scheduler.remove(event);
    return this;
  }

  // ---- Public API: history and replay -------------------------------------

  /**
   * Return the full event history, optionally filtered by event name.
   *
   * @param {string|null} [event]
   * @returns {HistoryEntry[]}
   */
  history(event = null) {
    return this.#history.all(event);
  }

  /**
   * Clear the event history ring buffer.
   */
  clearHistory() {
    this.#history.clear();
  }

  /**
   * Re-emit the most recent payload for the given event to all current listeners.
   * If no history entry exists for the event this is a no-op.
   *
   * @param {string} event
   * @param {{ source?: string }} [options={}]
   * @returns {boolean} True if a history entry was found and replayed
   */
  replay(event, options = {}) {
    this.#assertAlive();

    const last = this.#history.last(event);
    if (!last) return false;

    this.#rawEmit(event, last.payload, options.source ?? 'replay');
    return true;
  }

  // ---- Public API: introspection ------------------------------------------

  /**
   * Return the listener count for an event, namespace, or total.
   *
   * @param {string|null} [eventOrNamespace]
   * @returns {number}
   */
  listenerCount(eventOrNamespace = null) {
    return this.#registry.count(eventOrNamespace);
  }

  /**
   * Return all registered non-wildcard event names.
   *
   * @returns {string[]}
   */
  eventNames() {
    return this.#registry.names();
  }

  /**
   * Return aggregate emit statistics.
   *
   * @returns {{
   *   totalEmits:     number,
   *   cancelledEmits: number,
   *   errorCount:     number,
   *   listenerCalls:  number,
   *   topEvents:      Array<{ event: string, count: number }>,
   * }}
   */
  stats() {
    const topEvents = [...this.#stats.eventCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([event, count]) => ({ event, count }));

    return {
      totalEmits:     this.#stats.totalEmits,
      cancelledEmits: this.#stats.cancelledEmits,
      errorCount:     this.#stats.errorCount,
      listenerCalls:  this.#stats.listenerCalls,
      topEvents,
    };
  }

  /** @returns {boolean} */
  get isInitialised() { return this.#initialised; }

  /** @returns {boolean} */
  get isDestroyed() { return this.#destroyed; }

  // ---- Private: raw emit (synchronous) ------------------------------------

  /**
   * Core synchronous emission path — bypasses delivery wrappers.
   * Runs middleware, then calls all matching listeners.
   *
   * @param {string} event
   * @param {*}      payload
   * @param {string} source
   */
  #rawEmit(event, payload, source) {
    const ts      = Date.now();
    const ctx     = { event, payload, source, timestamp: ts };
    const entries = this.#registry.collect(event);

    // Update event count stats
    this.#stats.totalEmits++;
    this.#stats.eventCounts.set(event, (this.#stats.eventCounts.get(event) ?? 0) + 1);

    // Debug logging
    if (this.#config.debug) {
      console.debug(`[EventBus] emit("${event}")`, payload, `[${entries.length} listener(s)]`);
    }

    // Run middleware synchronously by firing and not awaiting
    // (for async middleware use emitAsync)
    let finalPayload = payload;
    let cancelled    = false;

    if (this.#middleware.size > 0) {
      // Synchronous middleware: we kick off the Promise chain and use a flag
      // to detect synchronous cancellation. If the chain is async the listeners
      // receive the original payload (use emitAsync for async middleware).
      let resolved = false;
      this.#middleware.run(ctx).then((result) => {
        resolved = true;
        if (!result.ok) { cancelled = true; return; }
        finalPayload = result.payload;
      });
      // If the middleware chain resolved synchronously (all fns were sync),
      // we use the resolved values; otherwise the listeners see the original payload.
      if (!resolved) {
        // Async middleware — listeners run immediately with original payload.
        // Callers who need async middleware must use emitAsync().
      }
    }

    if (cancelled) {
      this.#stats.cancelledEmits++;
      return;
    }

    const fired        = [];
    const startTime    = performance.now();

    for (const entry of entries) {
      this.#callListener(entry, finalPayload, event);
      fired.push(entry);
      this.#stats.listenerCalls++;
    }

    const duration = performance.now() - startTime;

    // Remove once-listeners
    this.#registry.removeOnce(fired);

    // Record in history
    this.#history.push({ event, payload: finalPayload, source, timestamp: ts, duration });
  }

  // ---- Private: raw emit (asynchronous) -----------------------------------

  /**
   * Core asynchronous emission path.
   * Awaits the middleware chain, then calls listeners concurrently,
   * collecting any errors.
   *
   * @param {string} event
   * @param {*}      payload
   * @param {string} source
   * @returns {Promise<{ event: string, listenerCount: number, errors: Error[] }>}
   */
  async #rawEmitAsync(event, payload, source) {
    const ts      = Date.now();
    const ctx     = { event, payload, source, timestamp: ts };
    const entries = this.#registry.collect(event);

    this.#stats.totalEmits++;
    this.#stats.eventCounts.set(event, (this.#stats.eventCounts.get(event) ?? 0) + 1);

    if (this.#config.debug) {
      console.debug(`[EventBus] emitAsync("${event}")`, payload, `[${entries.length} listener(s)]`);
    }

    // Run middleware
    const mwResult = await this.#middleware.run(ctx);
    if (!mwResult.ok) {
      this.#stats.cancelledEmits++;
      return { event, listenerCount: 0, errors: [] };
    }

    const finalPayload = mwResult.payload;
    const errors       = [];
    const startTime    = performance.now();

    // Call listeners concurrently but isolate each
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const result = entry.fn(finalPayload);
          if (result instanceof Promise) await result;
          this.#stats.listenerCalls++;
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
          this.#stats.errorCount++;
          this.#emitBusError(event, err);
        }
      })
    );

    const duration = performance.now() - startTime;

    // Remove once-listeners that fired
    this.#registry.removeOnce(entries);

    // Record in history
    this.#history.push({ event, payload: finalPayload, source, timestamp: ts, duration });

    return { event, listenerCount: entries.length, errors };
  }

  // ---- Private: single listener call (sync, isolated) ---------------------

  /**
   * Call a single listener function, isolating any error it throws.
   *
   * @param {ListenerEntry} entry
   * @param {*}             payload
   * @param {string}        event
   */
  #callListener(entry, payload, event) {
    try {
      entry.fn(payload);
    } catch (err) {
      this.#stats.errorCount++;
      this.#emitBusError(event, err);
    }
  }

  // ---- Private: error / warning helpers -----------------------------------

  /**
   * Emit a bus:error event and log to the console.
   * Deliberately does NOT re-enter the normal emit path (to prevent recursion).
   *
   * @param {string}   event   — The event that caused the error
   * @param {Error|*}  error
   */
  #emitBusError(event, error) {
    console.error(`[EventBus] Listener error on "${event}":`, error);

    // Directly call bus:error listeners (bypassing middleware/scheduler/history)
    const busErrorListeners = this.#registry.collect(APP_EVENTS.BUS.ERROR);
    for (const entry of busErrorListeners) {
      try {
        entry.fn({ event, error });
      } catch {
        // Swallow — error listeners must not throw
      }
    }
    this.#registry.removeOnce(busErrorListeners);
  }

  /**
   * Emit a bus:warn event and log to the console.
   *
   * @param {string} message
   */
  #warn(message) {
    console.warn(`[EventBus] ${message}`);

    const busWarnListeners = this.#registry.collect(APP_EVENTS.BUS.WARN);
    for (const entry of busWarnListeners) {
      try {
        entry.fn({ message });
      } catch {
        // Swallow
      }
    }
    this.#registry.removeOnce(busWarnListeners);
  }

  // ---- Private: validation ------------------------------------------------

  /**
   * Throw if the bus has been destroyed.
   */
  #assertAlive() {
    if (this.#destroyed) {
      throw new Error(
        '[EventBus] Cannot use a destroyed EventBus instance. Create a new one.'
      );
    }
  }

  /**
   * Throw if the event name is invalid.
   *
   * @param {*} event
   */
  #assertValidEvent(event) {
    if (!isValidEventName(event)) {
      throw new TypeError(
        `[EventBus] "${String(event)}" is not a valid event name. ` +
        `Must be a non-empty string of at most ${EVENT_DEFAULTS.MAX_EVENT_NAME_LENGTH} characters.`
      );
    }
  }
}