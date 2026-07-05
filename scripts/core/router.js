/**
 * =============================================================================
 * CLIENT-SIDE ROUTER
 * scripts/core/router.js
 * -----------------------------------------------------------------------------
 * Production-grade History API router for the Python for AI educational
 * platform. Provides full SPA navigation with no page reloads, route
 * parameter matching, query/hash support, route guards, middleware,
 * scroll restoration, accessibility announcements, and lazy-load hooks.
 *
 * ARCHITECTURE:
 *   Router (default export)
 *     ├─ RouteRegistry      — stores registered routes, resolves matches
 *     ├─ MiddlewarePipeline — composes and executes middleware chain
 *     └─ ScrollManager      — saves and restores scroll positions
 *
 * NAVIGATION LIFECYCLE (per transition):
 *   1. navigate(path) called (or popstate fires)
 *   2. Parse destination: pathname, params, query, hash
 *   3. Run beforeNavigate guards on current route (can cancel)
 *   4. Run global middleware pipeline (can redirect)
 *   5. Push/replace History state
 *   6. Execute route beforeEnter guard (can redirect)
 *   7. Restore or reset scroll position
 *   8. Call route's component() loader — returns {mount, unmount}
 *   9. Unmount previous route component
 *  10. Mount next route component into outlet
 *  11. Update navigation active link
 *  12. Move focus to the skip link or page heading (accessibility)
 *  13. Announce route change to screen readers
 *  14. Run afterNavigate hooks
 *  15. Emit router:afterNavigate
 *
 * ROUTE DEFINITION SHAPE:
 *   {
 *     path:         string,         — e.g. "/tutorials/:id"
 *     component:    () => Promise<{mount(el, ctx):void, unmount():void}>,
 *     meta?:        object,         — arbitrary route metadata
 *     title?:       string | ((ctx) => string),
 *     beforeEnter?: (ctx, next) => void,
 *     children?:    RouteDefinition[],
 *   }
 *
 * ROUTE CONTEXT SHAPE (ctx) passed to all guards, middleware, and components:
 *   {
 *     path:       string,           — full pathname + query + hash
 *     pathname:   string,           — pathname only
 *     params:     Record<string,string>,
 *     query:      URLSearchParams,
 *     hash:       string,
 *     meta:       object,
 *     from:       RouteMatch | null,
 *     to:         RouteMatch,
 *   }
 *
 * INTEGRATION POINTS:
 *   - Emits 'router:navigated' after each navigation so Dashboard, Footer,
 *     and Navigation can call updateActiveLink(pathname)
 *   - Calls navigation.updateActiveLink(pathname) if a Navigation instance
 *     is registered via router.setNavigation(nav)
 *   - Page scripts receive the route context via router:afterNavigate and
 *     can access it synchronously via router.currentRoute()
 *
 * USAGE (scripts/main.js):
 *
 *   import Router, { ROUTER_EVENTS } from './core/router.js';
 *
 *   const router = new Router({
 *     outletId:        'app-outlet',
 *     base:            '/',
 *     scrollRestoration: true,
 *     transitionClass: 'page-transition',
 *   });
 *
 *   router.register([
 *     {
 *       path:      '/',
 *       title:     'Home',
 *       component: () => import('../pages/home.js'),
 *     },
 *     {
 *       path:      '/tutorials',
 *       title:     'Tutorials',
 *       component: () => import('../pages/tutorials.js'),
 *     },
 *     {
 *       path:      '/tutorials/:id',
 *       title:     (ctx) => `Tutorial — ${ctx.params.id}`,
 *       component: () => import('../pages/tutorial-detail.js'),
 *       beforeEnter: (ctx, next) => {
 *         if (!ctx.params.id) next('/tutorials');
 *         else next();
 *       },
 *     },
 *     {
 *       path:      '/quizzes',
 *       title:     'Quizzes',
 *       component: () => import('../pages/quizzes.js'),
 *     },
 *     {
 *       path:      '/dashboard',
 *       title:     'Dashboard',
 *       component: () => import('../pages/dashboard.js'),
 *     },
 *   ]);
 *
 *   router.use((ctx, next) => {
 *     console.log('[Router] Navigating to', ctx.pathname);
 *     next();
 *   });
 *
 *   router.init();
 *
 * EXPORTS:
 *   Router          — primary class (default export)
 *   ROUTER_EVENTS   — event name constants
 *   ROUTER_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the router.
 * All events bubble on document and are published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ROUTER_EVENTS = Object.freeze({
  INIT:            'router:init',
  BEFORE_NAVIGATE: 'router:beforeNavigate',
  AFTER_NAVIGATE:  'router:afterNavigate',
  NOT_FOUND:       'router:notFound',
  ERROR:           'router:error',
  DESTROY:         'router:destroy',
  /** Also emitted after every navigation for broad subscriber compatibility */
  NAVIGATED:       'router:navigated',
});

/**
 * Default configuration values.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const ROUTER_DEFAULTS = Object.freeze({
  /** ID of the DOM element that receives each page's rendered HTML */
  OUTLET_ID:          'app-outlet',

  /** Base path prefix stripped before route matching (useful for GitHub Pages subdirs) */
  BASE:               '/',

  /** Whether to save and restore scroll positions across history entries */
  SCROLL_RESTORATION: true,

  /** CSS class added to the outlet during page transitions (add your animation CSS) */
  TRANSITION_CLASS:   'router-transition',

  /** Duration (ms) of the transition animation — router waits this long before mounting */
  TRANSITION_DURATION: 0,

  /** Debounce window (ms) — rapid navigation() calls are coalesced */
  DEBOUNCE_MS:        16,

  /** Title suffix appended to every page title: "Page | Python for AI" */
  TITLE_SUFFIX:       'Python for AI',

  /** ID of the element to announce route changes to (ARIA live region) */
  ANNOUNCE_ELEMENT_ID: 'router-announce',

  /** ID of the skip-navigation link at the top of the page */
  SKIP_LINK_ID:       'skip-to-main',

  /** ID of the main content element that receives focus after navigation */
  MAIN_CONTENT_ID:    'main-content',

  /** Storage schema version for scroll position persistence */
  STORE_VERSION:      1,
});

// ---------------------------------------------------------------------------
// RouteRegistry — stores and resolves route definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   path:         string,
 *   pattern:      RegExp,
 *   paramNames:   string[],
 *   component:    () => Promise<*>,
 *   meta:         object,
 *   title:        string | ((ctx: RouteContext) => string) | null,
 *   beforeEnter:  ((ctx: RouteContext, next: NextFn) => void) | null,
 * }} RegisteredRoute
 */

/**
 * @typedef {{
 *   route:    RegisteredRoute,
 *   pathname: string,
 *   params:   Record<string, string>,
 *   query:    URLSearchParams,
 *   hash:     string,
 *   path:     string,
 *   meta:     object,
 * }} RouteMatch
 */

/**
 * @typedef {(ctx: RouteContext, next: (redirectPath?: string) => void) => void} MiddlewareFn
 */

/**
 * @typedef {{ pathname: string, params: Record<string,string>, query: URLSearchParams, hash: string, path: string, meta: object, from: RouteMatch|null, to: RouteMatch }} RouteContext
 */

/**
 * @typedef {(redirectPath?: string) => void} NextFn
 */

/**
 * Compiles a path pattern (e.g. "/tutorials/:id") into a RegExp and
 * extracts named parameter placeholders.
 *
 * Supported syntax:
 *   :param   — named required segment   (/tutorials/:id → /tutorials/python-basics)
 *   :param?  — named optional segment   (/page/:section? matches /page and /page/intro)
 *   *        — wildcard (catch-all)     (/docs/* matches anything under /docs/)
 *
 * @param {string} path
 * @returns {{ pattern: RegExp, paramNames: string[] }}
 */
function compilePath(path) {
  const paramNames = [];

  const regexStr = path
    // Escape special regex characters except : * ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Named optional segment :param?
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\?/g, (_, name) => {
      paramNames.push(name);
      return '([^/]*)';
    })
    // Named required segment :param
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    })
    // Wildcard *
    .replace(/\*/g, '(.*)');

  const pattern = new RegExp(`^${regexStr}\\/?$`, 'i');
  return { pattern, paramNames };
}

/**
 * Flatten nested route definitions into a single sorted array.
 * Children inherit the parent path as a prefix.
 *
 * @param {object[]} routes
 * @param {string}   [prefix='']
 * @returns {object[]}
 */
function flattenRoutes(routes, prefix = '') {
  const flat = [];

  for (const route of routes) {
    const fullPath = prefix
      ? `${prefix.replace(/\/$/, '')}/${route.path.replace(/^\//, '')}`
      : route.path;

    flat.push({ ...route, path: fullPath });

    if (Array.isArray(route.children) && route.children.length > 0) {
      flat.push(...flattenRoutes(route.children, fullPath));
    }
  }

  return flat;
}

/**
 * Manages the registered route table and resolves URL paths to matches.
 */
class RouteRegistry {
  /** @type {RegisteredRoute[]} */
  #routes = [];

  /** @type {RegisteredRoute | null} */
  #notFoundRoute = null;

  /**
   * Register one or more route definitions.
   * Automatically flattens nested routes.
   *
   * @param {object[]} routeDefs
   */
  add(routeDefs) {
    const flat = flattenRoutes(Array.isArray(routeDefs) ? routeDefs : [routeDefs]);

    for (const def of flat) {
      if (!def.path || typeof def.path !== 'string') {
        console.warn('[Router] Route definition missing "path":', def);
        continue;
      }

      const { pattern, paramNames } = compilePath(def.path);

      const compiled = {
        path:        def.path,
        pattern,
        paramNames,
        component:   typeof def.component === 'function' ? def.component : null,
        meta:        def.meta && typeof def.meta === 'object' ? def.meta : {},
        title:       def.title ?? null,
        beforeEnter: typeof def.beforeEnter === 'function' ? def.beforeEnter : null,
      };

      // 404 route — stored separately for explicit lookup
      if (def.path === '*' || def.path === '404' || def.path === '/404') {
        this.#notFoundRoute = compiled;
      } else {
        this.#routes.push(compiled);
      }
    }

    // Sort: static routes before dynamic ones (more specific first)
    this.#routes.sort((a, b) => {
      const aScore = a.path.includes(':') ? 1 : 0;
      const bScore = b.path.includes(':') ? 1 : 0;
      return aScore - bScore;
    });
  }

  /**
   * Remove a registered route by its path string.
   *
   * @param {string} path
   */
  remove(path) {
    this.#routes = this.#routes.filter((r) => r.path !== path);
    if (this.#notFoundRoute?.path === path) {
      this.#notFoundRoute = null;
    }
  }

  /**
   * Match a URL pathname against the registered routes.
   * Returns the first match, or the 404 route if none is found.
   *
   * @param {string} pathname
   * @param {string} search   — raw query string (e.g. "?q=python")
   * @param {string} hash     — hash fragment (e.g. "#section-1")
   * @returns {RouteMatch | null}
   */
  resolve(pathname, search = '', hash = '') {
    const fullPath = pathname + search + hash;
    const query    = new URLSearchParams(search.replace(/^\?/, ''));

    for (const route of this.#routes) {
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? '';
      });

      return {
        route,
        pathname,
        params,
        query,
        hash:  hash.replace(/^#/, ''),
        path:  fullPath,
        meta:  route.meta,
      };
    }

    // No match — return 404 route if registered, else null
    if (this.#notFoundRoute) {
      return {
        route:    this.#notFoundRoute,
        pathname,
        params:   {},
        query,
        hash:     hash.replace(/^#/, ''),
        path:     fullPath,
        meta:     this.#notFoundRoute.meta,
      };
    }

    return null;
  }

  /** @returns {RegisteredRoute[]} Shallow copy of all registered routes */
  get all() { return [...this.#routes]; }

  /** @returns {RegisteredRoute | null} */
  get notFound() { return this.#notFoundRoute; }
}

// ---------------------------------------------------------------------------
// MiddlewarePipeline — compose and execute ordered middleware functions
// ---------------------------------------------------------------------------

/**
 * Manages an ordered list of middleware functions and executes them in
 * sequence, supporting redirect and cancellation via the next() callback.
 *
 * Middleware signature:
 *   (ctx: RouteContext, next: (redirectPath?: string) => void) => void
 *
 * Calling next() with no argument continues to the next middleware.
 * Calling next('/path') triggers a redirect and stops the chain.
 * Not calling next() at all cancels the navigation.
 */
class MiddlewarePipeline {
  /** @type {MiddlewareFn[]} */
  #fns = [];

  /**
   * Add a middleware function to the end of the pipeline.
   *
   * @param {MiddlewareFn} fn
   */
  use(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('[Router] Middleware must be a function.');
    }
    this.#fns.push(fn);
  }

  /**
   * Run the middleware chain for the given context.
   * Resolves with { ok: true } if the chain completes normally,
   * { ok: false, redirect: string } if a redirect was requested,
   * or { ok: false, cancelled: true } if navigation was cancelled.
   *
   * @param {RouteContext} ctx
   * @returns {Promise<{ ok: boolean, redirect?: string, cancelled?: boolean }>}
   */
  run(ctx) {
    return new Promise((resolve) => {
      const fns = [...this.#fns];
      let   idx = 0;

      const next = (redirectPath) => {
        if (typeof redirectPath === 'string') {
          resolve({ ok: false, redirect: redirectPath });
          return;
        }

        if (idx >= fns.length) {
          resolve({ ok: true });
          return;
        }

        const fn = fns[idx++];
        try {
          fn(ctx, next);
        } catch (err) {
          resolve({ ok: false, cancelled: true });
          console.error('[Router] Middleware threw an error:', err);
        }
      };

      if (fns.length === 0) {
        resolve({ ok: true });
      } else {
        next();
      }
    });
  }

  /** Remove all registered middleware. */
  clear() {
    this.#fns = [];
  }

  /** @returns {number} Number of registered middleware functions */
  get size() { return this.#fns.length; }
}

// ---------------------------------------------------------------------------
// ScrollManager — save and restore scroll positions per history entry
// ---------------------------------------------------------------------------

/**
 * Persists scroll positions keyed by a history state key.
 * Uses sessionStorage so positions survive in-tab back/forward but are
 * discarded when the tab closes.
 *
 * Each key maps to { x: number, y: number }.
 */
class ScrollManager {
  /** @type {string} */
  #storageKey = 'pyai-scroll-positions';

  /** @type {Record<string, { x: number, y: number }>} */
  #positions = {};

  constructor() {
    this.#load();
  }

  /**
   * Save the current window scroll position for the given history key.
   *
   * @param {string} key
   */
  save(key) {
    this.#positions[key] = {
      x: window.scrollX,
      y: window.scrollY,
    };
    this.#persist();
  }

  /**
   * Restore a previously saved scroll position for the given key.
   * Silently does nothing if no position is stored.
   *
   * @param {string}  key
   * @param {boolean} smooth — Use smooth scrolling if not prefers-reduced-motion
   */
  restore(key, smooth = false) {
    const pos = this.#positions[key];
    if (!pos) return;

    const behavior = smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'smooth'
      : 'instant';

    window.scrollTo({ left: pos.x, top: pos.y, behavior });
  }

  /**
   * Reset scroll to the top of the page.
   *
   * @param {boolean} smooth
   */
  reset(smooth = false) {
    const behavior = smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'smooth'
      : 'instant';

    window.scrollTo({ left: 0, top: 0, behavior });
  }

  /**
   * Clear all stored positions.
   */
  clear() {
    this.#positions = {};
    try { sessionStorage.removeItem(this.#storageKey); } catch { /* swallow */ }
  }

  // ------ Private ------

  #load() {
    try {
      const raw = sessionStorage.getItem(this.#storageKey);
      if (raw) this.#positions = JSON.parse(raw);
    } catch {
      this.#positions = {};
    }
  }

  #persist() {
    try {
      // Cap storage to 100 entries to prevent unbounded growth
      const keys = Object.keys(this.#positions);
      if (keys.length > 100) {
        const oldest = keys.slice(0, keys.length - 100);
        oldest.forEach((k) => delete this.#positions[k]);
      }
      sessionStorage.setItem(this.#storageKey, JSON.stringify(this.#positions));
    } catch {
      // sessionStorage quota exceeded — clear and continue
      this.#positions = {};
    }
  }
}

// ---------------------------------------------------------------------------
// Escape utilities (consistent with all other components)
// ---------------------------------------------------------------------------

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

// ---------------------------------------------------------------------------
// Performance utilities
// ---------------------------------------------------------------------------

/**
 * Returns a debounced wrapper around the given function.
 *
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

// ---------------------------------------------------------------------------
// Router — primary class
// ---------------------------------------------------------------------------

/**
 * Client-side History API router.
 *
 * Lifecycle:
 *   1. new Router(config)       — no DOM side-effects
 *   2. .register(routeDefs)     — declare all routes
 *   3. .use(middleware)         — optional global middleware
 *   4. .init()                  — intercept clicks, handle initial URL, listen popstate
 *   5. .navigate(path)          — programmatic navigation
 *   6. .destroy()               — remove all listeners and clean up
 */
export default class Router {

  // ---- Configuration (immutable after construction) -----------------------

  /**
   * @type {{
   *   outletId:           string,
   *   base:               string,
   *   scrollRestoration:  boolean,
   *   transitionClass:    string,
   *   transitionDuration: number,
   *   debounceMs:         number,
   *   titleSuffix:        string,
   *   announceElementId:  string,
   *   skipLinkId:         string,
   *   mainContentId:      string,
   * }}
   */
  #config;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean}        */ #initialised    = false;
  /** @type {boolean}        */ #navigating     = false;

  /** @type {RouteMatch | null} Current active route */
  #currentMatch = null;

  /** @type {RouteMatch | null} Previous active route */
  #previousMatch = null;

  /** @type {object | null} Active mounted component instance { unmount() } */
  #currentComponent = null;

  /**
   * History state key counter — each pushState/replaceState gets a unique
   * numeric key so ScrollManager can address individual entries.
   *
   * @type {number}
   */
  #stateCounter = 0;

  /** @type {string | null} Current history entry key */
  #currentKey = null;

  // ---- External component references (optional) ---------------------------

  /**
   * Optional Navigation instance — if registered via setNavigation(),
   * the router calls nav.updateActiveLink(pathname) after each navigation.
   *
   * @type {{ updateActiveLink: (pathname: string) => void } | null}
   */
  #navigation = null;

  // ---- DOM references -----------------------------------------------------

  /** @type {HTMLElement | null} */  #outlet       = null;
  /** @type {HTMLElement | null} */  #announceEl   = null;

  // ---- Sub-components ------------------------------------------------------

  /** @type {RouteRegistry}     */ #registry;
  /** @type {MiddlewarePipeline}*/ #middleware;
  /** @type {ScrollManager}     */ #scroll;

  // ---- Debounced navigation ------------------------------------------------

  /** @type {Function & { cancel: () => void }} */
  #debouncedNavigate;

  // ---- Cleanup references -------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   outletId?:           string,
   *   base?:               string,
   *   scrollRestoration?:  boolean,
   *   transitionClass?:    string,
   *   transitionDuration?: number,
   *   debounceMs?:         number,
   *   titleSuffix?:        string,
   *   announceElementId?:  string,
   *   skipLinkId?:         string,
   *   mainContentId?:      string,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      outletId:           config.outletId           ?? ROUTER_DEFAULTS.OUTLET_ID,
      base:               config.base               ?? ROUTER_DEFAULTS.BASE,
      scrollRestoration:  config.scrollRestoration  ?? ROUTER_DEFAULTS.SCROLL_RESTORATION,
      transitionClass:    config.transitionClass    ?? ROUTER_DEFAULTS.TRANSITION_CLASS,
      transitionDuration: config.transitionDuration ?? ROUTER_DEFAULTS.TRANSITION_DURATION,
      debounceMs:         config.debounceMs         ?? ROUTER_DEFAULTS.DEBOUNCE_MS,
      titleSuffix:        config.titleSuffix        ?? ROUTER_DEFAULTS.TITLE_SUFFIX,
      announceElementId:  config.announceElementId  ?? ROUTER_DEFAULTS.ANNOUNCE_ELEMENT_ID,
      skipLinkId:         config.skipLinkId         ?? ROUTER_DEFAULTS.SKIP_LINK_ID,
      mainContentId:      config.mainContentId      ?? ROUTER_DEFAULTS.MAIN_CONTENT_ID,
    });

    this.#registry   = new RouteRegistry();
    this.#middleware  = new MiddlewarePipeline();
    this.#scroll      = new ScrollManager();

    this.#debouncedNavigate = debounce(
      (path, opts) => this.#performNavigation(path, opts),
      this.#config.debounceMs
    );

    // Disable the browser's built-in scroll restoration so we manage it ourselves
    if (this.#config.scrollRestoration && 'scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }

  // ---- Public API: setup ---------------------------------------------------

  /**
   * Register route definitions.
   * Can be called before or after init(), but should be called before init()
   * so the initial URL is matched correctly.
   *
   * Accepts a single route definition or an array of route definitions.
   * Nested routes (via children[]) are flattened automatically.
   *
   * @param {object | object[]} routeDefs
   * @returns {Router} this — for chaining
   */
  register(routeDefs) {
    this.#registry.add(
      Array.isArray(routeDefs) ? routeDefs : [routeDefs]
    );
    return this;
  }

  /**
   * Remove a previously registered route by its path string.
   *
   * @param {string} path
   * @returns {Router} this
   */
  unregister(path) {
    this.#registry.remove(path);
    return this;
  }

  /**
   * Add a global middleware function to the navigation pipeline.
   * Middleware runs on every navigation, in registration order.
   *
   * @param {MiddlewareFn} fn
   * @returns {Router} this
   */
  use(fn) {
    this.#middleware.use(fn);
    return this;
  }

  /**
   * Register an optional Navigation component instance.
   * When set, the router calls nav.updateActiveLink(pathname) after each
   * successful navigation so the nav bar highlights the correct item.
   *
   * @param {{ updateActiveLink: (pathname: string) => void }} nav
   * @returns {Router} this
   */
  setNavigation(nav) {
    if (nav && typeof nav.updateActiveLink === 'function') {
      this.#navigation = nav;
    }
    return this;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Initialise the router.
   *
   * Actions:
   *   - Resolves and caches the outlet element
   *   - Ensures an ARIA live region exists for route announcements
   *   - Attaches the popstate listener for browser back/forward
   *   - Intercepts link clicks for client-side navigation
   *   - Navigates to the current URL
   *
   * @returns {Router} this
   */
  init() {
    if (this.#initialised) return this;
    this.#initialised = true;

    // Resolve outlet
    this.#outlet = document.getElementById(this.#config.outletId);
    if (!this.#outlet) {
      console.warn(
        `[Router] Outlet element #${this.#config.outletId} not found. ` +
        `Navigation will work but no components will be mounted.`
      );
    }

    // Ensure the ARIA live region exists
    this.#ensureAnnounceElement();

    // Assign an initial history state key
    const initialKey = this.#generateKey();
    this.#currentKey = initialKey;

    if (!history.state?.routerKey) {
      history.replaceState(
        { routerKey: initialKey, scrollX: 0, scrollY: 0 },
        '',
        location.href
      );
    } else {
      this.#currentKey = history.state.routerKey;
    }

    // Popstate — browser back/forward buttons
    const onPopState = (e) => this.#handlePopState(e);
    window.addEventListener('popstate', onPopState);
    this.#cleanupFns.push(() => window.removeEventListener('popstate', onPopState));

    // Click interception — capture anchor clicks for SPA navigation
    const onClick = (e) => this.#handleLinkClick(e);
    document.addEventListener('click', onClick);
    this.#cleanupFns.push(() => document.removeEventListener('click', onClick));

    // Navigate to the initial URL
    const initialPath = this.#stripBase(location.pathname) + location.search + location.hash;
    this.#performNavigation(initialPath, { replace: true, initial: true });

    this.#dispatch(ROUTER_EVENTS.INIT, {
      path:     initialPath,
      pathname: location.pathname,
    });

    return this;
  }

  /**
   * Navigate to a new path.
   * Debounced — rapid calls within the debounce window are coalesced to
   * the last call, preventing duplicate entries in history.
   *
   * @param {string} path  — Absolute path (e.g. '/tutorials/python-basics?q=vars#section-1')
   * @param {{ replace?: boolean, state?: object }} [options={}]
   * @returns {Router} this
   */
  navigate(path, options = {}) {
    this.#debouncedNavigate(path, { ...options, replace: false });
    return this;
  }

  /**
   * Replace the current history entry with a new path.
   * Useful for redirects where you do not want a back-button entry.
   *
   * @param {string} path
   * @param {{ state?: object }} [options={}]
   * @returns {Router} this
   */
  replace(path, options = {}) {
    this.#debouncedNavigate(path, { ...options, replace: true });
    return this;
  }

  /**
   * Navigate to the previous entry in the browser history.
   */
  back() {
    history.back();
  }

  /**
   * Navigate to the next entry in the browser history.
   */
  forward() {
    history.forward();
  }

  /**
   * Re-navigate to the current path, re-mounting the current component.
   * Useful after dynamic data changes that require a full re-render.
   *
   * @returns {Router} this
   */
  reload() {
    if (!this.#currentMatch) return this;
    const path = this.#currentMatch.path;
    this.#performNavigation(path, { replace: true, force: true });
    return this;
  }

  /**
   * Return the current active route match, or null if not yet navigated.
   *
   * @returns {RouteMatch | null}
   */
  currentRoute() {
    return this.#currentMatch;
  }

  /**
   * Destroy the router — removes all listeners, cancels pending navigation,
   * unmounts the current component, and clears the outlet.
   */
  destroy() {
    this.#debouncedNavigate.cancel();

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    this.#unmountCurrentComponent();

    if (this.#outlet) {
      this.#outlet.innerHTML = '';
    }

    this.#middleware.clear();
    this.#initialised = false;

    if (this.#config.scrollRestoration && 'scrollRestoration' in history) {
      history.scrollRestoration = 'auto';
    }

    this.#dispatch(ROUTER_EVENTS.DESTROY, {});
  }

  // ---- Private: navigation core --------------------------------------------

  /**
   * Core navigation method — resolves the route, runs guards and middleware,
   * updates history, mounts the component, and handles accessibility.
   *
   * @param {string}  path
   * @param {{
   *   replace?:  boolean,
   *   initial?:  boolean,
   *   force?:    boolean,
   *   state?:    object,
   * }} [options={}]
   */
  async #performNavigation(path, options = {}) {
    if (this.#navigating && !options.force) return;
    this.#navigating = true;

    const { replace = false, initial = false, force = false } = options;

    try {
      // ── Parse the destination URL ────────────────────────────────────────
      const { pathname, search, hash } = this.#parsePath(path);

      // ── Resolve destination route ────────────────────────────────────────
      const match = this.#registry.resolve(pathname, search, hash);

      // ── Identical route guard ────────────────────────────────────────────
      if (!force && this.#currentMatch && match) {
        const same = match.pathname === this.#currentMatch.pathname &&
                     match.query.toString() === this.#currentMatch.query.toString() &&
                     match.hash === this.#currentMatch.hash;
        if (same) {
          this.#navigating = false;
          return;
        }
      }

      // ── Build route context ──────────────────────────────────────────────
      const ctx = this.#buildContext(match, pathname, search, hash);

      // ── Emit beforeNavigate ──────────────────────────────────────────────
      this.#dispatch(ROUTER_EVENTS.BEFORE_NAVIGATE, {
        to:   ctx.to,
        from: ctx.from,
      });

      // ── Save scroll for the page we are leaving ──────────────────────────
      if (this.#currentKey && this.#config.scrollRestoration) {
        this.#scroll.save(this.#currentKey);
      }

      // ── Run global middleware ────────────────────────────────────────────
      const mwResult = await this.#middleware.run(ctx);

      if (!mwResult.ok) {
        if (mwResult.redirect) {
          this.#navigating = false;
          this.replace(mwResult.redirect);
          return;
        }
        // Cancelled
        this.#navigating = false;
        return;
      }

      // ── Run beforeEnter guard on the matched route ───────────────────────
      if (match?.route.beforeEnter) {
        const guardResult = await this.#runGuard(match.route.beforeEnter, ctx);

        if (!guardResult.ok) {
          if (guardResult.redirect) {
            this.#navigating = false;
            this.replace(guardResult.redirect);
            return;
          }
          this.#navigating = false;
          return;
        }
      }

      // ── Update browser History ───────────────────────────────────────────
      const newKey    = this.#generateKey();
      const stateObj  = {
        routerKey: newKey,
        scrollX:   0,
        scrollY:   0,
        ...(options.state ?? {}),
      };

      const fullUrl   = this.#config.base.replace(/\/$/, '') + pathname + search + hash;

      if (replace || initial) {
        history.replaceState(stateObj, '', fullUrl);
      } else {
        history.pushState(stateObj, '', fullUrl);
      }

      this.#currentKey = newKey;

      // ── Mount the new route ──────────────────────────────────────────────
      await this.#transitionTo(match, ctx);

      // ── Post-navigation housekeeping ─────────────────────────────────────
      this.#previousMatch = this.#currentMatch;
      this.#currentMatch  = match;

      // ── Update document title ────────────────────────────────────────────
      this.#updateTitle(match, ctx);

      // ── Update navigation active state ───────────────────────────────────
      this.#navigation?.updateActiveLink(pathname);

      // ── Scroll behaviour ─────────────────────────────────────────────────
      if (this.#config.scrollRestoration) {
        if (hash) {
          // Scroll to named anchor
          this.#scrollToHash(hash);
        } else if (initial) {
          // On initial load let the browser manage scroll (e.g. #anchor in URL)
        } else {
          this.#scroll.reset();
        }
      }

      // ── Accessibility ────────────────────────────────────────────────────
      this.#manageFocus(initial);
      this.#announceNavigation(match, pathname);

      // ── Emit events ──────────────────────────────────────────────────────
      if (!match || match.route === this.#registry.notFound) {
        this.#dispatch(ROUTER_EVENTS.NOT_FOUND, { path, pathname });
      }

      this.#dispatch(ROUTER_EVENTS.AFTER_NAVIGATE, {
        to:      match,
        from:    this.#previousMatch,
        pathname,
        path:    pathname + search + hash,
        params:  match?.params ?? {},
        query:   match?.query ?? new URLSearchParams(),
        hash:    hash.replace(/^#/, ''),
      });

      // Also emit the broader 'navigated' event that other components subscribe to
      this.#dispatch(ROUTER_EVENTS.NAVIGATED, {
        pathname,
        path:   pathname + search + hash,
        params: match?.params ?? {},
      });

    } catch (err) {
      console.error('[Router] Navigation error:', err);
      this.#dispatch(ROUTER_EVENTS.ERROR, {
        path,
        error: err,
        message: err?.message ?? 'Unknown navigation error',
      });
    } finally {
      this.#navigating = false;
    }
  }

  /**
   * Execute a single route guard (beforeEnter) as a Promise.
   * Returns { ok: true } or { ok: false, redirect?: string }.
   *
   * @param {(ctx: RouteContext, next: NextFn) => void} guardFn
   * @param {RouteContext} ctx
   * @returns {Promise<{ ok: boolean, redirect?: string }>}
   */
  #runGuard(guardFn, ctx) {
    return new Promise((resolve) => {
      try {
        guardFn(ctx, (redirectPath) => {
          if (typeof redirectPath === 'string') {
            resolve({ ok: false, redirect: redirectPath });
          } else {
            resolve({ ok: true });
          }
        });
      } catch (err) {
        console.error('[Router] Guard threw an error:', err);
        resolve({ ok: false });
      }
    });
  }

  /**
   * Execute the route transition: apply the transition class, unmount the
   * previous component, await the transition duration, mount the new component.
   *
   * @param {RouteMatch | null} match
   * @param {RouteContext}      ctx
   */
  async #transitionTo(match, ctx) {
    const outlet = this.#outlet;
    const dur    = this.#config.transitionDuration;
    const cls    = this.#config.transitionClass;

    // Apply transition class (CSS handles the animation)
    if (outlet && cls && dur > 0) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReduced) {
        outlet.classList.add(cls);
      }
    }

    // Unmount previous component
    this.#unmountCurrentComponent();

    // Wait for transition out
    if (outlet && cls && dur > 0) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReduced) {
        await new Promise((resolve) => setTimeout(resolve, dur));
        outlet.classList.remove(cls);
      }
    }

    // Mount new component
    if (match?.route.component && outlet) {
      try {
        const module = await match.route.component();

        // Support both { default: { mount, unmount } } and { mount, unmount }
        const component = module?.default ?? module;

        if (typeof component?.mount === 'function') {
          component.mount(outlet, ctx);
          this.#currentComponent = component;
        } else if (typeof component === 'function') {
          // Component is a plain function — call it with the outlet and ctx
          component(outlet, ctx);
          this.#currentComponent = null;
        } else {
          console.warn('[Router] Component module does not export mount/unmount:', match.route.path);
          this.#currentComponent = null;
        }
      } catch (err) {
        console.error('[Router] Failed to load component for route:', match.route.path, err);
        if (outlet) {
          outlet.innerHTML = this.#renderErrorPage(match?.route.path ?? '', err);
        }
        throw err;
      }
    } else if (!match && outlet) {
      // No route matched and no 404 route registered
      outlet.innerHTML = this.#render404Page();
    }
  }

  /**
   * Unmount and clean up the currently active route component.
   */
  #unmountCurrentComponent() {
    if (!this.#currentComponent) return;

    try {
      if (typeof this.#currentComponent.unmount === 'function') {
        this.#currentComponent.unmount();
      }
    } catch (err) {
      console.warn('[Router] Error during component unmount:', err);
    } finally {
      this.#currentComponent = null;
    }
  }

  // ---- Private: event handlers --------------------------------------------

  /**
   * Handle browser back/forward button (popstate event).
   *
   * @param {PopStateEvent} e
   */
  #handlePopState(e) {
    const key = e.state?.routerKey ?? null;

    // Save scroll for the current position before we pop
    if (this.#currentKey && this.#config.scrollRestoration) {
      this.#scroll.save(this.#currentKey);
    }

    this.#currentKey = key;

    const path     = this.#stripBase(location.pathname) + location.search + location.hash;
    const prevKey  = this.#currentKey;

    // Navigate — use replace:false so we don't push another history entry
    this.#performNavigation(path, { replace: true }).then(() => {
      // After the popstate navigation, restore scroll for the new (popped) key
      if (prevKey && this.#config.scrollRestoration) {
        requestAnimationFrame(() => {
          this.#scroll.restore(prevKey, false);
        });
      }
    });
  }

  /**
   * Intercept anchor link clicks for SPA navigation.
   * Allows the browser to handle:
   *   - External links (different origin)
   *   - Links with target="_blank" / rel="external"
   *   - Links with the download attribute
   *   - Ctrl/Meta/Shift/Alt modified clicks
   *   - Middle mouse button clicks (button !== 0)
   *
   * @param {MouseEvent} e
   */
  #handleLinkClick(e) {
    // Ignore non-primary mouse button
    if (e.button !== 0) return;

    // Ignore modified clicks (open in new tab, etc.)
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    // Find the closest anchor element
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // Ignore: external protocol, mailto:, tel:, javascript:
    if (/^(https?:\/\/|mailto:|tel:|javascript:|#$|\/\/)/i.test(href)) {
      // External: let browser handle
      if (/^(https?:\/\/|\/\/)/i.test(href)) {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin) return;
      } else {
        return;
      }
    }

    // Ignore: target="_blank" or explicit external
    if (anchor.target === '_blank' || anchor.rel?.includes('external')) return;

    // Ignore: download attribute
    if (anchor.hasAttribute('download')) return;

    // Ignore: data-router-ignore attribute (opt-out for specific links)
    if (anchor.hasAttribute('data-router-ignore')) return;

    // ── SPA navigation ───────────────────────────────────────────────────────
    let targetPath;

    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return;
      targetPath = this.#stripBase(url.pathname) + url.search + url.hash;
    } catch {
      // Relative path — treat as relative to the base
      targetPath = href;
    }

    e.preventDefault();
    this.navigate(targetPath);
  }

  // ---- Private: URL utilities ----------------------------------------------

  /**
   * Parse a path string into its component parts.
   * Handles absolute paths, paths with query strings, and hash fragments.
   *
   * @param {string} path — e.g. '/tutorials/intro?q=python#section-1'
   * @returns {{ pathname: string, search: string, hash: string }}
   */
  #parsePath(path) {
    // Normalise — ensure leading slash
    const normalised = path.startsWith('/')
      ? path
      : `/${path}`;

    // Split off hash first (hash can contain ?)
    const hashIdx = normalised.indexOf('#');
    const withoutHash = hashIdx === -1 ? normalised : normalised.slice(0, hashIdx);
    const hash        = hashIdx === -1 ? '' : normalised.slice(hashIdx);

    // Split pathname from query
    const queryIdx = withoutHash.indexOf('?');
    const pathname = queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx);
    const search   = queryIdx === -1 ? '' : withoutHash.slice(queryIdx);

    // Normalise the pathname — remove trailing slash (except root)
    const cleanPathname = pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

    return {
      pathname: cleanPathname || '/',
      search,
      hash,
    };
  }

  /**
   * Strip the configured base path from a pathname.
   * e.g. with base='/app', '/app/tutorials' → '/tutorials'
   *
   * @param {string} pathname
   * @returns {string}
   */
  #stripBase(pathname) {
    const base = this.#config.base.replace(/\/$/, '');
    if (base && pathname.startsWith(base)) {
      return pathname.slice(base.length) || '/';
    }
    return pathname;
  }

  /**
   * Build the RouteContext object passed to middleware, guards, and components.
   *
   * @param {RouteMatch | null} match
   * @param {string}           pathname
   * @param {string}           search
   * @param {string}           hash
   * @returns {{ from: RouteMatch|null, to: RouteMatch|null, pathname: string, params: object, query: URLSearchParams, hash: string, path: string, meta: object }}
   */
  #buildContext(match, pathname, search, hash) {
    return {
      pathname,
      params:  match?.params ?? {},
      query:   match?.query  ?? new URLSearchParams(search.replace(/^\?/, '')),
      hash:    hash.replace(/^#/, ''),
      path:    pathname + search + hash,
      meta:    match?.meta   ?? {},
      from:    this.#currentMatch,
      to:      match,
    };
  }

  /**
   * Generate a unique key for a history entry.
   *
   * @returns {string}
   */
  #generateKey() {
    return `r${++this.#stateCounter}-${Date.now()}`;
  }

  // ---- Private: document title --------------------------------------------

  /**
   * Set document.title from the matched route's title definition.
   * Supports string titles and function titles that receive the route context.
   *
   * @param {RouteMatch | null} match
   * @param {object}            ctx
   */
  #updateTitle(match, ctx) {
    const suffix  = this.#config.titleSuffix;
    let   pageTitle = '';

    if (match?.route.title) {
      if (typeof match.route.title === 'function') {
        try {
          pageTitle = String(match.route.title(ctx));
        } catch {
          pageTitle = '';
        }
      } else {
        pageTitle = String(match.route.title);
      }
    }

    document.title = pageTitle && suffix
      ? `${pageTitle} | ${suffix}`
      : pageTitle || suffix || '';
  }

  // ---- Private: accessibility ---------------------------------------------

  /**
   * Ensure an ARIA live region for route announcements exists in the DOM.
   * Creates it with appropriate attributes if not already present.
   */
  #ensureAnnounceElement() {
    const id = this.#config.announceElementId;
    this.#announceEl = document.getElementById(id);

    if (!this.#announceEl) {
      this.#announceEl = document.createElement('div');
      this.#announceEl.id             = id;
      this.#announceEl.setAttribute('role',       'status');
      this.#announceEl.setAttribute('aria-live',  'polite');
      this.#announceEl.setAttribute('aria-atomic','true');
      this.#announceEl.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;' +
        'clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0;';
      document.body.insertAdjacentElement('afterbegin', this.#announceEl);
    }
  }

  /**
   * Announce the new route to assistive technology users via the live region.
   * Clears first to ensure re-announcements of the same title still fire.
   *
   * @param {RouteMatch | null} match
   * @param {string}            pathname
   */
  #announceNavigation(match, pathname) {
    if (!this.#announceEl) return;

    const pageTitle = document.title.split('|')[0].trim() || pathname;
    const message   = `Navigated to ${pageTitle}`;

    // Clear — then set on next frame so assistive technology always fires
    this.#announceEl.textContent = '';
    requestAnimationFrame(() => {
      if (this.#announceEl) {
        this.#announceEl.textContent = message;
      }
    });
  }

  /**
   * Move keyboard focus after navigation for accessibility.
   *
   * Focus order (first found wins):
   *   1. skip-navigation link (for keyboard users to bypass nav)
   *   2. #main-content element (landmark)
   *   3. First <h1> inside the outlet
   *   4. The outlet itself
   *
   * The initial navigation on page load does NOT move focus — the browser
   * already handled initial focus placement.
   *
   * @param {boolean} isInitial
   */
  #manageFocus(isInitial) {
    if (isInitial) return;

    const candidates = [
      document.getElementById(this.#config.mainContentId),
      this.#outlet?.querySelector('h1'),
      this.#outlet,
    ].filter(Boolean);

    const target = candidates[0];
    if (!target) return;

    // Make temporarily focusable if not natively focusable
    const hadTabindex = target.hasAttribute('tabindex');
    if (!hadTabindex) {
      target.setAttribute('tabindex', '-1');
    }

    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });

      if (!hadTabindex) {
        target.addEventListener(
          'blur',
          () => target.removeAttribute('tabindex'),
          { once: true }
        );
      }
    });
  }

  /**
   * Scroll to a hash anchor element after navigation.
   * Uses smooth scroll unless prefers-reduced-motion is active.
   *
   * @param {string} hash — '#section-id' or 'section-id'
   */
  #scrollToHash(hash) {
    const id      = hash.replace(/^#/, '');
    const target  = document.getElementById(id)
                 ?? document.querySelector(`[name="${CSS.escape(id)}"]`);

    if (!target) return;

    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }

  // ---- Private: fallback page rendering ------------------------------------

  /**
   * Returns the inner HTML for a 404 Not Found page.
   * Used when no 404 route is registered.
   *
   * @returns {string}
   */
  #render404Page() {
    return `
      <div class="page-not-found" role="main" aria-labelledby="not-found-heading">
        <h1 id="not-found-heading">404 — Page Not Found</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <nav aria-label="Recovery links">
          <a href="/" data-router-ignore>Go home</a>
          <a href="/pages/tutorials.html">Browse tutorials</a>
        </nav>
      </div>
    `;
  }

  /**
   * Returns the inner HTML for a component-load error page.
   *
   * @param {string}    path
   * @param {Error|*}   err
   * @returns {string}
   */
  #renderErrorPage(path, err) {
    const msg = escapeHtml(err?.message ?? 'An unexpected error occurred.');
    return `
      <div class="page-error" role="alert" aria-labelledby="error-heading">
        <h1 id="error-heading">Something went wrong</h1>
        <p>${msg}</p>
        <p><code>${escapeHtml(path)}</code></p>
        <button type="button" onclick="location.reload()">Reload page</button>
      </div>
    `;
  }

  // ---- Private: event bus --------------------------------------------------

  /**
   * Publish an event to the project event bus and dispatch a native CustomEvent.
   * Consistent with navigation.js, header.js, footer.js, quiz.js, code-editor.js,
   * dashboard.js, and progress-tracker.js.
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