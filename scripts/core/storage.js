/**
 * =============================================================================
 * UNIFIED STORAGE LAYER
 * scripts/core/storage.js
 * -----------------------------------------------------------------------------
 * Central persistence abstraction for the Python for AI educational platform.
 * Every component — state.js, progress-tracker.js, quiz.js, code-editor.js,
 * dashboard.js, and router.js — uses this module instead of accessing
 * localStorage or sessionStorage directly.
 *
 * ARCHITECTURE:
 *   StorageManager (default export)
 *     ├─ StorageBackend          — detects available engine and provides a
 *     │   ├─ LocalStorageEngine  │  normalised {get,set,remove,clear,keys} API
 *     │   ├─ SessionStorageEngine│  for localStorage, sessionStorage, and
 *     │   └─ MemoryEngine        │  in-memory fallback
 *     ├─ RecordMetadata          — wraps every stored value with TTL, version,
 *     │                            namespace, and created/updated timestamps
 *     ├─ MigrationRunner         — executes registered schema migrations in
 *     │                            version-order on initialize()
 *     └─ ReadCache               — single-tick LRU cache for repeated hot reads
 *
 * STORED RECORD ENVELOPE (opaque to callers — serialised as JSON):
 *   {
 *     v:   number,     — schema version at write time
 *     ns:  string,     — namespace prefix (e.g. "pyai")
 *     ts:  number,     — creation timestamp (Unix ms)
 *     upd: number,     — last-update timestamp
 *     ttl: number|null,— expiry duration in ms (null = no expiry)
 *     exp: number|null,— absolute expiry timestamp (null = no expiry)
 *     val: *,          — the caller's value (serialised)
 *   }
 *
 * KEY NAMESPACING:
 *   Every key is prefixed: `{namespace}:{key}` before it reaches the engine.
 *   e.g. namespace "pyai", key "progress" → stored as "pyai:progress"
 *   clearNamespace() removes all entries whose raw engine key starts with the prefix.
 *
 * TTL EXPIRATION:
 *   set(key, value, { ttl: 60_000 }) sets an expiry 60 seconds from now.
 *   get() checks exp before returning — expired records are auto-removed and
 *   null is returned, as if the key never existed.
 *   A background sweep cleans up expired keys on initialize() and periodically.
 *
 * BATCH OPERATIONS:
 *   batchSet(entries) and batchGet(keys) execute multiple reads/writes
 *   efficiently, sharing a single serialisation pass and a single event emit.
 *
 * MIGRATION SYSTEM:
 *   registerMigration(fromVersion, toVersion, fn) registers an upgrade fn.
 *   On initialize(), StorageManager reads the stored schema version and runs
 *   any pending migrations in ascending order.
 *
 * BACKUP / RESTORE:
 *   backup() captures a complete JSON snapshot of every namespaced key.
 *   restore(snapshot) replays the snapshot, overwriting current data.
 *   Both support optional compression hooks (registered via registerCompressor).
 *
 * IMPORT / EXPORT:
 *   exportData() produces a portable JSON string containing all entries.
 *   importData(json) merges an exported payload into the current store.
 *
 * INTEGRATION WITH STATE.JS:
 *   state.js no longer calls localStorage directly — it uses a StorageManager
 *   instance injected at startup. The store's PersistenceAdapter in state.js
 *   is replaced with calls to storage.set() / storage.get().
 *
 * EVENT EMISSIONS:
 *   storage:init     { namespace, engine, version }
 *   storage:set      { key, namespace, ttl }
 *   storage:get      { key, namespace, hit, expired }
 *   storage:remove   { key, namespace }
 *   storage:clear    { namespace, count }
 *   storage:backup   { namespace, count, size }
 *   storage:restore  { namespace, count }
 *   storage:error    { message, error, key? }
 *   storage:destroy  { namespace }
 *
 * USAGE (scripts/main.js):
 *
 *   import StorageManager, { STORAGE_EVENTS } from './core/storage.js';
 *
 *   const storage = new StorageManager({
 *     namespace: 'pyai',
 *     engine:    'local',
 *     version:   1,
 *   });
 *   await storage.initialize();
 *
 *   storage.set('progress', { xp: 250, level: 3 });
 *   const progress = storage.get('progress');
 *
 *   storage.set('session-token', 'abc123', { ttl: 3_600_000 });
 *
 *   storage.registerMigration(1, 2, (data) => ({
 *     ...data,
 *     newField: 'defaultValue',
 *   }));
 *
 *   const backup  = storage.backup();
 *   storage.restore(backup);
 *
 *   document.addEventListener(STORAGE_EVENTS.ERROR, (e) => {
 *     console.error('[Storage]', e.detail.message);
 *   });
 *
 * EXPORTS:
 *   StorageManager  — primary class (default export)
 *   STORAGE_EVENTS  — event name constants
 *   STORAGE_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the storage manager.
 * All events bubble on document and are published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STORAGE_EVENTS = Object.freeze({
  INIT:    'storage:init',
  SET:     'storage:set',
  GET:     'storage:get',
  REMOVE:  'storage:remove',
  CLEAR:   'storage:clear',
  BACKUP:  'storage:backup',
  RESTORE: 'storage:restore',
  ERROR:   'storage:error',
  DESTROY: 'storage:destroy',
});

/**
 * Default configuration values for the StorageManager.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const STORAGE_DEFAULTS = Object.freeze({
  /** Default namespace prefix applied to every key */
  NAMESPACE:           'pyai',

  /** Preferred storage engine: 'local' | 'session' | 'memory' */
  ENGINE:              'local',

  /** Storage schema version — increment when the envelope shape changes */
  VERSION:             1,

  /** Debounce delay (ms) for batch write operations */
  WRITE_DEBOUNCE_MS:   100,

  /** How often (ms) the background expiry sweep runs */
  SWEEP_INTERVAL_MS:   60_000,

  /** Maximum number of entries the read cache holds */
  CACHE_CAPACITY:      64,

  /** Maximum approximate size (bytes) before quota warnings are emitted */
  QUOTA_WARN_BYTES:    4_000_000,   // ~4 MB of the typical 5–10 MB budget

  /** Separator between namespace prefix and user key */
  KEY_SEPARATOR:       ':',

  /** localStorage key that stores the current schema version */
  VERSION_KEY:         '__pyai_storage_version__',

  /** Maximum number of migrations storable */
  MAX_MIGRATIONS:      50,
});

// ---------------------------------------------------------------------------
// Pure utility functions (module-private)
// ---------------------------------------------------------------------------

/**
 * Returns a debounced wrapper around the given function.
 * Exposes .flush() and .cancel() on the returned function,
 * consistent with state.js and router.js.
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
 * Safely serialise a value to a JSON string.
 * Returns null and emits a console warning if serialisation fails.
 *
 * @param {*}      value
 * @param {string} [context=''] — Caller label for error messages
 * @returns {string|null}
 */
function safeStringify(value, context = '') {
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.warn(`[Storage] Failed to serialise value${context ? ` for "${context}"` : ''}:`, err);
    return null;
  }
}

/**
 * Safely parse a JSON string.
 * Returns null and emits a console warning if parsing fails.
 *
 * @param {string|null} raw
 * @param {string}      [context='']
 * @returns {*}
 */
function safeParse(raw, context = '') {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Storage] Failed to parse value${context ? ` for "${context}"` : ''}:`, err);
    return null;
  }
}

/**
 * Estimate the byte size of a string (UTF-16 code units × 2).
 * Not perfectly accurate for multi-byte Unicode but fast and sufficient
 * for quota estimation.
 *
 * @param {string} str
 * @returns {number}
 */
function estimateBytes(str) {
  return String(str).length * 2;
}

/**
 * Returns the current Unix ms timestamp.
 * @returns {number}
 */
function now() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Storage engines
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   get:    (key: string) => string|null,
 *   set:    (key: string, value: string) => void,
 *   remove: (key: string) => void,
 *   clear:  () => void,
 *   keys:   () => string[],
 *   name:   string,
 *   estimateUsage: () => number,
 * }} IStorageEngine
 */

/**
 * Probes whether a Web Storage API (localStorage or sessionStorage) is available
 * and writable. Returns false when blocked by browser policy (e.g. private mode
 * in Safari) or when the storage quota is full.
 *
 * @param {Storage} store
 * @returns {boolean}
 */
function probeWebStorage(store) {
  const probe = '__pyai_probe__';
  try {
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * localStorage engine.
 * Data persists across browser sessions (tabs, windows, restarts).
 *
 * @implements {IStorageEngine}
 */
class LocalStorageEngine {
  /** @type {string} */
  name = 'localStorage';

  /**
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    localStorage.setItem(key, value);
  }

  /**
   * @param {string} key
   */
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* swallow */ }
  }

  clear() {
    try { localStorage.clear(); } catch { /* swallow */ }
  }

  /**
   * @returns {string[]}
   */
  keys() {
    try {
      return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    } catch {
      return [];
    }
  }

  /**
   * Estimate total localStorage usage in bytes.
   * Iterates all keys and sums raw string lengths × 2.
   *
   * @returns {number}
   */
  estimateUsage() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? '';
        const val = localStorage.getItem(key) ?? '';
        total += estimateBytes(key) + estimateBytes(val);
      }
      return total;
    } catch {
      return 0;
    }
  }
}

/**
 * sessionStorage engine.
 * Data persists for the lifetime of the browser tab/session only.
 * Useful for transient state like quiz sessions.
 *
 * @implements {IStorageEngine}
 */
class SessionStorageEngine {
  /** @type {string} */
  name = 'sessionStorage';

  /**
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    sessionStorage.setItem(key, value);
  }

  /**
   * @param {string} key
   */
  remove(key) {
    try { sessionStorage.removeItem(key); } catch { /* swallow */ }
  }

  clear() {
    try { sessionStorage.clear(); } catch { /* swallow */ }
  }

  /**
   * @returns {string[]}
   */
  keys() {
    try {
      return Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i) ?? '');
    } catch {
      return [];
    }
  }

  /**
   * @returns {number}
   */
  estimateUsage() {
    try {
      let total = 0;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) ?? '';
        const val = sessionStorage.getItem(key) ?? '';
        total += estimateBytes(key) + estimateBytes(val);
      }
      return total;
    } catch {
      return 0;
    }
  }
}

/**
 * In-memory engine.
 * Used as an automatic fallback when Web Storage is unavailable.
 * Data is lost when the page is unloaded.
 *
 * @implements {IStorageEngine}
 */
class MemoryEngine {
  /** @type {string} */
  name = 'memory';

  /** @type {Map<string, string>} */
  #store = new Map();

  /**
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    return this.#store.get(key) ?? null;
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    this.#store.set(key, value);
  }

  /**
   * @param {string} key
   */
  remove(key) {
    this.#store.delete(key);
  }

  clear() {
    this.#store.clear();
  }

  /**
   * @returns {string[]}
   */
  keys() {
    return [...this.#store.keys()];
  }

  /**
   * @returns {number}
   */
  estimateUsage() {
    let total = 0;
    for (const [k, v] of this.#store) {
      total += estimateBytes(k) + estimateBytes(v);
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// StorageBackend — selects and wraps the appropriate engine
// ---------------------------------------------------------------------------

/**
 * Selects the appropriate storage engine based on the config and
 * availability probes. Falls through: local → session → memory.
 *
 * @param {'local'|'session'|'memory'} preferred
 * @returns {IStorageEngine}
 */
function selectEngine(preferred) {
  if (preferred === 'memory') return new MemoryEngine();

  if (preferred === 'session') {
    try {
      if (probeWebStorage(sessionStorage)) return new SessionStorageEngine();
    } catch { /* blocked */ }
    return new MemoryEngine();
  }

  // preferred === 'local' (default)
  try {
    if (probeWebStorage(localStorage)) return new LocalStorageEngine();
  } catch { /* blocked */ }

  // Fallback 1: try session storage
  try {
    if (probeWebStorage(sessionStorage)) {
      console.warn('[Storage] localStorage unavailable; falling back to sessionStorage.');
      return new SessionStorageEngine();
    }
  } catch { /* blocked */ }

  // Fallback 2: in-memory
  console.warn('[Storage] Web Storage unavailable; falling back to in-memory store. Data will not persist.');
  return new MemoryEngine();
}

// ---------------------------------------------------------------------------
// ReadCache — single-tick LRU cache for hot reads
// ---------------------------------------------------------------------------

/**
 * Lightweight LRU cache keyed by the raw (namespaced) storage key.
 * Cached entries are the already-parsed record envelopes, avoiding redundant
 * JSON.parse() calls for the same key within a single event loop tick.
 *
 * Eviction strategy: when capacity is exceeded the oldest (insertion-order
 * first) entry is removed. Map iteration is insertion-ordered in ES2015+.
 */
class ReadCache {
  /** @type {Map<string, *>} */
  #map = new Map();

  /** @type {number} */
  #capacity;

  /** @param {number} capacity */
  constructor(capacity = STORAGE_DEFAULTS.CACHE_CAPACITY) {
    this.#capacity = Math.max(1, capacity);
  }

  /**
   * @param {string} key
   * @returns {* | undefined}
   */
  get(key) {
    if (!this.#map.has(key)) return undefined;
    // Refresh entry to most-recent by delete + re-insert
    const val = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, val);
    return val;
  }

  /**
   * @param {string} key
   * @param {*}      value
   */
  set(key, value) {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);

    while (this.#map.size > this.#capacity) {
      // Delete the oldest entry (first inserted = first in Map iteration)
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
  }

  /**
   * @param {string} key
   */
  invalidate(key) {
    this.#map.delete(key);
  }

  /**
   * Invalidate all entries whose key starts with the given prefix.
   *
   * @param {string} prefix
   */
  invalidatePrefix(prefix) {
    for (const k of this.#map.keys()) {
      if (k.startsWith(prefix)) this.#map.delete(k);
    }
  }

  clear() {
    this.#map.clear();
  }

  /** @returns {number} */
  get size() { return this.#map.size; }
}

// ---------------------------------------------------------------------------
// MigrationRunner — versioned schema upgrade system
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   from:    number,
 *   to:      number,
 *   migrate: (data: Record<string, *>) => Record<string, *>,
 * }} Migration
 */

/**
 * Runs registered schema migrations in ascending version order when the stored
 * schema version is older than the current version.
 *
 * Migrations receive a Record of { rawKey → parsed value } and must return
 * the same shape (possibly with new keys, renamed keys, or transformed values).
 * The runner then re-writes every changed entry through the storage engine.
 */
class MigrationRunner {
  /** @type {Migration[]} */
  #migrations = [];

  /**
   * Register a migration from one schema version to the next.
   *
   * @param {number} from   — The schema version this migration upgrades from
   * @param {number} to     — The schema version this migration upgrades to
   * @param {(data: Record<string, *>) => Record<string, *>} migrate
   */
  register(from, to, migrate) {
    if (typeof migrate !== 'function') {
      throw new TypeError('[Storage] Migration must be a function.');
    }
    if (to <= from) {
      throw new RangeError(`[Storage] Migration "to" version (${to}) must be greater than "from" (${from}).`);
    }
    if (this.#migrations.length >= STORAGE_DEFAULTS.MAX_MIGRATIONS) {
      throw new Error('[Storage] Maximum number of migrations reached.');
    }

    this.#migrations.push({ from, to, migrate });
    this.#migrations.sort((a, b) => a.from - b.from);
  }

  /**
   * Run all migrations required to upgrade from storedVersion to currentVersion.
   *
   * @param {number}               storedVersion
   * @param {number}               currentVersion
   * @param {Record<string, *>}    data   — Map of namespaced key → parsed value
   * @returns {{ data: Record<string, *>, ran: number }} — Updated data and count of migrations run
   */
  run(storedVersion, currentVersion, data) {
    if (storedVersion >= currentVersion) return { data, ran: 0 };

    let current = { ...data };
    let ran     = 0;
    let version = storedVersion;

    for (const migration of this.#migrations) {
      if (migration.from < version) continue;
      if (migration.from !== version) break; // gap — stop here
      if (migration.to > currentVersion) break;

      try {
        current = migration.migrate(current) ?? current;
        version = migration.to;
        ran++;
      } catch (err) {
        console.error(`[Storage] Migration ${migration.from}→${migration.to} failed:`, err);
        break;
      }
    }

    return { data: current, ran };
  }

  /** @returns {number} Number of registered migrations */
  get count() { return this.#migrations.length; }
}

// ---------------------------------------------------------------------------
// Record envelope helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a caller value in the storage record envelope.
 *
 * @param {*}           value
 * @param {string}      namespace
 * @param {number}      version
 * @param {number|null} ttl     — Duration in ms (null = no expiry)
 * @returns {{v:number, ns:string, ts:number, upd:number, ttl:number|null, exp:number|null, val:*}}
 */
function wrapRecord(value, namespace, version, ttl = null) {
  const ts  = now();
  const exp = ttl !== null && Number.isFinite(ttl) && ttl > 0
    ? ts + ttl
    : null;

  return {
    v:   version,
    ns:  namespace,
    ts,
    upd: ts,
    ttl: ttl ?? null,
    exp,
    val: value,
  };
}

/**
 * Check whether a parsed record envelope has expired.
 *
 * @param {{ exp: number|null }} record
 * @returns {boolean}
 */
function isExpired(record) {
  return record.exp !== null && now() > record.exp;
}

// ---------------------------------------------------------------------------
// ValidationHook type
// ---------------------------------------------------------------------------

/**
 * @typedef {(key: string, value: *) => boolean | string} ValidationHook
 * A function that receives (key, value) and returns:
 *   true          — value is valid
 *   false         — value is invalid (generic error)
 *   string        — value is invalid (error message)
 */

// ---------------------------------------------------------------------------
// StorageManager — primary class
// ---------------------------------------------------------------------------

/**
 * Unified storage layer for the Python for AI platform.
 *
 * Lifecycle:
 *   1. new StorageManager(config)    — no side-effects
 *   2. .initialize()                 — selects engine, runs migrations,
 *                                      starts expiry sweep, emits storage:init
 *   3. .set() / .get() / .remove()   — read/write/delete operations
 *   4. .batchSet() / .batchGet()     — bulk operations
 *   5. .backup() / .restore()        — snapshot and replay
 *   6. .exportData() / .importData() — portable JSON exchange
 *   7. .destroy()                    — flushes writes, cancels timers, clears cache
 */
export default class StorageManager {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   namespace:        string,
   *   engine:           'local'|'session'|'memory',
   *   version:          number,
   *   writeDebounceMs:  number,
   *   sweepIntervalMs:  number,
   *   cacheCapacity:    number,
   *   quotaWarnBytes:   number,
   *   keySeparator:     string,
   *   versionKey:       string,
   * }}
   */
  #config;

  // ---- Engine and sub-systems ----------------------------------------------

  /** @type {IStorageEngine} */
  #engine;

  /** @type {ReadCache} */
  #cache;

  /** @type {MigrationRunner} */
  #migrations;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean} */ #initialised = false;
  /** @type {boolean} */ #destroyed   = false;

  // ---- Compression hook (optional) ----------------------------------------

  /**
   * Optional compression function.
   * If registered, called on the final JSON string before writing.
   * Must be a synchronous string → string transform.
   *
   * @type {((raw: string) => string) | null}
   */
  #compress = null;

  /**
   * Optional decompression function.
   * Called on the raw string retrieved from the engine before parsing.
   *
   * @type {((compressed: string) => string) | null}
   */
  #decompress = null;

  // ---- Validation hook (optional) -----------------------------------------

  /**
   * Optional validation function called before every write.
   *
   * @type {ValidationHook | null}
   */
  #validator = null;

  // ---- Batch write queue ---------------------------------------------------

  /**
   * Pending batch writes queued by set().
   * Flushed by the debounced writer or explicitly via flushWrites().
   * Map from raw (namespaced) key → serialised string to write.
   *
   * @type {Map<string, string>}
   */
  #writeQueue = new Map();

  /** @type {Function & { flush: () => void, cancel: () => void }} */
  #debouncedFlush;

  // ---- Expiry sweep --------------------------------------------------------

  /** @type {number|null} — setInterval return value */
  #sweepTimer = null;

  // ---- Cleanup references -------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   namespace?:        string,
   *   engine?:           'local'|'session'|'memory',
   *   version?:          number,
   *   writeDebounceMs?:  number,
   *   sweepIntervalMs?:  number,
   *   cacheCapacity?:    number,
   *   quotaWarnBytes?:   number,
   *   keySeparator?:     string,
   *   versionKey?:       string,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      namespace:       config.namespace       ?? STORAGE_DEFAULTS.NAMESPACE,
      engine:          config.engine          ?? STORAGE_DEFAULTS.ENGINE,
      version:         config.version         ?? STORAGE_DEFAULTS.VERSION,
      writeDebounceMs: config.writeDebounceMs ?? STORAGE_DEFAULTS.WRITE_DEBOUNCE_MS,
      sweepIntervalMs: config.sweepIntervalMs ?? STORAGE_DEFAULTS.SWEEP_INTERVAL_MS,
      cacheCapacity:   config.cacheCapacity   ?? STORAGE_DEFAULTS.CACHE_CAPACITY,
      quotaWarnBytes:  config.quotaWarnBytes  ?? STORAGE_DEFAULTS.QUOTA_WARN_BYTES,
      keySeparator:    config.keySeparator    ?? STORAGE_DEFAULTS.KEY_SEPARATOR,
      versionKey:      config.versionKey      ?? STORAGE_DEFAULTS.VERSION_KEY,
    });

    this.#engine     = new MemoryEngine();   // overwritten in initialize()
    this.#cache      = new ReadCache(this.#config.cacheCapacity);
    this.#migrations = new MigrationRunner();

    this.#debouncedFlush = debounce(
      () => this.#flushWriteQueue(),
      this.#config.writeDebounceMs
    );
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Initialise the storage manager.
   *
   * Actions (in order):
   *   1. Select the storage engine based on config and availability probes
   *   2. Read the stored schema version
   *   3. Run any pending migrations
   *   4. Write the current schema version
   *   5. Sweep expired entries
   *   6. Start the background sweep interval
   *   7. Emit storage:init
   *
   * @returns {Promise<StorageManager>} this — for chaining
   */
  async initialize() {
    if (this.#initialised) return this;
    this.#assertAlive();

    // Select engine
    this.#engine = selectEngine(this.#config.engine);

    // Read stored schema version
    const storedVersionRaw = this.#engine.get(this.#config.versionKey);
    const storedVersion    = storedVersionRaw !== null ? Number(storedVersionRaw) : 0;

    // Run migrations if needed
    if (storedVersion < this.#config.version && this.#migrations.count > 0) {
      await this.#runMigrations(storedVersion);
    }

    // Write the current version
    try {
      this.#engine.set(this.#config.versionKey, String(this.#config.version));
    } catch (err) {
      this.#emitError('Failed to write schema version.', err);
    }

    // Sweep expired entries
    this.#sweepExpired();

    // Start background sweep
    if (this.#config.sweepIntervalMs > 0) {
      this.#sweepTimer = setInterval(
        () => this.#sweepExpired(),
        this.#config.sweepIntervalMs
      );
    }

    this.#initialised = true;

    this.#dispatch(STORAGE_EVENTS.INIT, {
      namespace: this.#config.namespace,
      engine:    this.#engine.name,
      version:   this.#config.version,
    });

    return this;
  }

  /**
   * Flush any pending writes, cancel timers, clear the cache, and
   * mark the instance as destroyed.
   */
  destroy() {
    if (this.#destroyed) return;

    // Flush any debounced writes synchronously before teardown
    this.#debouncedFlush.flush();

    if (this.#sweepTimer !== null) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    this.#cache.clear();
    this.#writeQueue.clear();
    this.#destroyed   = true;
    this.#initialised = false;

    this.#dispatch(STORAGE_EVENTS.DESTROY, {
      namespace: this.#config.namespace,
    });
  }

  // ---- Public API: core CRUD -----------------------------------------------

  /**
   * Store a value under the given key.
   * The value is serialised to JSON and wrapped in the record envelope.
   * Writes are debounced — call flushWrites() to force an immediate write.
   *
   * @param {string}  key
   * @param {*}       value
   * @param {{
   *   ttl?:         number | null,   — TTL in ms (null = no expiry)
   *   immediate?:   boolean,         — Skip debounce and write immediately
   *   skipValidate?: boolean,        — Bypass the registered validator
   * }} [options={}]
   * @returns {boolean} True if the value was accepted and queued
   */
  set(key, value, options = {}) {
    this.#assertAlive();

    const { ttl = null, immediate = false, skipValidate = false } = options;

    // Validation hook
    if (!skipValidate && this.#validator) {
      const result = this.#runValidator(key, value);
      if (result !== true) {
        this.#emitError(
          typeof result === 'string' ? result : `Validation failed for key "${key}".`,
          null,
          key
        );
        return false;
      }
    }

    const rawKey = this.#rawKey(key);
    const record  = wrapRecord(value, this.#config.namespace, this.#config.version, ttl);
    const json    = safeStringify(record, key);

    if (json === null) {
      this.#emitError(`Failed to serialise value for key "${key}".`, null, key);
      return false;
    }

    const serialised = this.#compress ? this.#compress(json) : json;

    // Update the read cache immediately so hot reads are consistent
    this.#cache.set(rawKey, record);

    // Queue the write
    this.#writeQueue.set(rawKey, serialised);

    if (immediate) {
      this.#flushWriteQueue();
    } else {
      this.#debouncedFlush();
    }

    this.#dispatch(STORAGE_EVENTS.SET, {
      key,
      namespace: this.#config.namespace,
      ttl,
    });

    this.#checkQuota();

    return true;
  }

  /**
   * Retrieve a value by key.
   * Returns null if the key does not exist or if the record has expired.
   *
   * @param {string}  key
   * @param {*}       [defaultValue=null] — Returned when the key is missing/expired
   * @returns {*}
   */
  get(key, defaultValue = null) {
    this.#assertAlive();

    const rawKey = this.#rawKey(key);

    // Check the write queue first — pending writes are visible immediately
    if (this.#writeQueue.has(rawKey)) {
      const cached = this.#cache.get(rawKey);
      if (cached !== undefined) {
        if (isExpired(cached)) {
          this.#removeDirect(rawKey);
          this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: false, expired: true });
          return defaultValue;
        }
        this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: true, expired: false });
        return cached.val;
      }
    }

    // Check the read cache
    const cached = this.#cache.get(rawKey);
    if (cached !== undefined) {
      if (isExpired(cached)) {
        this.#removeDirect(rawKey);
        this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: false, expired: true });
        return defaultValue;
      }
      this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: true, expired: false });
      return cached.val;
    }

    // Read from the engine
    const raw = this.#engine.get(rawKey);
    if (raw === null) {
      this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: false, expired: false });
      return defaultValue;
    }

    const decompressed = this.#decompress ? this.#decompress(raw) : raw;
    const record       = safeParse(decompressed, key);

    if (record === null || typeof record !== 'object') {
      this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: false, expired: false });
      return defaultValue;
    }

    // Expiry check
    if (isExpired(record)) {
      this.#removeDirect(rawKey);
      this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: false, expired: true });
      return defaultValue;
    }

    // Cache the parsed record for subsequent reads in this tick
    this.#cache.set(rawKey, record);

    this.#dispatch(STORAGE_EVENTS.GET, { key, namespace: this.#config.namespace, hit: true, expired: false });
    return record.val;
  }

  /**
   * Check whether a non-expired entry exists for the given key.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key, undefined) !== undefined && this.get(key) !== null;
  }

  /**
   * Remove a single key from storage.
   *
   * @param {string} key
   * @returns {boolean} True if the key existed and was removed
   */
  remove(key) {
    this.#assertAlive();

    const rawKey = this.#rawKey(key);
    const existed = this.#engine.get(rawKey) !== null || this.#writeQueue.has(rawKey);

    this.#removeDirect(rawKey);

    if (existed) {
      this.#dispatch(STORAGE_EVENTS.REMOVE, {
        key,
        namespace: this.#config.namespace,
      });
    }

    return existed;
  }

  /**
   * Remove ALL keys from the storage engine (including those outside the namespace).
   * Use clearNamespace() to restrict removal to the current namespace.
   *
   * @returns {number} Number of entries removed
   */
  clear() {
    this.#assertAlive();

    const count = this.#engine.keys().length;
    this.#engine.clear();
    this.#cache.clear();
    this.#writeQueue.clear();
    this.#debouncedFlush.cancel();

    this.#dispatch(STORAGE_EVENTS.CLEAR, {
      namespace: this.#config.namespace,
      count,
    });

    return count;
  }

  /**
   * Remove all entries that belong to this manager's namespace.
   * Entries written by other namespaces are left untouched.
   *
   * @returns {number} Number of entries removed
   */
  clearNamespace() {
    this.#assertAlive();

    const prefix  = this.#prefix();
    const toDelete = this.#engine.keys().filter((k) => k.startsWith(prefix));

    for (const rawKey of toDelete) {
      this.#engine.remove(rawKey);
      this.#cache.invalidate(rawKey);
      this.#writeQueue.delete(rawKey);
    }

    this.#debouncedFlush.cancel();

    this.#dispatch(STORAGE_EVENTS.CLEAR, {
      namespace: this.#config.namespace,
      count:     toDelete.length,
    });

    return toDelete.length;
  }

  // ---- Public API: enumeration --------------------------------------------

  /**
   * Return all non-expired user keys in this namespace (without the prefix).
   *
   * @returns {string[]}
   */
  keys() {
    this.#assertAlive();

    const prefix = this.#prefix();
    const sep    = this.#config.keySeparator;

    return this.#engine.keys()
      .filter((k) => k.startsWith(prefix) && k !== this.#config.versionKey)
      .map((k) => k.slice(prefix.length))
      .filter((userKey) => {
        // Exclude expired entries from the key list
        const record = this.#readRecord(prefix + userKey);
        return record !== null && !isExpired(record);
      });
  }

  /**
   * Return all non-expired [key, value] pairs in this namespace.
   *
   * @returns {Array<[string, *]>}
   */
  entries() {
    this.#assertAlive();

    return this.keys().map((key) => [key, this.get(key)]);
  }

  /**
   * Return the count of non-expired entries in this namespace.
   *
   * @returns {number}
   */
  size() {
    return this.keys().length;
  }

  // ---- Public API: batch operations ----------------------------------------

  /**
   * Write multiple key-value pairs in a single batch.
   * Shares one debounce window and emits one storage:set event summary.
   *
   * @param {Array<{ key: string, value: *, ttl?: number|null }>} entries
   * @returns {number} Number of entries successfully queued
   */
  batchSet(entries) {
    this.#assertAlive();

    if (!Array.isArray(entries) || entries.length === 0) return 0;

    let accepted = 0;

    for (const entry of entries) {
      if (!entry || typeof entry.key !== 'string') continue;
      // Use immediate:false, skipValidate:false — validation runs per entry
      const ok = this.set(entry.key, entry.value, {
        ttl:       entry.ttl ?? null,
        immediate: false,
      });
      if (ok) accepted++;
    }

    // Force a single flush for the whole batch
    this.#debouncedFlush.flush();

    return accepted;
  }

  /**
   * Read multiple keys in a single batch.
   * Returns a Map keyed by the user key, with values (or defaultValue for misses).
   *
   * @param {string[]}  keys
   * @param {*}         [defaultValue=null]
   * @returns {Map<string, *>}
   */
  batchGet(keys) {
    this.#assertAlive();

    const result = new Map();
    for (const key of keys) {
      result.set(key, this.get(key));
    }
    return result;
  }

  /**
   * Remove multiple keys in a single batch.
   *
   * @param {string[]} keys
   * @returns {number} Number of keys that existed and were removed
   */
  batchRemove(keys) {
    this.#assertAlive();

    let removed = 0;
    for (const key of keys) {
      if (this.remove(key)) removed++;
    }
    return removed;
  }

  // ---- Public API: statistics ---------------------------------------------

  /**
   * Return storage usage and entry statistics for this namespace.
   *
   * @returns {{
   *   engine:       string,
   *   namespace:    string,
   *   entryCount:   number,
   *   totalBytes:   number,
   *   namespaceBytes: number,
   *   quotaPercent: number,
   *   cacheSize:    number,
   *   pendingWrites: number,
   * }}
   */
  stats() {
    this.#assertAlive();

    const prefix       = this.#prefix();
    const allKeys      = this.#engine.keys();
    const nsKeys       = allKeys.filter((k) => k.startsWith(prefix));
    const totalBytes   = this.#engine.estimateUsage();

    let nsBytes = 0;
    for (const k of nsKeys) {
      const raw = this.#engine.get(k) ?? '';
      nsBytes  += estimateBytes(k) + estimateBytes(raw);
    }

    return {
      engine:         this.#engine.name,
      namespace:      this.#config.namespace,
      entryCount:     this.size(),
      totalBytes,
      namespaceBytes: nsBytes,
      quotaPercent:   Math.round((totalBytes / this.#config.quotaWarnBytes) * 100),
      cacheSize:      this.#cache.size,
      pendingWrites:  this.#writeQueue.size,
    };
  }

  // ---- Public API: backup / restore ---------------------------------------

  /**
   * Capture a complete snapshot of all namespaced entries.
   * Returns a structured object safe to JSON.stringify.
   *
   * @returns {{
   *   version:   number,
   *   namespace: string,
   *   ts:        number,
   *   entries:   Array<{ key: string, raw: string }>,
   * }}
   */
  backup() {
    this.#assertAlive();

    // Flush pending writes first so the snapshot is complete
    this.#debouncedFlush.flush();

    const prefix  = this.#prefix();
    const entries = this.#engine.keys()
      .filter((k) => k.startsWith(prefix) && k !== this.#config.versionKey)
      .map((k) => ({
        key: k.slice(prefix.length),    // user key without prefix
        raw: this.#engine.get(k) ?? '', // raw serialised string
      }));

    const snapshot = {
      version:   this.#config.version,
      namespace: this.#config.namespace,
      ts:        now(),
      entries,
    };

    const totalBytes = entries.reduce(
      (sum, e) => sum + estimateBytes(e.key) + estimateBytes(e.raw),
      0
    );

    this.#dispatch(STORAGE_EVENTS.BACKUP, {
      namespace: this.#config.namespace,
      count:     entries.length,
      size:      totalBytes,
    });

    return snapshot;
  }

  /**
   * Restore a previously captured snapshot.
   * All current namespace entries are removed before replaying the snapshot.
   * The snapshot must have been created by backup() from the same (or
   * compatible) namespace and schema version.
   *
   * @param {{
   *   version:   number,
   *   namespace: string,
   *   entries:   Array<{ key: string, raw: string }>,
   * }} snapshot
   * @returns {number} Number of entries restored
   */
  restore(snapshot) {
    this.#assertAlive();

    if (!snapshot || !Array.isArray(snapshot.entries)) {
      this.#emitError('restore(): invalid snapshot object.');
      return 0;
    }

    // Clear current namespace entries
    this.clearNamespace();

    const prefix  = this.#prefix();
    let   restored = 0;

    for (const entry of snapshot.entries) {
      if (!entry.key || !entry.raw) continue;
      const rawKey = prefix + entry.key;
      try {
        this.#engine.set(rawKey, entry.raw);
        this.#cache.invalidate(rawKey);
        restored++;
      } catch (err) {
        this.#emitError(`restore(): failed to write key "${entry.key}".`, err, entry.key);
      }
    }

    this.#dispatch(STORAGE_EVENTS.RESTORE, {
      namespace: this.#config.namespace,
      count:     restored,
    });

    return restored;
  }

  // ---- Public API: import / export ----------------------------------------

  /**
   * Export all namespaced entries as a portable JSON string.
   * The exported string can be saved to a file and later imported via importData().
   *
   * @returns {string}
   */
  exportData() {
    this.#assertAlive();

    const snapshot = this.backup();
    return safeStringify(snapshot, '__exportData__') ?? '{}';
  }

  /**
   * Import entries from a JSON string previously produced by exportData().
   * Existing entries with the same key are overwritten.
   * Entries not present in the import payload are left untouched.
   *
   * @param {string} json
   * @returns {{ imported: number, skipped: number, errors: number }}
   */
  importData(json) {
    this.#assertAlive();

    const parsed = safeParse(json, '__importData__');

    if (!parsed || !Array.isArray(parsed.entries)) {
      this.#emitError('importData(): invalid or empty JSON payload.');
      return { imported: 0, skipped: 0, errors: 1 };
    }

    const prefix  = this.#prefix();
    let imported  = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const entry of parsed.entries) {
      if (!entry.key || !entry.raw) { skipped++; continue; }
      const rawKey = prefix + entry.key;

      try {
        this.#engine.set(rawKey, entry.raw);
        this.#cache.invalidate(rawKey);
        imported++;
      } catch (err) {
        this.#emitError(`importData(): failed to write key "${entry.key}".`, err, entry.key);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  // ---- Public API: hooks --------------------------------------------------

  /**
   * Register a migration from one schema version to another.
   * The migration function receives a Record<string, *> of all namespaced
   * values and returns the (possibly modified) record.
   *
   * @param {number} from
   * @param {number} to
   * @param {(data: Record<string, *>) => Record<string, *>} fn
   * @returns {StorageManager} this
   */
  registerMigration(from, to, fn) {
    this.#migrations.register(from, to, fn);
    return this;
  }

  /**
   * Register optional compression / decompression functions.
   * Both must be synchronous string → string transforms.
   * A common pair: LZ-string compress / decompress.
   *
   * @param {(raw: string) => string}          compressFn
   * @param {(compressed: string) => string}   decompressFn
   * @returns {StorageManager} this
   */
  registerCompressor(compressFn, decompressFn) {
    if (typeof compressFn !== 'function' || typeof decompressFn !== 'function') {
      throw new TypeError('[Storage] Both compress and decompress must be functions.');
    }
    this.#compress   = compressFn;
    this.#decompress = decompressFn;
    return this;
  }

  /**
   * Register a validation hook called before every set().
   * Return true to accept, false or a string message to reject.
   *
   * @param {ValidationHook} fn
   * @returns {StorageManager} this
   */
  registerValidator(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('[Storage] Validator must be a function.');
    }
    this.#validator = fn;
    return this;
  }

  /**
   * Force any pending debounced writes to flush to the engine immediately.
   * Useful before navigation events or before taking a backup.
   */
  flushWrites() {
    this.#debouncedFlush.flush();
  }

  // ---- Public API: getters ------------------------------------------------

  /** @returns {string} Active engine name ('localStorage'|'sessionStorage'|'memory') */
  get engineName() { return this.#engine.name; }

  /** @returns {boolean} */
  get isInitialised() { return this.#initialised; }

  /** @returns {boolean} */
  get isDestroyed() { return this.#destroyed; }

  /** @returns {string} Configured namespace */
  get namespace() { return this.#config.namespace; }

  /** @returns {number} Configured schema version */
  get version() { return this.#config.version; }

  // ---- Private: key building -----------------------------------------------

  /**
   * Build the fully-qualified namespace prefix including the separator.
   * e.g. "pyai:"
   *
   * @returns {string}
   */
  #prefix() {
    return `${this.#config.namespace}${this.#config.keySeparator}`;
  }

  /**
   * Prepend the namespace prefix to a user-facing key.
   *
   * @param {string} key
   * @returns {string}
   */
  #rawKey(key) {
    return `${this.#prefix()}${key}`;
  }

  // ---- Private: write queue flush -----------------------------------------

  /**
   * Write all pending entries from the write queue to the storage engine.
   * Handles QuotaExceededError by emitting a storage:error event and
   * attempting to continue with remaining entries.
   */
  #flushWriteQueue() {
    if (this.#writeQueue.size === 0) return;

    for (const [rawKey, serialised] of this.#writeQueue) {
      try {
        this.#engine.set(rawKey, serialised);
      } catch (err) {
        if (err?.name === 'QuotaExceededError' || err?.code === 22) {
          this.#emitError(
            'Storage quota exceeded. Some data may not have been saved.',
            err,
            rawKey
          );
        } else {
          this.#emitError(`Write failed for key "${rawKey}".`, err, rawKey);
        }
      }
    }

    this.#writeQueue.clear();
  }

  // ---- Private: direct removal (no event) ---------------------------------

  /**
   * Remove a single raw (prefixed) key from the engine, cache, and write queue.
   * Does not emit any event — callers emit the relevant event themselves.
   *
   * @param {string} rawKey
   */
  #removeDirect(rawKey) {
    this.#engine.remove(rawKey);
    this.#cache.invalidate(rawKey);
    this.#writeQueue.delete(rawKey);
  }

  // ---- Private: record reading --------------------------------------------

  /**
   * Read and parse a record envelope from the engine without going through
   * the public get() path (used internally for key enumeration and sweep).
   *
   * @param {string} rawKey
   * @returns {{ v: number, ns: string, ts: number, upd: number, ttl: number|null, exp: number|null, val: * } | null}
   */
  #readRecord(rawKey) {
    // Check write queue first
    const cached = this.#cache.get(rawKey);
    if (cached !== undefined) return cached;

    const raw = this.#engine.get(rawKey);
    if (raw === null) return null;

    const decompressed = this.#decompress ? this.#decompress(raw) : raw;
    const record       = safeParse(decompressed);

    if (!record || typeof record !== 'object') return null;
    return record;
  }

  // ---- Private: expiry sweep ----------------------------------------------

  /**
   * Scan all namespaced keys and remove any that have passed their expiry time.
   * Called on initialize() and periodically via sweepTimer.
   *
   * @returns {number} Number of expired entries removed
   */
  #sweepExpired() {
    const prefix  = this.#prefix();
    const nsKeys  = this.#engine.keys().filter(
      (k) => k.startsWith(prefix) && k !== this.#config.versionKey
    );

    let swept = 0;

    for (const rawKey of nsKeys) {
      const record = this.#readRecord(rawKey);
      if (record && isExpired(record)) {
        this.#removeDirect(rawKey);
        swept++;
      }
    }

    return swept;
  }

  // ---- Private: migrations ------------------------------------------------

  /**
   * Execute all pending migrations and re-write affected entries.
   *
   * @param {number} storedVersion
   */
  async #runMigrations(storedVersion) {
    const prefix = this.#prefix();
    const nsKeys = this.#engine.keys().filter(
      (k) => k.startsWith(prefix) && k !== this.#config.versionKey
    );

    // Build a data map: { rawKey → parsed value } for the migration runner
    const data = {};
    for (const rawKey of nsKeys) {
      const record = this.#readRecord(rawKey);
      if (record) {
        data[rawKey] = record.val;
      }
    }

    const { data: migrated, ran } = this.#migrations.run(
      storedVersion,
      this.#config.version,
      data
    );

    if (ran === 0) return;

    // Re-write migrated entries
    for (const [rawKey, value] of Object.entries(migrated)) {
      const userKey   = rawKey.slice(prefix.length);
      const oldRecord = this.#readRecord(rawKey);
      const ttl       = oldRecord?.ttl ?? null;

      const newRecord = wrapRecord(value, this.#config.namespace, this.#config.version, ttl);
      const json      = safeStringify(newRecord, userKey);
      if (json === null) continue;

      const serialised = this.#compress ? this.#compress(json) : json;
      try {
        this.#engine.set(rawKey, serialised);
        this.#cache.invalidate(rawKey);
      } catch (err) {
        this.#emitError(`Migration re-write failed for key "${userKey}".`, err, userKey);
      }
    }
  }

  // ---- Private: quota check -----------------------------------------------

  /**
   * Estimate storage usage and emit a warning event if the quota threshold
   * is exceeded.
   */
  #checkQuota() {
    const usage = this.#engine.estimateUsage();
    if (usage > this.#config.quotaWarnBytes) {
      this.#emitError(
        `Storage usage (${Math.round(usage / 1024)} KB) exceeds the warning threshold ` +
        `(${Math.round(this.#config.quotaWarnBytes / 1024)} KB). Consider clearing old data.`
      );
    }
  }

  // ---- Private: validation ------------------------------------------------

  /**
   * Run the registered validator hook and return the result.
   *
   * @param {string} key
   * @param {*}      value
   * @returns {true | false | string}
   */
  #runValidator(key, value) {
    if (!this.#validator) return true;
    try {
      return this.#validator(key, value);
    } catch (err) {
      console.error('[Storage] Validator threw an error:', err);
      return false;
    }
  }

  // ---- Private: guards ----------------------------------------------------

  /**
   * Throw if the instance has been destroyed.
   */
  #assertAlive() {
    if (this.#destroyed) {
      throw new Error(
        '[StorageManager] Cannot operate on a destroyed instance. Create a new one.'
      );
    }
  }

  // ---- Private: error handling --------------------------------------------

  /**
   * Emit a storage:error event and log to the console.
   *
   * @param {string}   message
   * @param {Error|*}  [error=null]
   * @param {string}   [key]
   */
  #emitError(message, error = null, key) {
    console.error('[StorageManager]', message, error ?? '');
    this.#dispatch(STORAGE_EVENTS.ERROR, { message, error, key });
  }

  // ---- Private: event bus -------------------------------------------------

  /**
   * Publish an event to the platform event bus and as a native CustomEvent.
   * Consistent pattern with every other component in the codebase.
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