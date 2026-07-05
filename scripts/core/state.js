/**
 * =============================================================================
 * CENTRALISED STATE MANAGEMENT
 * scripts/core/state.js
 * -----------------------------------------------------------------------------
 * Single source of truth for the entire Python for AI educational platform.
 * Implements a Redux/Zustand-inspired reactive state store in pure Vanilla JS.
 *
 * ARCHITECTURE:
 *   StateStore (default export)
 *     ├─ StateHistory     — undo/redo stack with time-travel support
 *     ├─ ComputedRegistry — memoised derived values (computed state)
 *     ├─ MiddlewareChain  — pre/post update hooks
 *     └─ PersistenceAdapter — localStorage with schema migration
 *
 * STATE TREE (application-wide shape):
 *   {
 *     user:      { id, name, email, avatar, isGuest }
 *     theme:     { mode, resolvedMode, accentColor }
 *     dashboard: { xp, level, progressPct, achievements, streak, notifications }
 *     learning:  { currentLesson, completedLessons, bookmarks, recentActivity }
 *     quiz:      { current, score, attempts, answers, statistics }
 *     editor:    { code, language, output, executionHistory, isDirty }
 *     projects:  { completed, inProgress, favourites, totalCompleted }
 *     settings:  { fontSize, animations, reducedMotion, highContrast, keyboardMode }
 *     app:       { loading, initialised, errors, version, online }
 *   }
 *
 * UPDATE CONTRACT:
 *   All mutations go through setState() or update().
 *   Both methods produce a NEW state object — the previous state is never mutated.
 *   Structural sharing is used: unchanged subtrees retain their object references,
 *   so downstream === comparisons remain valid for change detection.
 *
 * SUBSCRIPTION MODEL:
 *   Subscribers can listen to the full state or a specific slice path.
 *   Path-based subscriptions only fire when the selected value changes,
 *   preventing unnecessary re-renders in components.
 *
 * UNDO / REDO:
 *   Every setState/update call pushes the previous state onto the undo stack
 *   (up to HISTORY_LIMIT entries). Undo() pops from undo → current → redo.
 *   Redo() pops from redo → current. Any new setState() clears the redo stack.
 *
 * COMPUTED STATE:
 *   register(key, selector) defines a lazily-evaluated derived value.
 *   Computed values are memoised: they only recalculate when their dependencies
 *   change. Access via store.computed(key).
 *
 * MIDDLEWARE:
 *   use(fn) registers a middleware called before and after each state update.
 *   Middleware signature: ({ type, payload, prevState, nextState }) => void
 *
 * PERSISTENCE:
 *   Configurable slices of state are persisted to localStorage.
 *   Schema versioning with forward migration ensures upgrades are safe.
 *   Each persist write is debounced to avoid thrashing storage on rapid updates.
 *
 * INTEGRATION POINTS:
 *   • progress-tracker.js writes xp/level/streak/achievements to the store
 *     via store.update('dashboard', progressTracker.getSummary())
 *   • quiz.js writes quiz state via store.update('quiz', { ... })
 *   • code-editor.js writes editor state via store.update('editor', { ... })
 *   • router.js reads theme and user from store for route guards
 *   • dashboard.js subscribes to 'dashboard' slice for reactive re-renders
 *   • navigation.js reads theme.mode for initial render
 *   • All components dispatch events through the store's event bus bridge
 *
 * EVENT EMISSIONS:
 *   state:init      { state }
 *   state:updated   { path, prevValue, nextValue, state }
 *   state:reset     { state }
 *   state:error     { message, error }
 *   state:destroy   {}
 *
 * USAGE (scripts/main.js):
 *
 *   import StateStore, { STATE_EVENTS } from './core/state.js';
 *
 *   const store = new StateStore({ persist: ['user', 'settings', 'theme'] });
 *   await store.initialize();
 *
 *   // Read
 *   const user = store.getUser();
 *   const xp   = store.getState().dashboard.xp;
 *
 *   // Write (immutable — returns new state)
 *   store.update('user', { name: 'Ada' });
 *   store.setState({ app: { loading: false } });
 *
 *   // Subscribe to a slice
 *   const unsub = store.subscribe('dashboard', (dashboard) => {
 *     console.log('Dashboard updated:', dashboard);
 *   });
 *   unsub(); // clean up
 *
 *   // Computed
 *   store.registerComputed('displayName', (s) =>
 *     s.user.name || 'Anonymous Learner'
 *   );
 *   store.computed('displayName'); // 'Ada'
 *
 *   // Undo/redo
 *   store.undo();
 *   store.redo();
 *
 *   // Snapshot
 *   const snapshot = store.snapshot();
 *   store.restore(snapshot);
 *
 * EXPORTS:
 *   StateStore   — primary class (default export)
 *   STATE_EVENTS — event name constants
 *   STATE_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the state store.
 * All events bubble on document and are published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATE_EVENTS = Object.freeze({
  INIT:    'state:init',
  UPDATED: 'state:updated',
  RESET:   'state:reset',
  ERROR:   'state:error',
  DESTROY: 'state:destroy',
});

/**
 * Default configuration values for the store.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const STATE_DEFAULTS = Object.freeze({
  /** Maximum entries retained in the undo history */
  HISTORY_LIMIT:       50,

  /** localStorage key for the persisted state document */
  STORAGE_KEY:         'pyai-state',

  /** Schema version — increment when the persisted shape changes */
  SCHEMA_VERSION:      1,

  /** Debounce delay (ms) before writing to localStorage after a state update */
  PERSIST_DEBOUNCE_MS: 500,

  /** Debounce delay (ms) before notifying subscribers after a batch update */
  NOTIFY_DEBOUNCE_MS:  16,   // ~1 animation frame

  /** Application version string stamped into every state snapshot */
  APP_VERSION:         '1.0.0',

  /** Slices persisted to localStorage by default (empty = nothing persisted) */
  DEFAULT_PERSIST:     /** @type {string[]} */ ([]),
});

// ---------------------------------------------------------------------------
// Pure utility functions (module-private)
// ---------------------------------------------------------------------------

/**
 * Deep-clone a plain object/array tree.
 * Uses structured clone when available (modern browsers), falling back to
 * a JSON round-trip for maximum compatibility.
 * Functions, class instances, and Dates are not supported by this function —
 * the state tree must contain only plain serialisable values.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Deep-merge source into target, returning a new object.
 * Arrays are replaced entirely (not concatenated) — consistent with
 * the update() contract where arrays are treated as scalar values.
 * Only plain objects are recursively merged.
 *
 * Structural sharing: if a source value is strictly equal to the target
 * value, the target reference is reused (no clone).
 *
 * @template {object} T
 * @param {T}      target
 * @param {object} source
 * @returns {T}
 */
function deepMerge(target, source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return source;
  }

  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      // Both are plain objects — recurse
      const merged = deepMerge(tgtVal, srcVal);
      result[key] = merged === tgtVal ? tgtVal : merged;
    } else if (srcVal !== tgtVal) {
      result[key] = srcVal;
    }
    // If srcVal === tgtVal, the existing reference is already in result (structural sharing)
  }

  return result;
}

/**
 * Read a value at a dot-separated path within a nested object.
 * Returns undefined if any segment of the path is missing.
 *
 * @param {object}   obj
 * @param {string}   path — e.g. 'dashboard.streak.current'
 * @returns {*}
 */
function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Produce a new object with a value set at a dot-separated path.
 * Intermediate objects that do not exist are created.
 * All ancestor objects along the path are new references (structural sharing
 * with siblings is preserved).
 *
 * @param {object}   obj
 * @param {string}   path
 * @param {*}        value
 * @returns {object}
 */
function setPath(obj, path, value) {
  if (!path) return value;

  const keys   = path.split('.');
  const result = { ...obj };
  let   cursor = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key    = keys[i];
    cursor[key]  = { ...(cursor[key] ?? {}) };
    cursor       = cursor[key];
  }

  cursor[keys[keys.length - 1]] = value;
  return result;
}

/**
 * Returns a debounced wrapper around the given function.
 * The returned function also exposes a .flush() method to execute immediately,
 * and a .cancel() method to discard a pending call.
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
      lastArgs = null;
      fn(...args);
    }, ms);
  };

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
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
 * Returns true when the user prefers reduced motion.
 * Checked fresh each call — OS settings can change mid-session.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Returns true when the user prefers high contrast.
 *
 * @returns {boolean}
 */
function prefersHighContrast() {
  try {
    return window.matchMedia('(forced-colors: active)').matches ||
           window.matchMedia('(prefers-contrast: more)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Default application state factory
// ---------------------------------------------------------------------------

/**
 * Returns a fresh default state document.
 * Calling this function is the only place the state shape is authoritatively defined.
 * Every field must be explicitly listed here to ensure initialisation completeness.
 *
 * @param {string} version — Application version string
 * @returns {AppState}
 */
function createDefaultState(version = STATE_DEFAULTS.APP_VERSION) {
  const reducedMotion  = prefersReducedMotion();
  const highContrast   = prefersHighContrast();
  const systemDark     = (() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
  })();

  return Object.freeze({
    /** User profile */
    user: Object.freeze({
      id:      null,
      name:    '',
      email:   '',
      avatar:  null,
      isGuest: true,
    }),

    /** Theme preferences */
    theme: Object.freeze({
      /** 'light' | 'dark' | 'auto' */
      mode:          'auto',
      /** Resolved mode after applying OS preference — 'light' | 'dark' */
      resolvedMode:  systemDark ? 'dark' : 'light',
      /** CSS custom property accent color — e.g. '#2563EB' */
      accentColor:   null,
    }),

    /** Dashboard / XP / gamification state */
    dashboard: Object.freeze({
      xp:             0,
      level:          1,
      progressPct:    0,
      xpForNext:      100,
      xpNeeded:       100,
      isMaxLevel:     false,
      /** @type {Array<object>} */
      achievements:   Object.freeze([]),
      streak: Object.freeze({
        current:  0,
        longest:  0,
        lastDate: null,
        freezes:  0,
      }),
      /** @type {Array<object>} */
      notifications: Object.freeze([]),
    }),

    /** Active learning progress */
    learning: Object.freeze({
      /** @type {object|null} */
      currentLesson:    null,
      /** @type {Record<string, object>} */
      completedLessons: Object.freeze({}),
      /** @type {string[]} — tutorial IDs */
      bookmarks:        Object.freeze([]),
      /** @type {Array<object>} — time-sorted activity feed entries */
      recentActivity:   Object.freeze([]),
    }),

    /** Active quiz session state */
    quiz: Object.freeze({
      /** @type {string|null} — Quiz ID currently in progress */
      currentQuizId: null,
      /** @type {object|null} — current question data */
      currentQuestion: null,
      score:           0,
      maxScore:        0,
      attempts:        0,
      /** @type {Record<string, *>} */
      answers:         Object.freeze({}),
      /** @type {object} — aggregate statistics across all quizzes */
      statistics: Object.freeze({
        totalAttempts: 0,
        totalPassed:   0,
        accuracy:      0,
        bestGrade:     null,
      }),
      /** 'idle' | 'active' | 'paused' | 'submitting' | 'complete' | 'review' */
      status: 'idle',
    }),

    /** Code editor session state */
    editor: Object.freeze({
      code:             '',
      language:         'python',
      /** @type {string[]} — Pyodide / execution output lines */
      output:           Object.freeze([]),
      /** @type {boolean} — unsaved changes since last save */
      isDirty:          false,
      /** @type {Array<{ code: string, output: string[], ts: number }>} */
      executionHistory: Object.freeze([]),
      fontSize:         14,
      wordWrap:         false,
    }),

    /** Project progress */
    projects: Object.freeze({
      /** @type {string[]} — completed project IDs */
      completed:      Object.freeze([]),
      /** @type {string[]} — in-progress project IDs */
      inProgress:     Object.freeze([]),
      /** @type {string[]} — favourited project IDs */
      favourites:     Object.freeze([]),
      totalCompleted: 0,
    }),

    /** User preferences and accessibility settings */
    settings: Object.freeze({
      /** Font size in pixels — matches code-editor.js FONT_SIZE default */
      fontSize:      14,
      /** Whether to enable CSS transition animations */
      animations:    !reducedMotion,
      /** Mirrors OS prefers-reduced-motion */
      reducedMotion,
      /** Mirrors OS forced-colors / prefers-contrast */
      highContrast,
      /** Whether the user is navigating primarily by keyboard */
      keyboardMode:  false,
    }),

    /** Application-level meta state */
    app: Object.freeze({
      loading:     false,
      initialised: false,
      /** @type {Array<{ id: string, message: string, ts: number }>} */
      errors:      Object.freeze([]),
      version,
      online:      typeof navigator !== 'undefined' ? navigator.onLine : true,
    }),
  });
}

// ---------------------------------------------------------------------------
// StateHistory — undo/redo stack
// ---------------------------------------------------------------------------

/**
 * Manages an undo/redo history of state snapshots.
 * Uses a two-stack model: undoStack and redoStack.
 *
 * Memory contract: each snapshot is a reference to the previous immutable
 * state object (not a deep clone), so the memory footprint is proportional
 * to the number of unique object nodes per mutation — not the total state size.
 */
class StateHistory {
  /** @type {object[]} — stack of past states (most recent = last) */
  #undoStack = [];

  /** @type {object[]} — stack of future states (most recent = last) */
  #redoStack = [];

  /** @type {number} */
  #limit;

  /** @param {number} limit — Maximum history entries to retain */
  constructor(limit = STATE_DEFAULTS.HISTORY_LIMIT) {
    this.#limit = Math.max(1, limit);
  }

  /**
   * Push the given state onto the undo stack.
   * Clears the redo stack (any new action invalidates redo history).
   *
   * @param {object} state
   */
  push(state) {
    this.#undoStack.push(state);
    if (this.#undoStack.length > this.#limit) {
      this.#undoStack.shift();
    }
    this.#redoStack = [];
  }

  /**
   * Undo: pop from undoStack and push current onto redoStack.
   * Returns the state to restore, or null if the undo stack is empty.
   *
   * @param {object} current — The current live state (to preserve for redo)
   * @returns {object|null}
   */
  undo(current) {
    if (this.#undoStack.length === 0) return null;
    const prev = this.#undoStack.pop();
    this.#redoStack.push(current);
    return prev;
  }

  /**
   * Redo: pop from redoStack and push current onto undoStack.
   * Returns the state to restore, or null if the redo stack is empty.
   *
   * @param {object} current — The current live state (to preserve for undo)
   * @returns {object|null}
   */
  redo(current) {
    if (this.#redoStack.length === 0) return null;
    const next = this.#redoStack.pop();
    this.#undoStack.push(current);
    return next;
  }

  /** Clear both stacks. */
  clear() {
    this.#undoStack = [];
    this.#redoStack = [];
  }

  /** @returns {number} Number of available undo steps */
  get undoDepth() { return this.#undoStack.length; }

  /** @returns {number} Number of available redo steps */
  get redoDepth() { return this.#redoStack.length; }

  /** @returns {boolean} */
  get canUndo() { return this.#undoStack.length > 0; }

  /** @returns {boolean} */
  get canRedo() { return this.#redoStack.length > 0; }
}

// ---------------------------------------------------------------------------
// ComputedRegistry — memoised derived values
// ---------------------------------------------------------------------------

/**
 * Manages named computed (derived) state values.
 * Each computed value is defined by a selector function that receives the
 * full state tree and returns a derived value. Results are memoised:
 * the selector only re-runs when the state reference changes.
 *
 * @example
 *   registry.register('displayName', (s) => s.user.name || 'Guest');
 *   registry.get('displayName', currentState); // 'Ada'
 */
class ComputedRegistry {
  /**
   * @type {Map<string, {
   *   selector: (state: object) => *,
   *   lastState: object|null,
   *   lastValue: *,
   * }>}
   */
  #entries = new Map();

  /**
   * Register a named computed value.
   * Silently replaces any existing registration with the same key.
   *
   * @param {string}   key
   * @param {(state: object) => *} selector
   */
  register(key, selector) {
    if (typeof selector !== 'function') {
      throw new TypeError(`[StateStore] Computed selector for "${key}" must be a function.`);
    }
    this.#entries.set(key, { selector, lastState: null, lastValue: undefined });
  }

  /**
   * Remove a named computed value.
   *
   * @param {string} key
   */
  unregister(key) {
    this.#entries.delete(key);
  }

  /**
   * Retrieve the memoised value for the given key.
   * Recalculates only when state is a different reference than the last call.
   *
   * @param {string} key
   * @param {object} state — Current application state
   * @returns {*}
   * @throws {Error} If the key has not been registered
   */
  get(key, state) {
    const entry = this.#entries.get(key);
    if (!entry) {
      throw new Error(`[StateStore] Computed value "${key}" is not registered.`);
    }

    // Structural identity check — reuse cached value if state hasn't changed
    if (entry.lastState === state) {
      return entry.lastValue;
    }

    try {
      const value      = entry.selector(state);
      entry.lastState  = state;
      entry.lastValue  = value;
      return value;
    } catch (err) {
      console.error(`[StateStore] Computed selector "${key}" threw:`, err);
      return entry.lastValue;
    }
  }

  /**
   * Invalidate all cached values (called after state.reset()).
   */
  invalidate() {
    for (const entry of this.#entries.values()) {
      entry.lastState = null;
    }
  }

  /** @returns {string[]} All registered computed keys */
  get keys() { return [...this.#entries.keys()]; }
}

// ---------------------------------------------------------------------------
// MiddlewareChain — pre/post update hooks
// ---------------------------------------------------------------------------

/**
 * Manages an ordered list of middleware functions called before and after
 * every state mutation.
 *
 * Middleware signature:
 *   (context: {
 *     type:      'setState' | 'update' | 'reset',
 *     path:      string | null,
 *     prevState: object,
 *     nextState: object,
 *     payload:   *,
 *   }) => void
 *
 * Middleware should not throw — errors are caught and logged.
 */
class MiddlewareChain {
  /** @type {Array<(ctx: object) => void>} */
  #fns = [];

  /**
   * @param {(ctx: object) => void} fn
   */
  use(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('[StateStore] Middleware must be a function.');
    }
    this.#fns.push(fn);
  }

  /**
   * @param {object} ctx — Mutation context
   */
  run(ctx) {
    for (const fn of this.#fns) {
      try { fn(ctx); } catch (err) {
        console.error('[StateStore] Middleware error:', err);
      }
    }
  }

  clear() { this.#fns = []; }

  /** @returns {number} */
  get size() { return this.#fns.length; }
}

// ---------------------------------------------------------------------------
// PersistenceAdapter — localStorage with schema versioning
// ---------------------------------------------------------------------------

/**
 * Reads and writes a selective snapshot of the state tree to localStorage.
 * Only the slice keys listed in config.persist are saved and restored.
 * Uses schema versioning to detect stale persisted data.
 */
class PersistenceAdapter {
  /** @type {string}   */ #key;
  /** @type {number}   */ #version;
  /** @type {string[]} */ #slices;

  /** @type {Map<string, string>|null} — in-memory fallback when localStorage is blocked */
  #memory = null;

  /** @type {boolean} */
  #available = true;

  /**
   * @param {string}   storageKey
   * @param {number}   version
   * @param {string[]} slices — State slice keys to persist
   */
  constructor(storageKey, version, slices) {
    this.#key     = storageKey;
    this.#version = version;
    this.#slices  = slices;

    // Probe localStorage availability
    try {
      const probe = '__pyai_state_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch {
      this.#available = false;
      this.#memory    = new Map();
    }
  }

  /**
   * Persist the relevant slices of the given state.
   *
   * @param {object} state
   */
  save(state) {
    if (this.#slices.length === 0) return;

    const snapshot = {};
    for (const key of this.#slices) {
      if (Object.hasOwn(state, key)) {
        snapshot[key] = state[key];
      }
    }

    const payload = JSON.stringify({
      version:   this.#version,
      savedAt:   Date.now(),
      slices:    this.#slices,
      snapshot,
    });

    try {
      if (this.#available) {
        localStorage.setItem(this.#key, payload);
      } else {
        if (!this.#memory) this.#memory = new Map();
        this.#memory.set(this.#key, payload);
      }
    } catch {
      // QuotaExceededError — fall back to memory store
      this.#available = false;
      if (!this.#memory) this.#memory = new Map();
      this.#memory.set(this.#key, payload);
    }
  }

  /**
   * Load and return the persisted state slices, or null if unavailable/stale.
   *
   * @returns {object|null}
   */
  load() {
    try {
      const raw = this.#available
        ? localStorage.getItem(this.#key)
        : (this.#memory?.get(this.#key) ?? null);

      if (!raw) return null;

      const data = JSON.parse(raw);

      // Version mismatch — discard stale data
      if (data.version !== this.#version) {
        this.clear();
        return null;
      }

      return data.snapshot ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Remove the persisted state from storage.
   */
  clear() {
    try {
      if (this.#available) {
        localStorage.removeItem(this.#key);
      } else {
        this.#memory?.delete(this.#key);
      }
    } catch {
      // Swallow
    }
  }

  /** @returns {boolean} */
  get isAvailable() { return this.#available; }
}

// ---------------------------------------------------------------------------
// Subscription manager — path-scoped reactive observers
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:       number,
 *   path:     string | null,
 *   callback: (value: *, prevValue: *, state: object) => void,
 *   once:     boolean,
 * }} Subscription
 */

/**
 * Manages subscriber registration and notification.
 * Supports full-state subscriptions (path=null) and path-scoped subscriptions.
 */
class SubscriptionManager {
  /** @type {Map<number, Subscription>} */
  #subs = new Map();

  /** @type {number} */
  #nextId = 1;

  /**
   * Register a subscriber.
   *
   * @param {string|null} path     — Dot-separated path, or null for full state
   * @param {(value: *, prevValue: *, state: object) => void} callback
   * @param {boolean} [once=false] — Auto-unsubscribe after first call
   * @returns {number} Subscription ID (pass to unsubscribe())
   */
  subscribe(path, callback, once = false) {
    if (typeof callback !== 'function') {
      throw new TypeError('[StateStore] Subscriber callback must be a function.');
    }

    const id = this.#nextId++;
    this.#subs.set(id, { id, path: path ?? null, callback, once });
    return id;
  }

  /**
   * Unsubscribe by ID.
   *
   * @param {number} id
   * @returns {boolean} Whether the subscription existed
   */
  unsubscribe(id) {
    return this.#subs.delete(id);
  }

  /**
   * Notify all subscribers whose watched path has changed.
   *
   * @param {object} prevState
   * @param {object} nextState
   */
  notify(prevState, nextState) {
    const toDelete = [];

    for (const sub of this.#subs.values()) {
      const prevValue = sub.path ? getPath(prevState, sub.path) : prevState;
      const nextValue = sub.path ? getPath(nextState, sub.path) : nextState;

      // Skip if the watched value has not changed (structural identity)
      if (prevValue === nextValue) continue;

      try {
        sub.callback(nextValue, prevValue, nextState);
      } catch (err) {
        console.error('[StateStore] Subscriber callback error:', err);
      }

      if (sub.once) toDelete.push(sub.id);
    }

    // Unsubscribe all once-subscribers after firing
    for (const id of toDelete) {
      this.#subs.delete(id);
    }
  }

  /**
   * Remove all subscriptions.
   */
  clear() {
    this.#subs.clear();
  }

  /** @returns {number} Total active subscribers */
  get size() { return this.#subs.size; }
}

// ---------------------------------------------------------------------------
// State validation
// ---------------------------------------------------------------------------

/**
 * Validates a proposed state update against known structural constraints.
 * Returns an array of validation error messages (empty = valid).
 * This is intentionally lightweight — full schema validation would require
 * an external library. These guards catch the most common programming errors.
 *
 * @param {string} slice — Top-level state key
 * @param {object} value — The proposed update value
 * @returns {string[]}   — Error messages
 */
function validateSlice(slice, value) {
  const errors = [];

  if (value === undefined) {
    errors.push(`Slice "${slice}" update value must not be undefined.`);
    return errors;
  }

  if (value !== null && typeof value !== 'object') {
    errors.push(`Slice "${slice}" must be updated with an object; received ${typeof value}.`);
    return errors;
  }

  // Per-slice field validations
  if (slice === 'theme' && value?.mode !== undefined) {
    if (!['light', 'dark', 'auto'].includes(value.mode)) {
      errors.push(`theme.mode must be 'light', 'dark', or 'auto'; received "${value.mode}".`);
    }
  }

  if (slice === 'settings') {
    if (value?.fontSize !== undefined) {
      const fs = Number(value.fontSize);
      if (!Number.isFinite(fs) || fs < 8 || fs > 32) {
        errors.push(`settings.fontSize must be a number between 8 and 32; received ${value.fontSize}.`);
      }
    }
  }

  if (slice === 'dashboard') {
    if (value?.xp !== undefined && !Number.isFinite(Number(value.xp))) {
      errors.push(`dashboard.xp must be a finite number; received ${value.xp}.`);
    }
    if (value?.level !== undefined) {
      const lvl = Number(value.level);
      if (!Number.isFinite(lvl) || lvl < 1) {
        errors.push(`dashboard.level must be a positive number; received ${value.level}.`);
      }
    }
  }

  if (slice === 'quiz') {
    if (value?.status !== undefined) {
      const valid = ['idle', 'active', 'paused', 'submitting', 'complete', 'review'];
      if (!valid.includes(value.status)) {
        errors.push(`quiz.status must be one of ${valid.join(', ')}; received "${value.status}".`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// StateStore — primary class
// ---------------------------------------------------------------------------

/**
 * Centralised reactive state store for the Python for AI platform.
 *
 * Lifecycle:
 *   1. new StateStore(config)   — no DOM side-effects
 *   2. .initialize()            — loads persisted state, syncs OS preferences,
 *                                 registers system event listeners
 *   3. .setState() / .update()  — mutate state, notify subscribers, persist
 *   4. .subscribe()             — reactive observers
 *   5. .undo() / .redo()        — time-travel
 *   6. .snapshot() / .restore() — manual state capture and restore
 *   7. .destroy()               — tear down all listeners and subscriptions
 */
export default class StateStore {

  // ---- Configuration (immutable after construction) -----------------------

  /**
   * @type {{
   *   historyLimit:       number,
   *   storageKey:         string,
   *   schemaVersion:      number,
   *   persistDebounceMs:  number,
   *   notifyDebounceMs:   number,
   *   appVersion:         string,
   *   persist:            string[],
   *   validate:           boolean,
   * }}
   */
  #config;

  // ---- Core state ----------------------------------------------------------

  /**
   * The live immutable state object.
   * Never mutated in place — always replaced with a new object reference.
   *
   * @type {object}
   */
  #state;

  /** @type {boolean} */
  #initialised = false;

  /** @type {boolean} */
  #destroyed   = false;

  /** @type {boolean} — true while a batch update is being composed */
  #batching    = false;

  /** @type {object|null} — pending batch changes accumulator */
  #batchBuffer = null;

  // ---- Sub-systems ---------------------------------------------------------

  /** @type {StateHistory}        */ #history;
  /** @type {ComputedRegistry}    */ #computed;
  /** @type {MiddlewareChain}     */ #middleware;
  /** @type {PersistenceAdapter}  */ #persistence;
  /** @type {SubscriptionManager} */ #subscriptions;

  // ---- Debounced workers ---------------------------------------------------

  /** @type {Function & { flush: () => void, cancel: () => void }} */
  #debouncedPersist;

  /** @type {Function & { flush: () => void, cancel: () => void }} */
  #debouncedNotify;

  // ---- Queued notifications for debounced delivery -------------------------

  /** @type {{ prevState: object, nextState: object } | null} */
  #pendingNotification = null;

  // ---- Cleanup references -------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   historyLimit?:      number,
   *   storageKey?:        string,
   *   schemaVersion?:     number,
   *   persistDebounceMs?: number,
   *   notifyDebounceMs?:  number,
   *   appVersion?:        string,
   *   persist?:           string[],
   *   validate?:          boolean,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      historyLimit:      config.historyLimit      ?? STATE_DEFAULTS.HISTORY_LIMIT,
      storageKey:        config.storageKey        ?? STATE_DEFAULTS.STORAGE_KEY,
      schemaVersion:     config.schemaVersion     ?? STATE_DEFAULTS.SCHEMA_VERSION,
      persistDebounceMs: config.persistDebounceMs ?? STATE_DEFAULTS.PERSIST_DEBOUNCE_MS,
      notifyDebounceMs:  config.notifyDebounceMs  ?? STATE_DEFAULTS.NOTIFY_DEBOUNCE_MS,
      appVersion:        config.appVersion        ?? STATE_DEFAULTS.APP_VERSION,
      persist:           Array.isArray(config.persist) ? config.persist : [...STATE_DEFAULTS.DEFAULT_PERSIST],
      validate:          config.validate          ?? true,
    });

    // Create the initial state
    this.#state = createDefaultState(this.#config.appVersion);

    // Initialise sub-systems
    this.#history       = new StateHistory(this.#config.historyLimit);
    this.#computed      = new ComputedRegistry();
    this.#middleware    = new MiddlewareChain();
    this.#subscriptions = new SubscriptionManager();
    this.#persistence   = new PersistenceAdapter(
      this.#config.storageKey,
      this.#config.schemaVersion,
      this.#config.persist
    );

    // Debounced workers
    this.#debouncedPersist = debounce(
      () => this.#persistence.save(this.#state),
      this.#config.persistDebounceMs
    );

    this.#debouncedNotify = debounce(
      () => {
        const pending = this.#pendingNotification;
        if (!pending) return;
        this.#pendingNotification = null;
        this.#subscriptions.notify(pending.prevState, pending.nextState);
      },
      this.#config.notifyDebounceMs
    );
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Initialise the store.
   *
   * Actions:
   *   1. Load persisted state slices from localStorage
   *   2. Merge persisted data into the default state
   *   3. Sync OS accessibility preferences (reducedMotion, highContrast)
   *   4. Register system event listeners (online/offline, OS theme change)
   *   5. Mark as initialised and emit state:init
   *
   * @returns {Promise<StateStore>} this — for chaining
   */
  async initialize() {
    if (this.#initialised) return this;

    this.#assertAlive();

    // Load persisted slices and merge into default state
    const persisted = this.#persistence.load();
    if (persisted && typeof persisted === 'object') {
      let merged = this.#state;
      for (const [key, value] of Object.entries(persisted)) {
        if (Object.hasOwn(merged, key) && value !== null && typeof value === 'object') {
          merged = {
            ...merged,
            [key]: deepMerge(merged[key], value),
          };
        }
      }
      this.#state = Object.freeze(merged);
    }

    // Sync accessibility preferences from current OS state
    this.#syncAccessibilityPreferences();

    // Register OS-level change listeners
    this.#attachSystemListeners();

    // Mark as initialised
    this.#state = Object.freeze({
      ...this.#state,
      app: Object.freeze({
        ...this.#state.app,
        initialised: true,
        loading:     false,
      }),
    });

    this.#initialised = true;

    this.#dispatch(STATE_EVENTS.INIT, { state: this.#safeStateCopy() });

    return this;
  }

  /**
   * Tear down the store — cancels debounces, removes listeners,
   * flushes pending persistence, and clears all subscriptions.
   */
  destroy() {
    if (this.#destroyed) return;

    // Flush any pending persist write before teardown
    this.#debouncedPersist.flush();
    this.#debouncedPersist.cancel();
    this.#debouncedNotify.cancel();

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    this.#subscriptions.clear();
    this.#middleware.clear();
    this.#history.clear();
    this.#computed.invalidate();

    this.#destroyed   = true;
    this.#initialised = false;

    this.#dispatch(STATE_EVENTS.DESTROY, {});
  }

  // ---- Public API: read ----------------------------------------------------

  /**
   * Return the current full application state.
   * The returned object is the live frozen reference — treat it as read-only.
   * Do not mutate it; pass through setState() or update() instead.
   *
   * @returns {Readonly<object>}
   */
  getState() {
    return this.#state;
  }

  // ---- Public API: write ---------------------------------------------------

  /**
   * Produce a new state by deep-merging the provided partial state.
   * Accepts either a partial state object or a function that receives
   * the current state and returns a partial state object.
   *
   * Only top-level slice keys present in the patch are affected.
   * Within each affected slice, deep merging is applied recursively.
   *
   * @param {Partial<object> | ((currentState: object) => Partial<object>)} patch
   * @param {{ silent?: boolean, skipHistory?: boolean, type?: string }} [options={}]
   * @returns {object} The new state
   */
  setState(patch, options = {}) {
    this.#assertAlive();

    const resolved = typeof patch === 'function' ? patch(this.#state) : patch;

    if (!resolved || typeof resolved !== 'object') {
      this.#emitError(`setState() received a non-object patch: ${typeof resolved}`);
      return this.#state;
    }

    return this.#applyMutation(resolved, null, options.type ?? 'setState', options);
  }

  /**
   * Update a specific top-level state slice by key.
   * Equivalent to setState({ [sliceKey]: patch }) but with explicit path
   * and per-slice validation.
   *
   * @param {string}  sliceKey — Top-level state key (e.g. 'dashboard', 'quiz')
   * @param {object}  patch    — Partial values to merge into the slice
   * @param {{ silent?: boolean, skipHistory?: boolean, type?: string }} [options={}]
   * @returns {object} The new state
   */
  update(sliceKey, patch, options = {}) {
    this.#assertAlive();

    if (!Object.hasOwn(this.#state, sliceKey)) {
      this.#emitError(`update(): unknown state slice "${sliceKey}".`);
      return this.#state;
    }

    if (this.#config.validate) {
      const errs = validateSlice(sliceKey, patch);
      if (errs.length > 0) {
        errs.forEach((msg) => this.#emitError(msg));
        return this.#state;
      }
    }

    return this.#applyMutation(
      { [sliceKey]: patch },
      sliceKey,
      options.type ?? `update:${sliceKey}`,
      options
    );
  }

  /**
   * Update the state at an arbitrary dot-separated path.
   * Creates intermediate objects as needed.
   * Validates that the path's top-level key exists.
   *
   * @param {string} path  — e.g. 'dashboard.streak.current'
   * @param {*}      value — New value at the path
   * @param {{ silent?: boolean, skipHistory?: boolean }} [options={}]
   * @returns {object} The new state
   */
  setPath(path, value, options = {}) {
    this.#assertAlive();

    if (typeof path !== 'string' || !path) {
      this.#emitError('setPath(): path must be a non-empty string.');
      return this.#state;
    }

    const topKey = path.split('.')[0];
    if (!Object.hasOwn(this.#state, topKey)) {
      this.#emitError(`setPath(): unknown state slice "${topKey}" in path "${path}".`);
      return this.#state;
    }

    const nextState = setPath(this.#state, path, value);
    return this.#commitState(nextState, this.#state, path, `setPath:${path}`, options);
  }

  /**
   * Reset the entire state to the default values.
   * Clears undo/redo history and computed caches.
   * Persisted slices are cleared from localStorage.
   *
   * @returns {object} The reset state
   */
  reset() {
    this.#assertAlive();

    const prevState = this.#state;
    this.#state     = createDefaultState(this.#config.appVersion);

    this.#history.clear();
    this.#computed.invalidate();
    this.#persistence.clear();

    this.#subscriptions.notify(prevState, this.#state);
    this.#dispatch(STATE_EVENTS.RESET, { state: this.#safeStateCopy() });

    return this.#state;
  }

  // ---- Public API: batch updates ------------------------------------------

  /**
   * Compose multiple state mutations into a single atomic update.
   * Subscribers and persistence are notified only once after the batch completes.
   *
   * @param {(store: { update: StateStore['update'], setState: StateStore['setState'], setPath: StateStore['setPath'] }) => void} fn
   * @returns {object} The final state after the batch
   */
  batch(fn) {
    this.#assertAlive();

    if (this.#batching) {
      // Nested batch — just run the function, the outer batch handles notification
      fn(this.#batchProxy());
      return this.#state;
    }

    this.#batching    = true;
    this.#batchBuffer = null;

    const prevState = this.#state;

    try {
      fn(this.#batchProxy());
    } finally {
      this.#batching = false;

      if (this.#batchBuffer) {
        const nextState = this.#applyMutation(
          this.#batchBuffer,
          null,
          'batch',
          { silent: true }
        );
        this.#batchBuffer = null;

        // Notify once for the entire batch
        this.#scheduleNotification(prevState, nextState);
        this.#debouncedPersist();
      }
    }

    return this.#state;
  }

  // ---- Public API: subscriptions ------------------------------------------

  /**
   * Subscribe to state changes.
   *
   * @param {string | ((value: *, prevValue: *, state: object) => void)} pathOrCallback
   *   If a string: only calls back when the value at that dot-path changes.
   *   If a function: calls back on every state change (full state subscription).
   * @param {((value: *, prevValue: *, state: object) => void)} [callback]
   *   Required when the first argument is a string path.
   * @returns {() => void} Unsubscribe function
   */
  subscribe(pathOrCallback, callback) {
    this.#assertAlive();

    let path = null;
    let cb;

    if (typeof pathOrCallback === 'function') {
      cb   = pathOrCallback;
      path = null;
    } else if (typeof pathOrCallback === 'string' && typeof callback === 'function') {
      path = pathOrCallback;
      cb   = callback;
    } else {
      throw new TypeError('[StateStore] subscribe() requires a callback function.');
    }

    const id = this.#subscriptions.subscribe(path, cb);

    // Return the unsubscribe function
    return () => this.#subscriptions.unsubscribe(id);
  }

  /**
   * Subscribe to a single state change event and then automatically unsubscribe.
   *
   * @param {string|null} path
   * @param {(value: *, prevValue: *, state: object) => void} callback
   * @returns {() => void} Cancel function (prevents the single-fire if called before it fires)
   */
  subscribeOnce(path, callback) {
    this.#assertAlive();

    const id = this.#subscriptions.subscribe(
      typeof path === 'string' ? path : null,
      callback,
      true
    );
    return () => this.#subscriptions.unsubscribe(id);
  }

  /**
   * Remove a subscription by its numeric ID.
   * Prefer the unsubscribe function returned by subscribe() over this method.
   *
   * @param {number} id
   * @returns {boolean}
   */
  unsubscribe(id) {
    return this.#subscriptions.unsubscribe(id);
  }

  // ---- Public API: dispatch (event bridge) --------------------------------

  /**
   * Emit a custom event through the platform event bus.
   * Provides a single consistent dispatch point for all components.
   * Identical to the #dispatch pattern in every other component.
   *
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  dispatch(eventName, detail = {}) {
    this.#dispatch(eventName, detail);
  }

  // ---- Public API: computed -----------------------------------------------

  /**
   * Register a named computed (derived) state value.
   *
   * @param {string}   key
   * @param {(state: object) => *} selector
   * @returns {StateStore} this
   */
  registerComputed(key, selector) {
    this.#computed.register(key, selector);
    return this;
  }

  /**
   * Unregister a named computed value.
   *
   * @param {string} key
   * @returns {StateStore} this
   */
  unregisterComputed(key) {
    this.#computed.unregister(key);
    return this;
  }

  /**
   * Retrieve the memoised value of a registered computed key.
   *
   * @param {string} key
   * @returns {*}
   */
  computed(key) {
    return this.#computed.get(key, this.#state);
  }

  // ---- Public API: middleware ----------------------------------------------

  /**
   * Register a global middleware function called before every state mutation.
   * Middleware is called with the mutation context and may log, trace, or
   * validate — but must NOT call setState() recursively.
   *
   * @param {(ctx: object) => void} fn
   * @returns {StateStore} this
   */
  use(fn) {
    this.#middleware.use(fn);
    return this;
  }

  // ---- Public API: undo / redo --------------------------------------------

  /**
   * Undo the last state mutation.
   * Returns the restored state, or the current state if nothing to undo.
   *
   * @returns {object}
   */
  undo() {
    this.#assertAlive();

    if (!this.#history.canUndo) return this.#state;

    const prevState = this.#state;
    const restored  = this.#history.undo(this.#state);
    if (!restored) return this.#state;

    this.#state = restored;
    this.#computed.invalidate();
    this.#scheduleNotification(prevState, this.#state);
    this.#debouncedPersist();

    return this.#state;
  }

  /**
   * Redo the last undone mutation.
   * Returns the restored state, or the current state if nothing to redo.
   *
   * @returns {object}
   */
  redo() {
    this.#assertAlive();

    if (!this.#history.canRedo) return this.#state;

    const prevState = this.#state;
    const restored  = this.#history.redo(this.#state);
    if (!restored) return this.#state;

    this.#state = restored;
    this.#computed.invalidate();
    this.#scheduleNotification(prevState, this.#state);
    this.#debouncedPersist();

    return this.#state;
  }

  /** @returns {boolean} */
  get canUndo() { return this.#history.canUndo; }

  /** @returns {boolean} */
  get canRedo() { return this.#history.canRedo; }

  // ---- Public API: snapshot / restore -------------------------------------

  /**
   * Create a deep-cloned snapshot of the current state.
   * The snapshot is a plain serialisable object — safe to JSON.stringify().
   *
   * @returns {{ ts: number, version: string, state: object }}
   */
  snapshot() {
    return {
      ts:      Date.now(),
      version: this.#config.appVersion,
      state:   deepClone(this.#state),
    };
  }

  /**
   * Restore a previously taken snapshot.
   * Validates that the snapshot version matches the current app version.
   * Pushes the current state onto the undo stack before restoring.
   *
   * @param {{ ts: number, version: string, state: object }} snap
   * @returns {object} The restored state
   */
  restore(snap) {
    this.#assertAlive();

    if (!snap || typeof snap !== 'object' || !snap.state) {
      this.#emitError('restore(): invalid snapshot object.');
      return this.#state;
    }

    const prevState = this.#state;
    this.#history.push(prevState);
    this.#state = Object.freeze(deepClone(snap.state));
    this.#computed.invalidate();
    this.#scheduleNotification(prevState, this.#state);
    this.#debouncedPersist();

    return this.#state;
  }

  // ---- Public API: selectors ----------------------------------------------

  /**
   * Return the user slice of the state.
   * @returns {object}
   */
  getUser() { return this.#state.user; }

  /**
   * Return the theme slice of the state.
   * @returns {object}
   */
  getTheme() { return this.#state.theme; }

  /**
   * Return the dashboard slice of the state.
   * @returns {object}
   */
  getDashboard() { return this.#state.dashboard; }

  /**
   * Return the learning slice of the state.
   * @returns {object}
   */
  getLearning() { return this.#state.learning; }

  /**
   * Return the quiz slice of the state.
   * @returns {object}
   */
  getQuiz() { return this.#state.quiz; }

  /**
   * Return the editor slice of the state.
   * @returns {object}
   */
  getEditor() { return this.#state.editor; }

  /**
   * Return the projects slice of the state.
   * @returns {object}
   */
  getProjects() { return this.#state.projects; }

  /**
   * Return the settings slice of the state.
   * @returns {object}
   */
  getSettings() { return this.#state.settings; }

  /**
   * Return the app meta slice of the state.
   * @returns {object}
   */
  getApp() { return this.#state.app; }

  // ---- Public API: diagnostic read-outs -----------------------------------

  /** @returns {number} Active subscriber count */
  get subscriberCount() { return this.#subscriptions.size; }

  /** @returns {number} Undo stack depth */
  get historyDepth() { return this.#history.undoDepth; }

  /** @returns {boolean} */
  get isInitialised() { return this.#initialised; }

  /** @returns {boolean} */
  get isDestroyed() { return this.#destroyed; }

  // ---- Private: mutation core ---------------------------------------------

  /**
   * Apply a partial state patch, running middleware, updating history,
   * scheduling subscriber notification and persistence.
   *
   * @param {object} patch       — Partial state (top-level keys only)
   * @param {string|null} path   — Slice key if single-slice update, else null
   * @param {string} type        — Mutation type label for middleware
   * @param {{ silent?: boolean, skipHistory?: boolean }} options
   * @returns {object} The new state
   */
  #applyMutation(patch, path, type, options = {}) {
    if (this.#batching && !options.silent) {
      // Accumulate into the batch buffer
      this.#batchBuffer = this.#batchBuffer
        ? deepMerge(this.#batchBuffer, patch)
        : patch;
      return this.#state;
    }

    let nextState = this.#state;

    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(nextState, key)) continue;

      const existingSlice = nextState[key];
      const merged = (value !== null && typeof value === 'object' && !Array.isArray(value))
        ? deepMerge(existingSlice, value)
        : value;

      if (merged !== existingSlice) {
        nextState = { ...nextState, [key]: Object.freeze(merged) };
      }
    }

    if (nextState === this.#state) return this.#state;

    return this.#commitState(nextState, this.#state, path, type, options);
  }

  /**
   * Commit a new state, run middleware, record in history,
   * schedule notification and persistence.
   *
   * @param {object} nextState
   * @param {object} prevState
   * @param {string|null} path
   * @param {string} type
   * @param {{ silent?: boolean, skipHistory?: boolean }} options
   * @returns {object}
   */
  #commitState(nextState, prevState, path, type, options = {}) {
    const frozen = Object.isFrozen(nextState) ? nextState : Object.freeze(nextState);

    // Run middleware (before and after context available)
    this.#middleware.run({
      type,
      path,
      payload:   path ? getPath(frozen, path ?? '') : frozen,
      prevState,
      nextState: frozen,
    });

    // Record in undo history
    if (!options.skipHistory) {
      this.#history.push(prevState);
    }

    this.#state = frozen;
    this.#computed.invalidate();

    if (!options.silent) {
      this.#scheduleNotification(prevState, frozen);
      this.#debouncedPersist();

      const prevValue = path ? getPath(prevState, path) : prevState;
      const nextValue = path ? getPath(frozen, path)    : frozen;

      this.#dispatch(STATE_EVENTS.UPDATED, {
        path,
        prevValue,
        nextValue,
        type,
      });
    }

    return frozen;
  }

  /**
   * Schedule subscriber notification for the next debounce window.
   * If notifications arrive faster than the debounce window, they are
   * coalesced: subscribers always see the transition from the first
   * prevState to the final nextState.
   *
   * @param {object} prevState
   * @param {object} nextState
   */
  #scheduleNotification(prevState, nextState) {
    if (!this.#pendingNotification) {
      this.#pendingNotification = { prevState, nextState };
    } else {
      // Keep the original prevState, update to the latest nextState
      this.#pendingNotification.nextState = nextState;
    }
    this.#debouncedNotify();
  }

  /**
   * Returns a proxy object for use inside batch() that routes mutations
   * through the accumulator rather than committing immediately.
   *
   * @returns {{ update: Function, setState: Function, setPath: Function }}
   */
  #batchProxy() {
    return {
      update:   (key, patch, opts) => this.update(key, patch, { ...opts, silent: true }),
      setState: (patch, opts)      => this.setState(patch, { ...opts, silent: true }),
      setPath:  (path, val, opts)  => this.setPath(path, val, { ...opts, silent: true }),
    };
  }

  // ---- Private: system integration ----------------------------------------

  /**
   * Sync settings.reducedMotion, settings.highContrast, and theme.resolvedMode
   * from the current OS/browser state.
   * Called on initialize() and whenever the relevant media queries change.
   */
  #syncAccessibilityPreferences() {
    const reducedMotion = prefersReducedMotion();
    const highContrast  = prefersHighContrast();
    const systemDark    = (() => {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
    })();

    const themeMode     = this.#state.theme.mode;
    const resolvedMode  = themeMode === 'auto'
      ? (systemDark ? 'dark' : 'light')
      : themeMode;

    this.#state = Object.freeze({
      ...this.#state,
      settings: Object.freeze({
        ...this.#state.settings,
        reducedMotion,
        highContrast,
        animations: this.#state.settings.animations && !reducedMotion,
      }),
      theme: Object.freeze({
        ...this.#state.theme,
        resolvedMode,
      }),
    });
  }

  /**
   * Attach OS-level media query change listeners so the store reacts
   * automatically when the user changes system preferences.
   */
  #attachSystemListeners() {
    // ── Reduced motion ───────────────────────────────────────────────────────
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      const reducedMotion = prefersReducedMotion();
      this.update('settings', {
        reducedMotion,
        animations: this.#state.settings.animations && !reducedMotion,
      }, { type: 'system:reducedMotion', skipHistory: true });
    };

    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', onMotion);
      this.#cleanupFns.push(() => motionQuery.removeEventListener('change', onMotion));
    }

    // ── High contrast ────────────────────────────────────────────────────────
    const contrastQuery = (() => {
      try { return window.matchMedia('(prefers-contrast: more)'); } catch { return null; }
    })();

    if (contrastQuery?.addEventListener) {
      const onContrast = () => {
        this.update('settings', {
          highContrast: prefersHighContrast(),
        }, { type: 'system:highContrast', skipHistory: true });
      };
      contrastQuery.addEventListener('change', onContrast);
      this.#cleanupFns.push(() => contrastQuery.removeEventListener('change', onContrast));
    }

    // ── System colour scheme (for theme:auto resolution) ─────────────────────
    const schemeQuery = (() => {
      try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; }
    })();

    if (schemeQuery?.addEventListener) {
      const onScheme = (e) => {
        const systemDark  = e.matches;
        const currentMode = this.#state.theme.mode;
        if (currentMode === 'auto') {
          this.update('theme', {
            resolvedMode: systemDark ? 'dark' : 'light',
          }, { type: 'system:colorScheme', skipHistory: true });
        }
      };
      schemeQuery.addEventListener('change', onScheme);
      this.#cleanupFns.push(() => schemeQuery.removeEventListener('change', onScheme));
    }

    // ── Keyboard mode detection ───────────────────────────────────────────────
    // When the user presses Tab, enable keyboard navigation mode.
    // When the user clicks with a mouse, disable it.
    const onKeydown = (e) => {
      if (e.key === 'Tab' && !this.#state.settings.keyboardMode) {
        this.update('settings', { keyboardMode: true }, { skipHistory: true });
      }
    };
    const onMousedown = () => {
      if (this.#state.settings.keyboardMode) {
        this.update('settings', { keyboardMode: false }, { skipHistory: true });
      }
    };

    document.addEventListener('keydown',   onKeydown);
    document.addEventListener('mousedown', onMousedown);
    this.#cleanupFns.push(() => {
      document.removeEventListener('keydown',   onKeydown);
      document.removeEventListener('mousedown', onMousedown);
    });

    // ── Online / offline ──────────────────────────────────────────────────────
    const onOnline  = () => this.update('app', { online: true  }, { skipHistory: true });
    const onOffline = () => this.update('app', { online: false }, { skipHistory: true });

    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    this.#cleanupFns.push(() => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    });

    // ── Platform event bridge — progress-tracker.js ───────────────────────────
    // Listen for progress events and mirror them into the dashboard slice
    // so components only need to subscribe to the store, not multiple event sources.
    const onProgressUpdated = (e) => {
      const summary = e.detail?.summary;
      if (!summary) return;

      this.update('dashboard', {
        xp:           summary.xp          ?? this.#state.dashboard.xp,
        level:        summary.level       ?? this.#state.dashboard.level,
        progressPct:  summary.progressPct ?? this.#state.dashboard.progressPct,
        xpForNext:    summary.xpForNext   ?? this.#state.dashboard.xpForNext,
        xpNeeded:     summary.xpNeeded    ?? this.#state.dashboard.xpNeeded,
        isMaxLevel:   summary.isMaxLevel  ?? this.#state.dashboard.isMaxLevel,
        achievements: summary.achievements?.all ?? this.#state.dashboard.achievements,
        streak:       summary.streak      ?? this.#state.dashboard.streak,
      }, { type: 'bridge:progress:updated', skipHistory: true });

      if (summary.tutorials || summary.quizzes || summary.projects) {
        this.update('learning', {
          completedLessons: summary.tutorials?.records ?? this.#state.learning.completedLessons,
        }, { type: 'bridge:progress:updated', skipHistory: true });

        this.update('projects', {
          totalCompleted: summary.projects?.completed ?? this.#state.projects.totalCompleted,
        }, { type: 'bridge:progress:updated', skipHistory: true });

        this.update('quiz', {
          statistics: {
            totalAttempts: summary.quizzes?.attempted ?? this.#state.quiz.statistics.totalAttempts,
            totalPassed:   summary.quizzes?.passed    ?? this.#state.quiz.statistics.totalPassed,
            accuracy:      summary.quizzes?.accuracy  ?? this.#state.quiz.statistics.accuracy,
          },
        }, { type: 'bridge:progress:updated', skipHistory: true });
      }
    };

    document.addEventListener('progress:updated', onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener('progress:updated', onProgressUpdated)
    );

    // ── Quiz state bridge ─────────────────────────────────────────────────────
    const onQuizSubmitted = (e) => {
      const { quizId, score, total, passed, grade, xp } = e.detail ?? {};
      if (!quizId) return;

      this.update('quiz', {
        status: 'complete',
        score:  score ?? 0,
        maxScore: total ?? 0,
      }, { type: 'bridge:quiz:submitted', skipHistory: true });
    };

    const onQuizStarted = (e) => {
      const { quizId, total } = e.detail ?? {};
      this.update('quiz', {
        currentQuizId: quizId ?? null,
        status:        'active',
        score:         0,
        maxScore:      total ?? 0,
        answers:       {},
      }, { type: 'bridge:quiz:started', skipHistory: true });
    };

    document.addEventListener('quiz:submitted', onQuizSubmitted);
    document.addEventListener('quiz:started',   onQuizStarted);
    this.#cleanupFns.push(() => {
      document.removeEventListener('quiz:submitted', onQuizSubmitted);
      document.removeEventListener('quiz:started',   onQuizStarted);
    });

    // ── Editor state bridge ───────────────────────────────────────────────────
    const onEditorChanged = (e) => {
      const { value, lines, chars } = e.detail ?? {};
      if (value === undefined) return;

      this.update('editor', {
        code:    value,
        isDirty: true,
      }, { type: 'bridge:editor:changed', skipHistory: true });
    };

    const onEditorSaved = () => {
      this.update('editor', {
        isDirty: false,
      }, { type: 'bridge:editor:saved', skipHistory: true });
    };

    document.addEventListener('editor:changed', onEditorChanged);
    document.addEventListener('editor:saved',   onEditorSaved);
    this.#cleanupFns.push(() => {
      document.removeEventListener('editor:changed', onEditorChanged);
      document.removeEventListener('editor:saved',   onEditorSaved);
    });

    // ── Router navigation bridge ──────────────────────────────────────────────
    const onRouterNavigated = (e) => {
      const { pathname } = e.detail ?? {};
      if (!pathname) return;

      // Mark app as not-loading after initial navigation
      if (this.#state.app.loading) {
        this.update('app', { loading: false }, { skipHistory: true });
      }
    };

    document.addEventListener('router:navigated', onRouterNavigated);
    this.#cleanupFns.push(() =>
      document.removeEventListener('router:navigated', onRouterNavigated)
    );

    // ── Achievement notifications bridge ───────────────────────────────────
    const onAchievementUnlocked = (e) => {
      const achievement = e.detail?.achievement;
      if (!achievement) return;

      const existing     = this.#state.dashboard.notifications;
      const notification = {
        id:       `ach-${achievement.id}-${Date.now()}`,
        type:     'achievement',
        title:    `Achievement: ${achievement.title ?? achievement.id}`,
        ts:       Date.now(),
        isNew:    true,
      };

      this.update('dashboard', {
        notifications: [notification, ...existing].slice(0, 20),
      }, { type: 'bridge:achievement:unlocked', skipHistory: true });
    };

    document.addEventListener('progress:achievement:unlocked', onAchievementUnlocked);
    this.#cleanupFns.push(() =>
      document.removeEventListener('progress:achievement:unlocked', onAchievementUnlocked)
    );
  }

  // ---- Private: guards ----------------------------------------------------

  /**
   * Throw if the store has been destroyed.
   */
  #assertAlive() {
    if (this.#destroyed) {
      throw new Error('[StateStore] Cannot operate on a destroyed store. Create a new instance.');
    }
  }

  // ---- Private: error handling --------------------------------------------

  /**
   * Emit an error event and log to the console.
   * Appends a typed error entry to app.errors in the state (non-mutating
   * to the external contract — uses skipHistory and silent to avoid loops).
   *
   * @param {string} message
   * @param {Error|*} [error]
   */
  #emitError(message, error = null) {
    console.error('[StateStore]', message, error ?? '');

    const errorEntry = { id: `e-${Date.now()}`, message, ts: Date.now() };

    try {
      const errors = [...this.#state.app.errors, errorEntry].slice(-10);
      this.#state  = Object.freeze({
        ...this.#state,
        app: Object.freeze({ ...this.#state.app, errors: Object.freeze(errors) }),
      });
    } catch {
      // If the state update itself fails, just emit the event
    }

    this.#dispatch(STATE_EVENTS.ERROR, { message, error });
  }

  // ---- Private: safe state copy for event payloads ------------------------

  /**
   * Returns a shallow copy of the top-level state slices for event payloads.
   * Avoids deep-cloning the entire tree on every dispatch.
   *
   * @returns {object}
   */
  #safeStateCopy() {
    return { ...this.#state };
  }

  // ---- Private: event bus -------------------------------------------------

  /**
   * Publish an event to the platform event bus and as a native CustomEvent.
   * Consistent pattern with all other components in the codebase.
   *
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  #dispatch(eventName, detail = {}) {
    if (window.__pyaiEvents?.emit) {
      window.__pyaiEvents.emit(eventName, detail);
    }

    document.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles:    true,
        cancelable: false,
        detail,
      })
    );
  }
}