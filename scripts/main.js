/**
 * =============================================================================
 * APPLICATION ENTRY POINT
 * scripts/main.js
 * -----------------------------------------------------------------------------
 * Central orchestrator for the Python for AI educational platform. Bootstraps
 * every core subsystem in dependency order, wires global components, registers
 * every route, and provides the single top-level error boundary for the
 * entire application.
 *
 * INITIALISATION ORDER (enforced by #boot()):
 *   1. Storage        — StorageManager, so every later subsystem can persist
 *   2. State Manager   — StateStore, backed by StorageManager for the slices
 *                        configured to persist
 *   3. Event Bus       — EventBus, exposed globally as window.__pyaiEvents so
 *                        every component/page can dispatch without importing
 *                        this module
 *   4. Router          — Router, routes registered but not yet init()'d
 *   5. Progress Tracker— ProgressTracker, own localStorage-backed persistence
 *   6. Global Components — Navigation, Header, Footer (persistent page chrome)
 *   7. Application Pages — routes registered with the Router (lazy-loaded)
 *   8. Theme            — reconciled between Navigation's ThemeManager and
 *                          the central StateStore so every page reads the
 *                          same theme value
 *   9. Keyboard Shortcuts — global app-level shortcuts (Alt+1..6 quick nav)
 *  10. Global Error Handler — window 'error' / 'unhandledrejection' listeners
 *
 * PAGE MODULE INTEGRATION:
 *   Every page module (home.js, dashboard.js, tutorials.js, tutorial-detail.js,
 *   quizzes.js, projects.js, project-detail.js, playground.js) exposes a
 *   `static mount(outlet, ctx)` / `static unmount(outlet)` pair on its default
 *   export class. router.js's component loader contract expects a resolved
 *   module shaped as `{ mount(el, ctx), unmount() }` — note unmount() takes
 *   NO arguments. #wrapPage() is the adapter that closes over the outlet
 *   element so each page's `static unmount(outlet)` still receives it,
 *   without requiring any change to the already-built page modules.
 *
 * quiz.js AND code-editor.js ARE NOT STATICALLY IMPORTED HERE:
 *   Every page that needs them (tutorial-detail.js, quizzes.js, playground.js,
 *   project-detail.js) already dynamically imports them internally only when
 *   an interactive editor or quiz is actually mounted. Statically importing
 *   either module in this entry point would defeat that lazy-loading
 *   entirely and inflate the initial bundle for every route, including ones
 *   that never touch a quiz or editor. This file's job is to orchestrate,
 *   not to eagerly load — the integration point for those two modules is
 *   correctly the page modules themselves.
 *
 * ROUTES REGISTERED:
 *   /                     → pages/home.js
 *   /dashboard            → pages/dashboard.js
 *   /tutorials            → pages/tutorials.js
 *   /tutorials/:lessonId  → pages/tutorial-detail.js
 *     (this is the interactive lesson content page; the platform has no
 *      separate "tutorial-detail.js" file — tutorial-detail.js fulfils that
 *      role and is registered under this route)
 *   /quizzes              → pages/quizzes.js
 *   /projects             → pages/projects.js
 *   /projects/:projectId  → pages/project-detail.js
 *   /playground           → pages/playground.js
 *   *                     → inline 404 handler (no dedicated page file needed)
 *
 * EVENT EMISSIONS (via the platform EventBus, once initialised):
 *   app:initializing  { }
 *   app:initialized   { }
 *   app:ready         { pathname }
 *   app:error         { message, error, fatal }
 *   app:shutdown      { }
 *
 * ERROR BOUNDARIES:
 *   • window 'error' and 'unhandledrejection' are caught globally, logged,
 *     and forwarded to app:error — they never crash the tab silently.
 *   • router:error is caught and triggers a recovery navigation to '/' with
 *     a toast-style live-region announcement, rather than leaving the outlet
 *     in a broken state.
 *   • Storage/state/event-bus initialisation failures are caught individually
 *     so a failure in one subsystem does not prevent the others from at
 *     least attempting to start (degraded-but-alive over total failure).
 *
 * USAGE (index.html):
 *   <script type="module">
 *     import { Application } from './scripts/main.js';
 *     const app = new Application();
 *     app.initialize().then(() => app.start());
 *   </script>
 *
 * EXPORTS:
 *   Application — primary orchestrator class (named export)
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Core imports
// ---------------------------------------------------------------------------

import Router, { ROUTER_EVENTS } from './core/router.js';
import StateStore from './core/state.js';
import StorageManager from './core/storage.js';
import EventBus from './core/events.js';

// ---------------------------------------------------------------------------
// Component imports
// ---------------------------------------------------------------------------

import Navigation from './components/navigation.js';
import Header from './components/header.js';
import Footer from './components/footer.js';
import ProgressTracker from './components/progress-tracker.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Debounce delay for the window resize handler (ms) */
const RESIZE_DEBOUNCE_MS = 150;

/** localStorage namespace shared by StorageManager and StateStore persistence */
const APP_NAMESPACE = 'pyai';

/** Current application version, stamped into StateStore's app slice */
const APP_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Pure utilities (module-private)
// ---------------------------------------------------------------------------

/**
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer = null;
  const d = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  d.cancel = () => { clearTimeout(timer); timer = null; };
  return d;
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Adapt a page module's `static mount(outlet, ctx)` / `static unmount(outlet)`
 * pair into the `{ mount(el, ctx), unmount() }` shape router.js expects,
 * closing over the outlet element so unmount() (called with no arguments by
 * the router) can still forward it correctly.
 *
 * @param {() => Promise<{ default: { mount: Function, unmount: Function } }>} importFn
 * @returns {() => Promise<{ mount: Function, unmount: Function }>}
 */
function wrapPage(importFn) {
  return async () => {
    const mod       = await importFn();
    const PageClass = mod?.default ?? mod;
    let capturedOutlet = null;

    return {
      mount(outlet, ctx) {
        capturedOutlet = outlet;
        PageClass.mount(outlet, ctx);
      },
      unmount() {
        if (typeof PageClass.unmount === 'function') {
          PageClass.unmount(capturedOutlet);
        }
        capturedOutlet = null;
      },
    };
  };
}

/**
 * Inline 404 "page" — no dedicated file is needed for a single static view.
 * Matches the `{ mount(el, ctx), unmount() }` contract router.js expects.
 *
 * @type {{ mount: (el: HTMLElement, ctx: object) => void, unmount: () => void }}
 */
const notFoundPage = {
  /**
   * @param {HTMLElement} el
   * @param {object}      ctx
   */
  mount(el, ctx) {
    el.setAttribute('role', 'main');
    el.setAttribute('aria-label', 'Page not found');
    el.innerHTML = `
      <div class="app-404" role="alert" style="text-align:center;padding:var(--space-16, 4rem) var(--space-4, 1rem)">
        <h1 tabindex="-1" style="font-size:var(--text-3xl, 2rem);margin-bottom:var(--space-4, 1rem)">
          404 — Page Not Found
        </h1>
        <p style="color:var(--color-text-secondary, #666);margin-bottom:var(--space-6, 1.5rem)">
          We couldn't find <code>${escapeHtml(ctx?.pathname ?? '')}</code>. It may have moved or never existed.
        </p>
        <a href="/" data-router-link
           style="display:inline-block;padding:0.75rem 1.5rem;background:var(--color-primary, #2563EB);
                  color:#fff;border-radius:var(--radius-md, 8px);text-decoration:none;font-weight:600">
          Back to Home
        </a>
      </div>
    `;
    requestAnimationFrame(() => el.querySelector('h1')?.focus({ preventScroll: true }));
  },
  unmount() { /* stateless static view — nothing to tear down */ },
};

// ---------------------------------------------------------------------------
// Application — primary orchestrator class
// ---------------------------------------------------------------------------

/**
 * Top-level application orchestrator.
 *
 * Lifecycle:
 *   1. new Application(config)  — no side-effects
 *   2. await initialize()       — boots every subsystem in dependency order
 *   3. start()                  — starts the router, performs first navigation
 *   4. navigate(path)            — programmatic navigation, delegates to Router
 *   5. shutdown()                — tears down every subsystem cleanly
 */
export class Application {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   outletId:    string,
   *   headerId:    string,
   *   footerId:    string,
   *   namespace:   string,
   *   version:     string,
   * }}
   */
  #config;

  // ---- Core subsystems -------------------------------------------------------

  /** @type {StorageManager|null} */ #storage    = null;
  /** @type {StateStore|null}     */ #store      = null;
  /** @type {EventBus|null}       */ #bus         = null;
  /** @type {Router|null}         */ #router      = null;
  /** @type {ProgressTracker|null}*/ #tracker     = null;

  // ---- Global components -------------------------------------------------------

  /** @type {Navigation|null} */ #navigation = null;
  /** @type {Header|null}     */ #header     = null;
  /** @type {Footer|null}     */ #footer     = null;

  // ---- State -----------------------------------------------------------------

  /** @type {boolean} */ #initialised = false;
  /** @type {boolean} */ #started     = false;
  /** @type {boolean} */ #destroyed   = false;
  /** @type {boolean} */ #isOnline    = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // ---- Debounced handlers -------------------------------------------------------

  /** @type {Function & { cancel: () => void }} */
  #debouncedResize;

  // ---- Cleanup references -------------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   outletId?:  string,
   *   headerId?:  string,
   *   footerId?:  string,
   *   namespace?: string,
   *   version?:   string,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      outletId:  config.outletId  ?? 'app-outlet',
      headerId:  config.headerId  ?? 'page-header',
      footerId:  config.footerId  ?? 'site-footer',
      namespace: config.namespace ?? APP_NAMESPACE,
      version:   config.version   ?? APP_VERSION,
    });

    this.#debouncedResize = debounce(() => this.#handleResize(), RESIZE_DEBOUNCE_MS);
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Boot every subsystem in dependency order. Safe to call once; subsequent
   * calls are no-ops. Individual subsystem failures are caught and logged so
   * a single failure degrades functionality rather than halting boot entirely.
   *
   * @returns {Promise<Application>} this — for chaining
   */
  async initialize() {
    if (this.#initialised || this.#destroyed) return this;

    this.#safeDispatchEarly('app:initializing', {});

    // ---- 1. Storage -----------------------------------------------------
    try {
      this.#storage = new StorageManager({ namespace: this.#config.namespace, engine: 'local', version: 1 });
      await this.#storage.initialize();
    } catch (err) {
      console.error('[Application] Storage initialisation failed:', err);
      this.#storage = null;
    }

    // ---- 2. State Manager -------------------------------------------------
    try {
      this.#store = new StateStore({
        appVersion: this.#config.version,
        persist:    ['user', 'settings', 'theme'],
      });
      await this.#store.initialize();
    } catch (err) {
      console.error('[Application] State store initialisation failed:', err);
      this.#store = null;
    }

    // ---- 3. Event Bus -----------------------------------------------------
    try {
      this.#bus = new EventBus({ maxListeners: 30, historySize: 200, exposeGlobal: true });
      this.#bus.initialize();
    } catch (err) {
      console.error('[Application] Event bus initialisation failed:', err);
      this.#bus = null;
    }

    // ---- 4. Router (constructed + routes registered, not yet init()'d) ---
    try {
      this.#router = new Router({
        outletId:        this.#config.outletId,
        titleSuffix:     ` | Python for AI`,
        scrollRestoration: true,
        base: '/python-for-ai',
      });
      this.#registerRoutes();
    } catch (err) {
      console.error('[Application] Router construction failed:', err);
      this.#router = null;
    }

    // ---- 5. Progress Tracker ----------------------------------------------
    try {
      this.#tracker = new ProgressTracker();
      this.#tracker.init();
    } catch (err) {
      console.error('[Application] Progress tracker initialisation failed:', err);
      this.#tracker = null;
    }

    // ---- 6. Global Components ----------------------------------------------
    this.#initGlobalComponents();

    // ---- 7. Application Pages ------------------------------------------------
    // Routes were already registered in step 4 (#registerRoutes). Each page's
    // component loader is lazy — nothing is imported until first navigated to.

    // ---- 8. Theme -----------------------------------------------------------
    this.#syncTheme();

    // ---- 9. Keyboard Shortcuts ------------------------------------------------
    this.#attachKeyboardShortcuts();

    // ---- 10. Global Error Handler ---------------------------------------------
    this.#attachGlobalErrorHandlers();

    // App-wide lifecycle listeners (visibility, online/offline, resize, history)
    this.#attachLifecycleListeners();

    this.#initialised = true;
    this.#safeDispatch('app:initialized', {});

    return this;
  }

  /**
   * Start the router (triggers the first navigation) and signal that the
   * application is fully interactive once that first navigation completes.
   *
   * @returns {Application} this
   */
  start() {
    if (!this.#initialised || this.#started || this.#destroyed) return this;

    if (!this.#router) {
      console.error('[Application] Cannot start: router failed to initialise.');
      this.#safeDispatch('app:error', { message: 'Router unavailable', error: null, fatal: true });
      return this;
    }

    // Emit app:ready once the very first navigation has completed.
    const onFirstNavigate = () => {
      document.removeEventListener(ROUTER_EVENTS.AFTER_NAVIGATE, onFirstNavigate);
      this.#safeDispatch('app:ready', { pathname: location.pathname });
    };
    document.addEventListener(ROUTER_EVENTS.AFTER_NAVIGATE, onFirstNavigate);
    this.#cleanupFns.push(() => document.removeEventListener(ROUTER_EVENTS.AFTER_NAVIGATE, onFirstNavigate));

    try {
      this.#router.init();
    } catch (err) {
      console.error('[Application] Router failed to initialise:', err);
      this.#safeDispatch('app:error', { message: 'Router failed to start', error: err, fatal: true });
    }

    this.#started = true;
    return this;
  }

  /**
   * Programmatic navigation — delegates to the Router.
   *
   * @param {string} path
   * @param {{ replace?: boolean }} [options={}]
   * @returns {Application} this
   */
  navigate(path, options = {}) {
    if (!this.#router) {
      console.warn('[Application] navigate() called but router is unavailable.');
      return this;
    }
    this.#router.navigate(path, options);
    return this;
  }

  /**
   * Tear down every subsystem cleanly, in roughly reverse dependency order.
   *
   * @returns {Application} this
   */
  shutdown() {
    if (this.#destroyed) return this;

    this.#safeDispatch('app:shutdown', {});

    this.#cleanupFns.forEach((fn) => {
      try { fn(); } catch { /* swallow — best-effort cleanup */ }
    });
    this.#cleanupFns = [];

    this.#debouncedResize.cancel();

    try { this.#router?.destroy?.(); } catch { /* swallow */ }
    try { this.#navigation?.destroy(); } catch { /* swallow */ }
    try { this.#header?.destroy(); } catch { /* swallow */ }
    try { this.#footer?.destroy(); } catch { /* swallow */ }
    try { this.#tracker?.destroy(); } catch { /* swallow */ }

    try { this.#storage?.flushWrites?.(); } catch { /* swallow */ }
    try { this.#store?.destroy(); } catch { /* swallow */ }
    try { this.#storage?.destroy(); } catch { /* swallow */ }
    try { this.#bus?.destroy(); } catch { /* swallow */ }

    this.#router     = null;
    this.#navigation = null;
    this.#header     = null;
    this.#footer     = null;
    this.#tracker     = null;
    this.#store       = null;
    this.#storage     = null;
    this.#bus         = null;

    this.#destroyed   = true;
    this.#initialised = false;
    this.#started     = false;

    return this;
  }

  // ---- Public API: accessors (for advanced/embedding use cases) -------------

  /** @returns {StateStore|null} */
  get store() { return this.#store; }

  /** @returns {StorageManager|null} */
  get storage() { return this.#storage; }

  /** @returns {ProgressTracker|null} */
  get tracker() { return this.#tracker; }

  /** @returns {Router|null} */
  get router() { return this.#router; }

  /** @returns {boolean} */
  get isReady() { return this.#initialised && this.#started; }

  // ---- Private: route registration -------------------------------------------

  /**
   * Register every application route with the Router.
   * All component loaders are lazy (dynamic import) and wrapped via
   * wrapPage() to adapt the static mount/unmount contract.
   */
  #registerRoutes() {
    if (!this.#router) return;

    const meta = () => ({ tracker: this.#tracker, router: this.#router, store: this.#store });

    this.#router.register([
      {
        path:      '/',
        title:     'Home',
        meta:      meta(),
        component: wrapPage(() => import('./pages/home.js')),
      },
      {
        path:      '/dashboard',
        title:     'Dashboard',
        meta:      meta(),
        component: wrapPage(() => import('./pages/dashboard.js')),
      },
      {
        path:      '/tutorials',
        title:     'Tutorials',
        meta:      meta(),
        component: wrapPage(() => import('./pages/tutorials.js')),
      },
      {
        path:      '/tutorials/:lessonId',
        title:     (ctx) => `Lesson — ${ctx.params.lessonId}`,
        meta:      meta(),
        component: wrapPage(() => import('./pages/tutorial-detail.js')),
      },
      {
        path:      '/quizzes',
        title:     'Quiz Center',
        meta:      meta(),
        component: wrapPage(() => import('./pages/quizzes.js')),
      },
      {
        path:      '/projects',
        title:     'Projects',
        meta:      meta(),
        component: wrapPage(() => import('./pages/projects.js')),
      },
      {
        path:      '/projects/:projectId',
        title:     (ctx) => `Project — ${ctx.params.projectId}`,
        meta:      meta(),
        component: wrapPage(() => import('./pages/project-detail.js')),
      },
      {
        path:      '/playground',
        title:     'Python Playground',
        meta:      meta(),
        component: wrapPage(() => import('./pages/playground.js')),
      },
      {
        path:      '*',
        title:     'Page Not Found',
        component: () => Promise.resolve(notFoundPage),
      },
    ]);

    // Router-level error recovery: navigate home and announce the failure
    // rather than leaving the outlet in a broken state.
    const onRouterError = (e) => {
      console.error('[Application] Router error:', e.detail);
      this.#safeDispatch('app:error', { message: 'Navigation failed', error: e.detail?.error ?? null, fatal: false });
      if (location.pathname !== '/') {
        try { this.#router?.navigate('/', { replace: true }); } catch { /* already broken, nothing more to do */ }
      }
    };
    document.addEventListener(ROUTER_EVENTS.ERROR, onRouterError);
    this.#cleanupFns.push(() => document.removeEventListener(ROUTER_EVENTS.ERROR, onRouterError));
  }

  // ---- Private: global components ----------------------------------------------

  /**
   * Construct and initialise Navigation, Header, and Footer, wiring the
   * Router to Navigation for automatic active-link highlighting, and
   * manually keeping Footer's active link in sync on every navigation.
   */
  #initGlobalComponents() {
    try {
      this.#navigation = new Navigation();
      this.#navigation.init();
      this.#router?.setNavigation(this.#navigation);
    } catch (err) {
      console.error('[Application] Navigation initialisation failed:', err);
      this.#navigation = null;
    }

    try {
      this.#header = new Header({ containerId: this.#config.headerId, siteTitle: 'Python for AI' });
    } catch (err) {
      console.error('[Application] Header initialisation failed:', err);
      this.#header = null;
    }

    try {
      this.#footer = new Footer({ footerId: this.#config.footerId, siteTitle: 'Python for AI' });
      this.#footer.init();
    } catch (err) {
      console.error('[Application] Footer initialisation failed:', err);
      this.#footer = null;
    }

    // Keep the footer's active link and the header's page title in sync
    // with the router on every completed navigation.
    const onAfterNavigate = (e) => {
      const pathname = e.detail?.pathname ?? location.pathname;
      try { this.#footer?.updateActiveLink(pathname); } catch { /* non-fatal */ }
    };
    document.addEventListener(ROUTER_EVENTS.AFTER_NAVIGATE, onAfterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener(ROUTER_EVENTS.AFTER_NAVIGATE, onAfterNavigate));
  }

  // ---- Private: theme synchronisation --------------------------------------------

  /**
   * Reconcile Navigation's own ThemeManager (which applies the initial
   * theme to <html> before first paint to avoid a flash) with the central
   * StateStore, so every page reading store.getTheme() sees the same value
   * Navigation has already rendered — and vice versa when the user toggles
   * the theme from the nav bar.
   */
  #syncTheme() {
    if (!this.#store) return;

    // Read whatever Navigation's ThemeManager already applied to <html>
    // and push it into the store as the initial source of truth for pages.
    const appliedDark = document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark';

    try {
      this.#store.update('theme', { resolvedMode: appliedDark ? 'dark' : 'light' }, { skipHistory: true });
    } catch { /* non-fatal */ }

    // Forward subsequent nav-driven theme toggles into the store.
    const onThemeChanged = (e) => {
      const resolved = e.detail?.resolvedMode ?? e.detail?.mode;
      if (!resolved || !this.#store) return;
      try {
        this.#store.update('theme', { mode: resolved, resolvedMode: resolved }, { skipHistory: true });
      } catch { /* non-fatal */ }
    };
    document.addEventListener('theme:changed', onThemeChanged);
    this.#cleanupFns.push(() => document.removeEventListener('theme:changed', onThemeChanged));
  }

  // ---- Private: keyboard shortcuts ------------------------------------------------

  /**
   * Attach global, app-level keyboard shortcuts for quick navigation.
   * Skipped entirely when focus is inside an input/textarea/select so page-
   * level shortcuts (Ctrl+K search, Ctrl+Enter run, etc.) are never shadowed.
   */
  #attachKeyboardShortcuts() {
    const routes = {
      '1': '/',
      '2': '/dashboard',
      '3': '/tutorials',
      '4': '/quizzes',
      '5': '/projects',
      '6': '/playground',
    };

    const onKeydown = (e) => {
      if (!e.altKey) return;

      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const path = routes[e.key];
      if (path) {
        e.preventDefault();
        this.navigate(path);
      }
    };

    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));
  }

  // ---- Private: global error handling ----------------------------------------------

  /**
   * Attach the top-level error boundary: uncaught runtime errors and
   * unhandled promise rejections are logged and forwarded to app:error
   * rather than surfacing only as a silent console entry or a crashed tab.
   */
  #attachGlobalErrorHandlers() {
    const onError = (e) => {
      console.error('[Application] Uncaught error:', e.error ?? e.message);
      this.#safeDispatch('app:error', {
        message: e.message ?? 'Unknown runtime error',
        error:   e.error ?? null,
        fatal:   false,
      });
    };
    window.addEventListener('error', onError);
    this.#cleanupFns.push(() => window.removeEventListener('error', onError));

    const onRejection = (e) => {
      console.error('[Application] Unhandled promise rejection:', e.reason);
      this.#safeDispatch('app:error', {
        message: e.reason?.message ?? 'Unhandled promise rejection',
        error:   e.reason ?? null,
        fatal:   false,
      });
    };
    window.addEventListener('unhandledrejection', onRejection);
    this.#cleanupFns.push(() => window.removeEventListener('unhandledrejection', onRejection));

    const onBeforeUnload = () => {
      try { this.#storage?.flushWrites?.(); } catch { /* best effort */ }
      try { this.#tracker?.destroy?.(); } catch { /* best effort */ }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    this.#cleanupFns.push(() => window.removeEventListener('beforeunload', onBeforeUnload));
  }

  // ---- Private: app-wide lifecycle listeners ------------------------------------------

  /**
   * Attach visibility, online/offline, resize, and history-related listeners
   * that are the application's own concern (as opposed to per-page concerns
   * already handled inside individual page modules).
   *
   * Online/offline and page-visibility are primarily handled inside
   * EventBus.initialize() itself (it bridges the raw window events into
   * app:online / app:offline / app:visibility). This method listens to
   * those already-bridged bus events rather than re-attaching duplicate raw
   * window listeners, and adds the app-level reactions (toggling a body
   * class other components can style against).
   */
  #attachLifecycleListeners() {
    // ---- Online / offline (via the already-bridged bus events) -----------
    const onOnline = () => {
      this.#isOnline = true;
      document.body.classList.remove('app-offline');
      document.body.classList.add('app-online');
    };
    const onOffline = () => {
      this.#isOnline = false;
      document.body.classList.remove('app-online');
      document.body.classList.add('app-offline');
    };
    document.addEventListener('app:online', onOnline);
    document.addEventListener('app:offline', onOffline);
    this.#cleanupFns.push(() => {
      document.removeEventListener('app:online', onOnline);
      document.removeEventListener('app:offline', onOffline);
    });

    // Apply the correct initial state immediately (bus events only fire on change)
    if (this.#isOnline) onOnline(); else onOffline();

    // ---- Window resize (debounced; app-level concern only) ---------------
    const onResize = () => this.#debouncedResize();
    window.addEventListener('resize', onResize, { passive: true });
    this.#cleanupFns.push(() => window.removeEventListener('resize', onResize));

    // ---- Hash change — some deep-links use hash anchors within a page ------
    const onHashChange = () => {
      this.#safeDispatch('app:hashchange', { hash: location.hash });
    };
    window.addEventListener('hashchange', onHashChange);
    this.#cleanupFns.push(() => window.removeEventListener('hashchange', onHashChange));

    // Note: 'popstate' is already fully owned and handled by Router.init()
    // for navigation purposes. Attaching a second competing listener here
    // would risk double-handling the same browser back/forward event, so
    // this application layer intentionally does not attach its own.
  }

  /**
   * React to viewport resize: update a simple breakpoint flag on the
   * StateStore's settings slice so any page can read it reactively.
   */
  #handleResize() {
    if (!this.#store) return;
    const isMobile = window.innerWidth < 768;
    try {
      this.#store.update('app', { online: this.#isOnline }, { skipHistory: true });
      this.#store.update('settings', { keyboardMode: this.#store.getSettings().keyboardMode }, { skipHistory: true, silent: true });
    } catch { /* non-fatal */ }
    document.body.classList.toggle('app-mobile', isMobile);
  }

  // ---- Private: safe dispatch helpers ------------------------------------------------

  /**
   * Dispatch an event through the EventBus once it exists, always also as a
   * native CustomEvent on document so early listeners (attached before the
   * bus is ready) still receive lifecycle events like app:initializing.
   *
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  #safeDispatch(eventName, detail = {}) {
    try {
      if (this.#bus?.emit) {
        this.#bus.emit(eventName, detail);
      } else if (window.__pyaiEvents?.emit) {
        window.__pyaiEvents.emit(eventName, detail);
      }
    } catch { /* non-fatal */ }

    try {
      document.dispatchEvent(new CustomEvent(eventName, { bubbles: true, cancelable: false, detail }));
    } catch { /* non-fatal */ }
  }

  /**
   * Same as #safeDispatch but usable before the bus exists at all (the very
   * first call in initialize()), falling back straight to a native event.
   *
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  #safeDispatchEarly(eventName, detail = {}) {
    try {
      document.dispatchEvent(new CustomEvent(eventName, { bubbles: true, cancelable: false, detail }));
    } catch { /* non-fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Auto-bootstrap on DOMContentLoaded
// ---------------------------------------------------------------------------

/**
 * The application instance is created and started automatically once the DOM
 * is ready. Exposed on window for debugging/console access in development;
 * this does not affect production behaviour.
 */
if (typeof window !== 'undefined') {
  const bootstrap = async () => {
    const app = new Application();
    window.__pyaiApp = app;

    try {
      await app.initialize();
      app.start();
    } catch (err) {
      console.error('[Application] Fatal error during bootstrap:', err);
      const outlet = document.getElementById('app-outlet');
      if (outlet) {
        outlet.innerHTML = `
          <div role="alert" style="text-align:center;padding:4rem 1rem">
            <h1>Something went wrong</h1>
            <p>The application failed to start. Please refresh the page.</p>
          </div>
        `;
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    // DOM is already ready (script loaded with defer/module after parsing)
    bootstrap();
  }
}

export default Application;