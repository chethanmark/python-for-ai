/**
 * =============================================================================
 * NAVIGATION COMPONENT
 * scripts/components/navigation.js
 * -----------------------------------------------------------------------------
 * Responsive, accessible navigation for the Python for AI educational platform.
 *
 * RESPONSIBILITIES:
 *   - Sticky header with scroll-aware shadow elevation
 *   - Mobile hamburger menu with animated open/close
 *   - Active link highlighting based on current URL
 *   - Dark / light theme toggle with localStorage persistence
 *   - Full keyboard navigation (Tab, Shift+Tab, Escape, Arrow keys)
 *   - ARIA attributes managed dynamically (expanded, hidden, current)
 *   - Focus trap inside mobile menu when open
 *   - Reduced-motion awareness for all animations
 *   - ResizeObserver to sync state when viewport changes
 *   - Click-outside and Escape dismissal for mobile menu
 *
 * DEPENDENCIES:
 *   - data/navigation.json  — nav items loaded by the router / main.js
 *   - scripts/core/events.js — event bus for cross-component communication
 *   - variables.css tokens  — consumed as CSS classes, not inline styles
 *
 * EXPECTED HTML STRUCTURE (injected into every page's <header>):
 *
 *   <header class="nav" id="site-header" role="banner">
 *     <div class="nav__container">
 *       <a href="/" class="nav__logo" aria-label="Python for AI — home">
 *         <span class="nav__logo-mark" aria-hidden="true">Py</span>
 *         <span class="nav__logo-text">Python <em>for</em> AI</span>
 *       </a>
 *       <nav class="nav__menu" id="primary-nav" aria-label="Primary navigation">
 *         <ul class="nav__list" role="list">...</ul>
 *       </nav>
 *       <div class="nav__actions">
 *         <button class="nav__theme-toggle" ...>...</button>
 *         <button class="nav__hamburger" ...>...</button>
 *       </div>
 *     </div>
 *   </header>
 *   <div class="nav__overlay" id="nav-overlay" aria-hidden="true"></div>
 *
 * USAGE (called from scripts/main.js):
 *
 *   import { Navigation } from './components/navigation.js';
 *   const nav = new Navigation();
 *   nav.init();
 *
 * MODULE EXPORTS:
 *   Navigation  — primary class (default pattern)
 *   NAV_EVENTS  — event name constants for the event bus
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Breakpoint at which mobile menu collapses to desktop nav (matches CSS lg:) */
const DESKTOP_BREAKPOINT = 1024;

/** localStorage key for persisted theme preference */
const THEME_STORAGE_KEY = 'pyai-theme';

/** CSS class names — single source of truth to avoid magic strings */
const CSS = {
  // Header states
  NAV:              'nav',
  NAV_SCROLLED:     'nav--scrolled',
  NAV_HIDDEN:       'nav--hidden',
  NAV_MENU_OPEN:    'nav--menu-open',

  // Menu
  MENU:             'nav__menu',
  MENU_OPEN:        'nav__menu--open',

  // List items and links
  LIST:             'nav__list',
  ITEM:             'nav__item',
  ITEM_DROPDOWN:    'nav__item--has-dropdown',
  LINK:             'nav__link',
  LINK_ACTIVE:      'nav__link--active',
  LINK_CURRENT:     'nav__link--current',

  // Dropdown
  DROPDOWN:         'nav__dropdown',
  DROPDOWN_OPEN:    'nav__dropdown--open',
  DROPDOWN_LINK:    'nav__dropdown-link',

  // Actions
  ACTIONS:          'nav__actions',
  HAMBURGER:        'nav__hamburger',
  HAMBURGER_OPEN:   'nav__hamburger--open',
  HAMBURGER_BAR:    'nav__hamburger-bar',

  // Theme toggle
  THEME_TOGGLE:     'nav__theme-toggle',
  THEME_ICON_LIGHT: 'nav__theme-icon--light',
  THEME_ICON_DARK:  'nav__theme-icon--dark',

  // Overlay
  OVERLAY:          'nav__overlay',
  OVERLAY_VISIBLE:  'nav__overlay--visible',

  // Logo
  LOGO:             'nav__logo',
  LOGO_MARK:        'nav__logo-mark',
  LOGO_TEXT:        'nav__logo-text',

  // Body scroll lock
  SCROLL_LOCKED:    'scroll-locked',
};

/** Event names published to the event bus (scripts/core/events.js) */
export const NAV_EVENTS = {
  MENU_OPENED:    'nav:menu:opened',
  MENU_CLOSED:    'nav:menu:closed',
  THEME_CHANGED:  'nav:theme:changed',
  LINK_CLICKED:   'nav:link:clicked',
};

/**
 * Navigation items — consumed if navigation.json is not yet loaded.
 * In production the router passes the real JSON data via Navigation.setItems().
 * This fallback ensures the nav renders on direct file:// access during dev.
 */
const FALLBACK_NAV_ITEMS = [
  { id: 'home',      label: 'Home',       href: '/',                  icon: 'home'    },
  { id: 'tutorials', label: 'Tutorials',  href: '/pages/tutorials.html', icon: 'book' },
  { id: 'projects',  label: 'Projects',   href: '/pages/projects.html',  icon: 'code' },
  { id: 'quizzes',   label: 'Quizzes',    href: '/pages/quizzes.html',   icon: 'quiz' },
  { id: 'dashboard', label: 'Dashboard',  href: '/pages/dashboard.html', icon: 'chart'},
];

// ---------------------------------------------------------------------------
// SVG icon factory
// ---------------------------------------------------------------------------

/**
 * Returns an inline SVG string for a named icon.
 * All icons are 20×20, use currentColor fill/stroke, and include
 * aria-hidden="true" because they are always accompanied by text or a label.
 *
 * @param {string} name - Icon identifier
 * @returns {string} SVG markup string
 */
function getIcon(name) {
  const icons = {
    home: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
           </svg>`,

    book: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
           </svg>`,

    code: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
           </svg>`,

    quiz: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
           </svg>`,

    chart: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6"  y1="20" x2="6"  y2="14"/>
           </svg>`,

    sun: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true" focusable="false">
             <circle cx="12" cy="12" r="5"/>
             <line x1="12" y1="1"  x2="12" y2="3"/>
             <line x1="12" y1="21" x2="12" y2="23"/>
             <line x1="4.22" y1="4.22"   x2="5.64"  y2="5.64"/>
             <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
             <line x1="1"  y1="12" x2="3"  y2="12"/>
             <line x1="21" y1="12" x2="23" y2="12"/>
             <line x1="4.22" y1="19.78"  x2="5.64"  y2="18.36"/>
             <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
          </svg>`,

    moon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
           </svg>`,

    close: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
               viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <line x1="18" y1="6"  x2="6"  y2="18"/>
               <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>`,
  };

  return icons[name] ?? '';
}

// ---------------------------------------------------------------------------
// Theme manager (isolated — usable without the full Navigation class)
// ---------------------------------------------------------------------------

/**
 * Manages the dark/light theme toggle.
 * Reads the user's OS preference via prefers-color-scheme as the initial
 * default, then respects explicit user choices stored in localStorage.
 *
 * Theme is applied via a data attribute on <html>:
 *   data-theme="dark"   → triggers .dark-theme overrides in CSS
 *   data-theme="light"  → forces light regardless of OS preference
 *   (absent)            → CSS prefers-color-scheme media query controls it
 *
 * CSS variables.css already defines the full dark mode palette via
 * @media (prefers-color-scheme: dark). The data-theme attribute is an
 * additional hook that can force either mode explicitly.
 */
class ThemeManager {
  /** @type {'light'|'dark'|null} */
  #current = null;

  /** @type {((theme: 'light'|'dark') => void)[]} */
  #listeners = [];

  constructor() {
    this.#current = this.#readStored() ?? this.#systemPreference();
  }

  /** @returns {'light'|'dark'} */
  get current() {
    return this.#current;
  }

  /** @returns {boolean} */
  get isDark() {
    return this.#current === 'dark';
  }

  /**
   * Apply the stored/detected theme to the document root immediately.
   * Called once on init before any rendering to prevent flash.
   */
  applyInitial() {
    this.#apply(this.#current, false);
  }

  /**
   * Toggle between light and dark. Persists to localStorage and fires listeners.
   * @returns {'light'|'dark'} The new theme value
   */
  toggle() {
    const next = this.#current === 'dark' ? 'light' : 'dark';
    this.#apply(next, true);
    return next;
  }

  /**
   * Register a callback fired whenever the theme changes.
   * @param {(theme: 'light'|'dark') => void} fn
   */
  onChange(fn) {
    this.#listeners.push(fn);
  }

  // ------ Private ------

  /** @returns {'light'|'dark'|null} */
  #readStored() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      return stored === 'dark' || stored === 'light' ? stored : null;
    } catch {
      // localStorage blocked (private browsing, sandboxed iframe, etc.)
      return null;
    }
  }

  /** @returns {'light'|'dark'} */
  #systemPreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  /**
   * @param {'light'|'dark'} theme
   * @param {boolean} persist - whether to write to localStorage
   */
  #apply(theme, persist) {
    this.#current = theme;
    document.documentElement.setAttribute('data-theme', theme);

    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Silently ignore storage failures
      }
    }

    this.#listeners.forEach((fn) => fn(theme));
  }
}

// ---------------------------------------------------------------------------
// Focus trap utility
// ---------------------------------------------------------------------------

/**
 * Traps keyboard focus within a container element while active.
 * Used to keep focus inside the mobile menu when it is open —
 * required by WCAG 2.1 Success Criterion 2.1.2 (No Keyboard Trap).
 *
 * Trapping means Tab cycles through focusable elements inside the
 * container, and Shift+Tab cycles backwards — neither exits the container.
 * Pressing Escape fires an optional callback to close the container.
 */
class FocusTrap {
  /** @type {HTMLElement} */
  #container;

  /** @type {(() => void)|null} */
  #onEscape;

  /** @type {((e: KeyboardEvent) => void)} */
  #handler;

  /** @type {boolean} */
  #active = false;

  /**
   * @param {HTMLElement} container
   * @param {() => void} [onEscape]
   */
  constructor(container, onEscape = null) {
    this.#container = container;
    this.#onEscape  = onEscape;
    this.#handler   = this.#handleKeydown.bind(this);
  }

  /** Activate the trap. Moves focus to the first focusable element. */
  activate() {
    if (this.#active) return;
    this.#active = true;
    document.addEventListener('keydown', this.#handler);

    // Move focus into the container on the next frame so the element
    // is visible before focus is attempted (avoids browser scroll jump).
    requestAnimationFrame(() => {
      const first = this.#getFocusable()[0];
      first?.focus({ preventScroll: true });
    });
  }

  /** Deactivate the trap. Does not move focus — the caller restores it. */
  deactivate() {
    if (!this.#active) return;
    this.#active = false;
    document.removeEventListener('keydown', this.#handler);
  }

  // ------ Private ------

  /**
   * Returns all currently focusable elements inside the container,
   * in DOM order, excluding hidden or disabled elements.
   *
   * @returns {HTMLElement[]}
   */
  #getFocusable() {
    const candidates = this.#container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"]), details > summary'
    );

    return Array.from(candidates).filter((el) => {
      // Exclude elements not visible to the user
      if (el.offsetParent === null) return false;
      if (getComputedStyle(el).visibility === 'hidden') return false;
      if (getComputedStyle(el).display === 'none') return false;
      return true;
    });
  }

  /** @param {KeyboardEvent} e */
  #handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.#onEscape?.();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = this.#getFocusable();
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab — backwards: wrap from first to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else {
      // Tab — forwards: wrap from last to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Navigation class
// ---------------------------------------------------------------------------

/**
 * Primary navigation component.
 *
 * Lifecycle:
 *   1. new Navigation()   — creates instances, does nothing to the DOM
 *   2. .init()            — renders HTML, attaches events, starts observers
 *   3. .setItems(items)   — re-renders nav links (called by router on page change)
 *   4. .destroy()         — removes all listeners and observers (SPA teardown)
 */
export class Navigation {
  // ---- Configuration -------------------------------------------------------

  /** @type {Array<{id:string, label:string, href:string, icon?:string, children?:Array}>} */
  #items = FALLBACK_NAV_ITEMS;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */   #header   = null;
  /** @type {HTMLElement|null} */   #menu     = null;
  /** @type {HTMLElement|null} */   #list     = null;
  /** @type {HTMLButtonElement|null} */ #hamburger = null;
  /** @type {HTMLButtonElement|null} */ #themeBtn  = null;
  /** @type {HTMLElement|null} */   #overlay  = null;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean} */ #menuOpen    = false;
  /** @type {boolean} */ #isDesktop   = false;
  /** @type {number}  */ #lastScrollY = 0;
  /** @type {boolean} */ #scrollHide  = false;

  // ---- Services ------------------------------------------------------------

  /** @type {ThemeManager} */ #theme;
  /** @type {FocusTrap}    */ #focusTrap;

  // ---- Cleanup references --------------------------------------------------

  /** @type {HTMLElement|null} Element that opened the menu — focus restored on close */
  #triggerElement = null;

  /** @type {(() => void)[]} Functions to call on destroy() */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  constructor() {
    this.#theme = new ThemeManager();
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Initialise the navigation component.
   * Renders HTML into existing header, attaches all event listeners,
   * and starts the scroll / resize observers.
   *
   * @returns {Navigation} this — for optional chaining
   */
  init() {
    // Apply theme before any rendering to prevent flash of wrong theme
    this.#theme.applyInitial();

    // Determine if we are starting on desktop
    this.#isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;

    // Find or create the header element
    this.#header = document.getElementById('site-header');
    if (!this.#header) {
      this.#header = this.#createHeader();
      document.body.insertAdjacentElement('afterbegin', this.#header);
    }

    // Create the backdrop overlay (lives outside the header in the DOM)
    this.#overlay = document.getElementById('nav-overlay');
    if (!this.#overlay) {
      this.#overlay = this.#createOverlay();
      this.#header.insertAdjacentElement('afterend', this.#overlay);
    }

    // Render nav content into the header
    this.#render();

    // Cache references to rendered elements
    this.#menu      = this.#header.querySelector(`.${CSS.MENU}`);
    this.#list      = this.#header.querySelector(`.${CSS.LIST}`);
    this.#hamburger = this.#header.querySelector(`.${CSS.HAMBURGER}`);
    this.#themeBtn  = this.#header.querySelector(`.${CSS.THEME_TOGGLE}`);

    // Set up the focus trap for the mobile menu
    this.#focusTrap = new FocusTrap(
      this.#menu,
      () => this.#closeMenu('escape')
    );

    // Attach all event listeners
    this.#attachEvents();

    // Highlight the active link for the current page
    this.#updateActiveLink();

    // Watch for OS theme changes (user switches system appearance mid-session)
    this.#watchSystemTheme();

    return this;
  }

  /**
   * Replace the navigation items and re-render the link list.
   * Called by the router after each page navigation in SPA mode.
   *
   * @param {Array<{id:string, label:string, href:string, icon?:string}>} items
   */
  setItems(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    this.#items = items;

    if (this.#list) {
      this.#list.innerHTML = this.#renderNavItems();
      this.#attachLinkEvents();
      this.#updateActiveLink();
    }
  }

  /**
   * Programmatically update the active link (called by router on navigation).
   *
   * @param {string} [pathname] - Path to mark active. Defaults to location.pathname.
   */
  updateActiveLink(pathname) {
    this.#updateActiveLink(pathname);
  }

  /**
   * Tear down all event listeners, observers, and DOM modifications.
   * Call when removing the navigation component (not typically needed but
   * ensures clean SPA teardown if the architecture ever requires it).
   */
  destroy() {
    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];
    this.#focusTrap?.deactivate();
    if (this.#menuOpen) this.#unlockScroll();
  }

  // ---- HTML rendering ------------------------------------------------------

  /**
   * Creates a bare header element.
   * The real header is expected in HTML; this is the fallback.
   *
   * @returns {HTMLElement}
   */
  #createHeader() {
    const header = document.createElement('header');
    header.id        = 'site-header';
    header.className = CSS.NAV;
    header.setAttribute('role', 'banner');
    return header;
  }

  /**
   * Creates the full-screen backdrop overlay for the mobile menu.
   *
   * @returns {HTMLElement}
   */
  #createOverlay() {
    const overlay = document.createElement('div');
    overlay.id        = 'nav-overlay';
    overlay.className = CSS.OVERLAY;
    overlay.setAttribute('aria-hidden', 'true');
    return overlay;
  }

  /**
   * Renders the complete navigation HTML into the header element.
   * Idempotent — safe to call multiple times (clears before rendering).
   */
  #render() {
    this.#header.innerHTML = `
      <div class="${CSS.NAV}__container">

        <!-- Logo -->
        <a href="/"
           class="${CSS.LOGO}"
           aria-label="Python for AI — return to homepage">
          <span class="${CSS.LOGO_MARK}" aria-hidden="true">Py</span>
          <span class="${CSS.LOGO_TEXT}">Python <em>for</em> AI</span>
        </a>

        <!-- Primary navigation menu -->
        <nav class="${CSS.MENU}"
             id="primary-nav"
             aria-label="Primary navigation"
             aria-hidden="${this.#isDesktop ? 'false' : 'true'}">
          <ul class="${CSS.LIST}"
              role="list">
            ${this.#renderNavItems()}
          </ul>
        </nav>

        <!-- Actions: theme toggle + hamburger -->
        <div class="${CSS.ACTIONS}">

          <!-- Theme toggle button -->
          <button class="${CSS.THEME_TOGGLE}"
                  id="theme-toggle"
                  type="button"
                  aria-label="${this.#theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
                  aria-pressed="${this.#theme.isDark}">
            <span class="${CSS.THEME_ICON_LIGHT}" aria-hidden="true">
              ${getIcon('sun')}
            </span>
            <span class="${CSS.THEME_ICON_DARK}" aria-hidden="true">
              ${getIcon('moon')}
            </span>
          </button>

          <!-- Hamburger — mobile only, hidden on desktop via CSS -->
          <button class="${CSS.HAMBURGER}"
                  id="nav-hamburger"
                  type="button"
                  aria-label="Open navigation menu"
                  aria-expanded="false"
                  aria-controls="primary-nav"
                  aria-haspopup="true">
            <span class="${CSS.HAMBURGER_BAR}" aria-hidden="true"></span>
            <span class="${CSS.HAMBURGER_BAR}" aria-hidden="true"></span>
            <span class="${CSS.HAMBURGER_BAR}" aria-hidden="true"></span>
            <span class="sr-only">Menu</span>
          </button>

        </div>
      </div>
    `;
  }

  /**
   * Renders <li> elements for every nav item.
   * Supports one level of dropdown children.
   *
   * @returns {string} HTML string of <li> elements
   */
  #renderNavItems() {
    return this.#items.map((item) => {
      const hasChildren = Array.isArray(item.children) && item.children.length > 0;

      if (hasChildren) {
        return this.#renderDropdownItem(item);
      }

      return `
        <li class="${CSS.ITEM}" role="none">
          <a href="${this.#escapeAttr(item.href)}"
             class="${CSS.LINK}"
             data-nav-id="${this.#escapeAttr(item.id)}"
             role="menuitem">
            ${item.icon ? `<span class="${CSS.LINK}__icon" aria-hidden="true">${getIcon(item.icon)}</span>` : ''}
            <span>${this.#escapeHtml(item.label)}</span>
          </a>
        </li>
      `;
    }).join('');
  }

  /**
   * Renders a nav item that has dropdown children.
   * Uses a <button> + <ul> pattern (not a disclosure <details>) for
   * full keyboard and ARIA compliance.
   *
   * @param {{ id:string, label:string, href:string, icon?:string, children:Array }} item
   * @returns {string} HTML string
   */
  #renderDropdownItem(item) {
    const dropdownId = `dropdown-${item.id}`;

    const childItems = item.children.map((child) => `
      <li role="none">
        <a href="${this.#escapeAttr(child.href)}"
           class="${CSS.DROPDOWN_LINK}"
           data-nav-id="${this.#escapeAttr(child.id)}"
           role="menuitem"
           tabindex="-1">
          ${child.icon ? `<span aria-hidden="true">${getIcon(child.icon)}</span>` : ''}
          <span>${this.#escapeHtml(child.label)}</span>
        </a>
      </li>
    `).join('');

    return `
      <li class="${CSS.ITEM} ${CSS.ITEM_DROPDOWN}" role="none">
        <button class="${CSS.LINK}"
                data-nav-id="${this.#escapeAttr(item.id)}"
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded="false"
                aria-controls="${dropdownId}">
          ${item.icon ? `<span class="${CSS.LINK}__icon" aria-hidden="true">${getIcon(item.icon)}</span>` : ''}
          <span>${this.#escapeHtml(item.label)}</span>
          <span class="${CSS.LINK}__chevron" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                 xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </button>
        <ul id="${dropdownId}"
            class="${CSS.DROPDOWN}"
            role="menu"
            aria-label="${this.#escapeAttr(item.label)} submenu"
            hidden>
          ${childItems}
        </ul>
      </li>
    `;
  }

  // ---- Event handling ------------------------------------------------------

  /**
   * Attaches all event listeners. Each listener function reference is stored
   * so it can be removed precisely in destroy() — no anonymous functions here.
   */
  #attachEvents() {
    // ── Hamburger ──────────────────────────────────────────────────────────
    if (this.#hamburger) {
      const onHamburger = () => this.#toggleMenu();
      this.#hamburger.addEventListener('click', onHamburger);
      this.#cleanupFns.push(() =>
        this.#hamburger.removeEventListener('click', onHamburger)
      );
    }

    // ── Overlay (backdrop click closes menu) ───────────────────────────────
    if (this.#overlay) {
      const onOverlay = () => this.#closeMenu('overlay');
      this.#overlay.addEventListener('click', onOverlay);
      this.#cleanupFns.push(() =>
        this.#overlay.removeEventListener('click', onOverlay)
      );
    }

    // ── Theme toggle ───────────────────────────────────────────────────────
    if (this.#themeBtn) {
      const onTheme = () => this.#handleThemeToggle();
      this.#themeBtn.addEventListener('click', onTheme);
      this.#cleanupFns.push(() =>
        this.#themeBtn.removeEventListener('click', onTheme)
      );
    }

    // ── Scroll behaviour (sticky + hide-on-scroll-down) ───────────────────
    const onScroll = this.#throttle(() => this.#handleScroll(), 100);
    window.addEventListener('scroll', onScroll, { passive: true });
    this.#cleanupFns.push(() =>
      window.removeEventListener('scroll', onScroll)
    );

    // ── Resize (switch between mobile/desktop modes) ───────────────────────
    const onResize = this.#debounce(() => this.#handleResize(), 150);
    window.addEventListener('resize', onResize, { passive: true });
    this.#cleanupFns.push(() =>
      window.removeEventListener('resize', onResize)
    );

    // ── Global keyboard (Escape closes open menus from anywhere) ──────────
    const onKeydown = (e) => this.#handleGlobalKeydown(e);
    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() =>
      document.removeEventListener('keydown', onKeydown)
    );

    // ── Click-outside (closes dropdown submenus) ───────────────────────────
    const onClickOutside = (e) => this.#handleClickOutside(e);
    document.addEventListener('click', onClickOutside, true); // capture phase
    this.#cleanupFns.push(() =>
      document.removeEventListener('click', onClickOutside, true)
    );

    // ── Nav link events (delegated to the list) ────────────────────────────
    this.#attachLinkEvents();

    // ── Header arrow-key navigation between top-level items ───────────────
    if (this.#list) {
      const onListKeydown = (e) => this.#handleListKeydown(e);
      this.#list.addEventListener('keydown', onListKeydown);
      this.#cleanupFns.push(() =>
        this.#list.removeEventListener('keydown', onListKeydown)
      );
    }
  }

  /**
   * Attaches click handlers to all navigation links via event delegation.
   * Called again after setItems() re-renders the link list.
   */
  #attachLinkEvents() {
    if (!this.#list) return;

    // Remove previous delegated listener if one exists
    if (this._linkClickHandler) {
      this.#list.removeEventListener('click', this._linkClickHandler);
    }

    this._linkClickHandler = (e) => this.#handleNavClick(e);
    this.#list.addEventListener('click', this._linkClickHandler);
  }

  // ---- Event handlers ------------------------------------------------------

  /**
   * Handles click events inside the nav list.
   * Routes to link navigation or dropdown toggle based on the target.
   *
   * @param {MouseEvent} e
   */
  #handleNavClick(e) {
    const link     = e.target.closest(`.${CSS.LINK}`);
    const dropLink = e.target.closest(`.${CSS.DROPDOWN_LINK}`);

    // Dropdown toggle button (a nav item that IS a button, not an anchor)
    if (link && link.tagName === 'BUTTON' && link.closest(`.${CSS.ITEM_DROPDOWN}`)) {
      e.preventDefault();
      this.#toggleDropdown(link);
      return;
    }

    // Regular nav link or dropdown child link
    if (link || dropLink) {
      const anchor = link || dropLink;

      // Close mobile menu when a link is clicked
      if (this.#menuOpen) {
        this.#closeMenu('link-click');
      }

      // Close any open dropdowns
      this.#closeAllDropdowns();

      // Dispatch event for the router / analytics
      this.#dispatch(NAV_EVENTS.LINK_CLICKED, {
        href:  anchor.getAttribute('href'),
        navId: anchor.dataset.navId,
      });
    }
  }

  /**
   * Handles keyboard navigation across the top-level nav items.
   * Implements ARIA Authoring Practices Guide menubar pattern:
   *   - ArrowRight / ArrowLeft — move between top-level items
   *   - ArrowDown  — open dropdown (if present), focus first child
   *   - ArrowUp    — open dropdown (if present), focus last child
   *   - Home       — focus first item
   *   - End        — focus last item
   *   - Escape     — close dropdown if open
   *
   * @param {KeyboardEvent} e
   */
  #handleListKeydown(e) {
    const topLinks    = Array.from(this.#list.querySelectorAll(`:scope > .${CSS.ITEM} > .${CSS.LINK}`));
    const currentLink = document.activeElement;
    const currentIdx  = topLinks.indexOf(currentLink);

    if (currentIdx === -1) return; // Focus is not on a top-level item

    switch (e.key) {
      case 'ArrowRight': {
        e.preventDefault();
        const next = topLinks[(currentIdx + 1) % topLinks.length];
        next?.focus();
        break;
      }

      case 'ArrowLeft': {
        e.preventDefault();
        const prev = topLinks[(currentIdx - 1 + topLinks.length) % topLinks.length];
        prev?.focus();
        break;
      }

      case 'Home': {
        e.preventDefault();
        topLinks[0]?.focus();
        break;
      }

      case 'End': {
        e.preventDefault();
        topLinks[topLinks.length - 1]?.focus();
        break;
      }

      case 'ArrowDown': {
        e.preventDefault();
        const parentItem = currentLink.closest(`.${CSS.ITEM_DROPDOWN}`);
        if (parentItem) {
          this.#openDropdown(currentLink, 'first');
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const parentItem = currentLink.closest(`.${CSS.ITEM_DROPDOWN}`);
        if (parentItem) {
          this.#openDropdown(currentLink, 'last');
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Handles keydown events on dropdown links.
   * ArrowUp/ArrowDown navigate within the dropdown.
   * Escape closes the dropdown and returns focus to the trigger.
   *
   * This handler is attached to individual dropdowns when they are opened
   * and removed when they are closed, keeping listener count minimal.
   *
   * @param {KeyboardEvent} e
   */
  #handleDropdownKeydown(e) {
    const dropdown = e.currentTarget;
    const items    = Array.from(dropdown.querySelectorAll(`.${CSS.DROPDOWN_LINK}`));
    const idx      = items.indexOf(document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
        break;
      }
      case 'Tab': {
        // Tab away from the last dropdown item closes the dropdown
        if (!e.shiftKey && idx === items.length - 1) {
          this.#closeAllDropdowns();
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Global Escape key handler — closes open mobile menu or open dropdowns.
   *
   * @param {KeyboardEvent} e
   */
  #handleGlobalKeydown(e) {
    if (e.key !== 'Escape') return;

    const openDropdown = this.#list?.querySelector(`.${CSS.DROPDOWN}:not([hidden])`);
    if (openDropdown) {
      e.preventDefault();
      this.#closeAllDropdowns();
      return;
    }

    if (this.#menuOpen) {
      e.preventDefault();
      this.#closeMenu('escape');
    }
  }

  /**
   * Closes open dropdowns when the user clicks outside the navigation.
   *
   * @param {MouseEvent} e
   */
  #handleClickOutside(e) {
    if (!this.#header?.contains(e.target)) {
      this.#closeAllDropdowns();
    }
  }

  /**
   * Handles scroll events:
   *   - Adds the scrolled state (shadow) once the user scrolls past the header
   *   - Hides the header when scrolling down quickly (save screen space)
   *   - Shows the header when scrolling up
   */
  #handleScroll() {
    const scrollY         = window.scrollY;
    const headerHeight    = this.#header?.offsetHeight ?? 64;
    const scrollingDown   = scrollY > this.#lastScrollY;
    const scrollThreshold = 80; // px before triggering hide/show

    // Scrolled state — adds bottom shadow
    if (scrollY > 0) {
      this.#header?.classList.add(CSS.NAV_SCROLLED);
    } else {
      this.#header?.classList.remove(CSS.NAV_SCROLLED);
    }

    // Hide on scroll down / show on scroll up
    // Only activates after the user has scrolled past one full header height
    if (scrollY > headerHeight) {
      if (scrollingDown && scrollY - this.#lastScrollY > scrollThreshold / 2) {
        if (!this.#scrollHide && !this.#menuOpen) {
          this.#header?.classList.add(CSS.NAV_HIDDEN);
          this.#scrollHide = true;
        }
      } else if (!scrollingDown && this.#lastScrollY - scrollY > scrollThreshold / 4) {
        if (this.#scrollHide) {
          this.#header?.classList.remove(CSS.NAV_HIDDEN);
          this.#scrollHide = false;
        }
      }
    }

    this.#lastScrollY = scrollY;
  }

  /**
   * Handles viewport resize events.
   * When crossing the desktop breakpoint, synchronises nav state.
   */
  #handleResize() {
    const nowDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;

    if (nowDesktop && !this.#isDesktop) {
      // Switched from mobile → desktop: close the mobile menu silently
      this.#isDesktop = true;
      if (this.#menuOpen) {
        this.#closeMenu('resize');
      }
      // Show the nav menu (it is hidden by aria-hidden on mobile)
      this.#menu?.setAttribute('aria-hidden', 'false');
      this.#menu?.classList.remove(CSS.MENU_OPEN);
      this.#closeAllDropdowns();
    } else if (!nowDesktop && this.#isDesktop) {
      // Switched from desktop → mobile: hide the menu
      this.#isDesktop = false;
      this.#menu?.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * Handles the theme toggle button click.
   */
  #handleThemeToggle() {
    const newTheme = this.#theme.toggle();
    this.#updateThemeButton(newTheme);
    this.#dispatch(NAV_EVENTS.THEME_CHANGED, { theme: newTheme });
  }

  // ---- Mobile menu ---------------------------------------------------------

  /**
   * Toggles the mobile menu open/closed.
   */
  #toggleMenu() {
    if (this.#menuOpen) {
      this.#closeMenu('toggle');
    } else {
      this.#openMenu();
    }
  }

  /**
   * Opens the mobile menu.
   * Sets ARIA attributes, applies CSS classes, activates focus trap,
   * and locks body scroll so the menu is the only scrollable area.
   */
  #openMenu() {
    this.#menuOpen = true;
    this.#triggerElement = document.activeElement;

    // Update ARIA
    this.#hamburger?.setAttribute('aria-expanded', 'true');
    this.#hamburger?.setAttribute('aria-label',   'Close navigation menu');
    this.#menu?.setAttribute('aria-hidden', 'false');

    // Update CSS classes
    this.#header?.classList.add(CSS.NAV_MENU_OPEN);
    this.#menu?.classList.add(CSS.MENU_OPEN);
    this.#hamburger?.classList.add(CSS.HAMBURGER_OPEN);

    // Show overlay
    this.#overlay?.classList.add(CSS.OVERLAY_VISIBLE);
    this.#overlay?.setAttribute('aria-hidden', 'false');

    // Lock scroll — prevents the page behind the menu from scrolling
    this.#lockScroll();

    // Activate focus trap inside the menu
    this.#focusTrap?.activate();

    // Dispatch event for other components
    this.#dispatch(NAV_EVENTS.MENU_OPENED);
  }

  /**
   * Closes the mobile menu.
   * Restores ARIA attributes, removes CSS classes, deactivates focus trap,
   * and unlocks body scroll.
   *
   * @param {'toggle'|'escape'|'link-click'|'overlay'|'resize'} [reason='toggle']
   */
  #closeMenu(reason = 'toggle') {
    this.#menuOpen = false;

    // Update ARIA
    this.#hamburger?.setAttribute('aria-expanded', 'false');
    this.#hamburger?.setAttribute('aria-label',   'Open navigation menu');
    this.#menu?.setAttribute('aria-hidden', 'true');

    // Update CSS classes
    this.#header?.classList.remove(CSS.NAV_MENU_OPEN);
    this.#menu?.classList.remove(CSS.MENU_OPEN);
    this.#hamburger?.classList.remove(CSS.HAMBURGER_OPEN);

    // Hide overlay
    this.#overlay?.classList.remove(CSS.OVERLAY_VISIBLE);
    this.#overlay?.setAttribute('aria-hidden', 'true');

    // Unlock scroll
    this.#unlockScroll();

    // Deactivate focus trap
    this.#focusTrap?.deactivate();

    // Restore focus to the element that triggered the menu to open
    // — except when closing due to resize (no user gesture)
    if (reason !== 'resize' && this.#triggerElement) {
      // Defer to allow CSS transition to complete before moving focus
      requestAnimationFrame(() => {
        this.#triggerElement?.focus({ preventScroll: true });
        this.#triggerElement = null;
      });
    }

    this.#dispatch(NAV_EVENTS.MENU_CLOSED, { reason });
  }

  // ---- Dropdown menus ------------------------------------------------------

  /**
   * Toggles a dropdown submenu open or closed.
   *
   * @param {HTMLButtonElement} trigger - The button that controls the dropdown
   */
  #toggleDropdown(trigger) {
    const dropdownId = trigger.getAttribute('aria-controls');
    const dropdown   = document.getElementById(dropdownId);

    if (!dropdown) return;

    const isOpen = !dropdown.hidden;
    this.#closeAllDropdowns(); // Close any other open dropdown first

    if (!isOpen) {
      this.#openDropdown(trigger, 'first');
    }
  }

  /**
   * Opens a dropdown and moves focus to a child item.
   *
   * @param {HTMLButtonElement} trigger
   * @param {'first'|'last'} focusTarget - Which child to focus
   */
  #openDropdown(trigger, focusTarget = 'first') {
    const dropdownId = trigger.getAttribute('aria-controls');
    const dropdown   = document.getElementById(dropdownId);

    if (!dropdown) return;

    // Update ARIA + visibility
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.hidden = false;
    dropdown.classList.add(CSS.DROPDOWN_OPEN);

    // Make dropdown links keyboard-reachable
    const links = dropdown.querySelectorAll(`.${CSS.DROPDOWN_LINK}`);
    links.forEach((link) => link.setAttribute('tabindex', '0'));

    // Attach keydown handler for arrow navigation within this dropdown
    dropdown._keydownHandler = (e) => this.#handleDropdownKeydown(e);
    dropdown.addEventListener('keydown', dropdown._keydownHandler);

    // Move focus to the appropriate item
    requestAnimationFrame(() => {
      const items = Array.from(links);
      const target = focusTarget === 'last'
        ? items[items.length - 1]
        : items[0];
      target?.focus({ preventScroll: true });
    });
  }

  /**
   * Closes all open dropdowns and cleans up their event listeners.
   */
  #closeAllDropdowns() {
    if (!this.#list) return;

    const openDropdowns = this.#list.querySelectorAll(`.${CSS.DROPDOWN}:not([hidden])`);
    openDropdowns.forEach((dropdown) => {
      const trigger = this.#list.querySelector(
        `[aria-controls="${dropdown.id}"]`
      );
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
      }

      dropdown.hidden = true;
      dropdown.classList.remove(CSS.DROPDOWN_OPEN);

      // Remove the keydown handler and restore tabindex
      if (dropdown._keydownHandler) {
        dropdown.removeEventListener('keydown', dropdown._keydownHandler);
        delete dropdown._keydownHandler;
      }

      const links = dropdown.querySelectorAll(`.${CSS.DROPDOWN_LINK}`);
      links.forEach((link) => link.setAttribute('tabindex', '-1'));
    });
  }

  // ---- Active link management ----------------------------------------------

  /**
   * Marks the navigation link that matches the current page URL as active.
   * Uses aria-current="page" for accessibility and a CSS class for styling.
   *
   * Matching strategy (in order of precedence):
   *   1. Exact pathname match
   *   2. Pathname prefix match (for nested routes like /tutorials/python-basics)
   *
   * @param {string} [pathname] - Defaults to window.location.pathname
   */
  #updateActiveLink(pathname) {
    if (!this.#list) return;

    const current = pathname ?? window.location.pathname;

    // Normalise: strip trailing slash (except for root "/")
    const normalisedCurrent = current.length > 1
      ? current.replace(/\/$/, '')
      : current;

    const allLinks = this.#list.querySelectorAll(`.${CSS.LINK}, .${CSS.DROPDOWN_LINK}`);

    let matched = false;

    allLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;

      const normalisedHref = href.length > 1 ? href.replace(/\/$/, '') : href;

      // Exact match
      const isExact = normalisedHref === normalisedCurrent;

      // Prefix match — the link's href is a prefix of the current path
      // (e.g. /tutorials matches /tutorials/python-basics)
      // Guard against the root "/" matching everything
      const isPrefix = normalisedHref !== '/'
        && normalisedCurrent.startsWith(normalisedHref + '/');

      const isActive = isExact || isPrefix;

      link.classList.toggle(CSS.LINK_ACTIVE, isActive);
      link.classList.toggle(CSS.LINK_CURRENT, isExact);

      if (isActive) {
        // aria-current="page" on exact match only
        link.setAttribute('aria-current', isExact ? 'page' : 'true');
        matched = true;
      } else {
        link.removeAttribute('aria-current');
      }
    });

    // If no match found (e.g. root / on a file:// URL during dev), mark home
    if (!matched) {
      const homeLink = this.#list.querySelector('[data-nav-id="home"]');
      homeLink?.classList.add(CSS.LINK_ACTIVE, CSS.LINK_CURRENT);
      homeLink?.setAttribute('aria-current', 'page');
    }
  }

  // ---- Theme button sync ---------------------------------------------------

  /**
   * Updates the theme button's ARIA label and pressed state.
   *
   * @param {'light'|'dark'} theme
   */
  #updateThemeButton(theme) {
    if (!this.#themeBtn) return;

    const isDark  = theme === 'dark';
    const newLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

    this.#themeBtn.setAttribute('aria-label',   newLabel);
    this.#themeBtn.setAttribute('aria-pressed', String(isDark));
  }

  /**
   * Watches for OS-level theme changes (user switches system appearance)
   * and syncs the button state without changing the user's explicit choice.
   */
  #watchSystemTheme() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const onSystemChange = (e) => {
      // Only react to system changes if the user hasn't made an explicit choice
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (!stored) {
          // No explicit preference stored — follow the OS
          const systemTheme = e.matches ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', systemTheme);
          this.#updateThemeButton(systemTheme);
        }
      } catch {
        // localStorage unavailable — always follow OS
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      }
    };

    // Modern API
    if (mq.addEventListener) {
      mq.addEventListener('change', onSystemChange);
      this.#cleanupFns.push(() => mq.removeEventListener('change', onSystemChange));
    } else {
      // Legacy Safari fallback
      mq.addListener(onSystemChange);
      this.#cleanupFns.push(() => mq.removeListener(onSystemChange));
    }
  }

  // ---- Scroll locking ------------------------------------------------------

  /**
   * Prevents body scroll while the mobile menu is open.
   * Uses a CSS class + padding compensation technique to avoid content jump
   * that occurs when the scrollbar disappears.
   */
  #lockScroll() {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.setProperty('--scrollbar-compensation', `${scrollbarWidth}px`);
    document.body.classList.add(CSS.SCROLL_LOCKED);
  }

  /** Restores body scroll after the mobile menu is closed. */
  #unlockScroll() {
    document.body.classList.remove(CSS.SCROLL_LOCKED);
    document.body.style.removeProperty('--scrollbar-compensation');
  }

  // ---- Event bus -----------------------------------------------------------

  /**
   * Publishes an event to the global event bus (scripts/core/events.js).
   * Falls back gracefully if the event bus is not available.
   *
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  #dispatch(eventName, detail = {}) {
    // Attempt to use the project's event bus if available
    if (window.__pyaiEvents?.emit) {
      window.__pyaiEvents.emit(eventName, detail);
    }

    // Also dispatch a native CustomEvent for components that prefer that API
    const event = new CustomEvent(eventName, {
      bubbles:    true,
      cancelable: false,
      detail,
    });
    document.dispatchEvent(event);
  }

  // ---- Utilities -----------------------------------------------------------

  /**
   * Throttle — limits how often a function can fire.
   * Used for scroll events to prevent excessive layout reads.
   *
   * @param {Function} fn
   * @param {number} limitMs
   * @returns {Function}
   */
  #throttle(fn, limitMs) {
    let lastCall = 0;
    return function throttled(...args) {
      const now = performance.now();
      if (now - lastCall >= limitMs) {
        lastCall = now;
        fn.apply(this, args);
      }
    };
  }

  /**
   * Debounce — delays execution until after a quiet period.
   * Used for resize events to avoid thrashing during drag-resize.
   *
   * @param {Function} fn
   * @param {number} delayMs
   * @returns {Function}
   */
  #debounce(fn, delayMs) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delayMs);
    };
  }

  /**
   * Escapes HTML special characters to prevent XSS when rendering
   * user-controlled or data-driven strings into innerHTML.
   *
   * @param {string} str
   * @returns {string}
   */
  #escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, (c) => map[c]);
  }

  /**
   * Escapes a string for use inside an HTML attribute value.
   *
   * @param {string} str
   * @returns {string}
   */
  #escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default Navigation;