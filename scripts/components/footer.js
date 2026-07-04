/**
 * =============================================================================
 * FOOTER COMPONENT
 * scripts/components/footer.js
 * -----------------------------------------------------------------------------
 * Site-wide footer for the Python for AI educational platform.
 *
 * RESPONSIBILITIES:
 *   ① Brand column
 *      - Logo mark + wordmark consistent with the navigation header
 *      - Platform tagline
 *      - Social media icon links (GitHub, Twitter/X, YouTube, LinkedIn, Discord)
 *      - Each social link opens in a new tab with rel="noopener noreferrer"
 *        and a screen-reader visible label
 *
 *   ② Navigation columns
 *      - Learn     : Tutorials, Projects, Quizzes, Dashboard, Roadmap
 *      - Topics    : Python Basics, Data Science, Machine Learning,
 *                    Deep Learning, AI Agents
 *      - Resources : Cheat Sheets, Glossary, FAQ, Blog, Changelog
 *      - Platform  : About, Contribute, Open Source, Privacy, Terms
 *      Links are data-driven — columns are declared in FOOTER_COLUMNS and
 *      can be extended without touching the rendering logic.
 *
 *   ③ Newsletter subscription form (frontend-only)
 *      - Email input with live validation (format check, not empty)
 *      - ARIA live region announces success / error states
 *      - Submit simulates a network call (setTimeout) and shows three states:
 *        idle → loading → success | error
 *      - Rate-limited: disables re-submission for 60 s after success
 *      - localStorage flag prevents the widget from showing the prompt again
 *        within 7 days of a successful subscription
 *      - Full keyboard operation; no mouse required
 *
 *   ④ Bottom bar
 *      - Dynamic copyright year (always current, never stale)
 *      - "Back to top" button with smooth scroll + focus management
 *      - Theme toggle (secondary control, mirrors navigation.js toggle)
 *      - Accessibility / legal quick links
 *
 * DOES NOT OWN:
 *   - The sticky nav bar       → navigation.js
 *   - Page-level header/hero   → header.js
 *   - Theme state persistence  → navigation.js (ThemeManager)
 *     (footer reads data-theme attribute and dispatches toggle events;
 *      it does not manage localStorage directly)
 *
 * DEPENDENCIES:
 *   - scripts/core/events.js — event bus (window.__pyaiEvents)
 *   - variables.css tokens   — all styling via CSS classes, zero inline styles
 *
 * EVENT EMISSIONS:
 *   footer:newsletter:submitted  { email }
 *   footer:newsletter:success    { email }
 *   footer:newsletter:error      { message }
 *   footer:social:clicked        { platform, href }
 *   footer:nav:clicked           { column, label, href }
 *   footer:back-to-top           {}
 *   footer:theme:toggle          {}          ← nav:theme:changed fires in response
 *
 * EVENT SUBSCRIPTIONS:
 *   nav:theme:changed            — syncs the footer theme-toggle button label
 *   router:navigated             — re-highlights the active footer link
 *
 * USAGE (scripts/main.js):
 *
 *   import { Footer, FOOTER_EVENTS } from './components/footer.js';
 *
 *   const footer = new Footer();
 *   footer.init();
 *
 *   // Optional — listen for newsletter submission in main.js
 *   document.addEventListener(FOOTER_EVENTS.NEWSLETTER_SUCCESS, (e) => {
 *     console.log('Subscribed:', e.detail.email);
 *   });
 *
 * EXPORTS:
 *   Footer        — primary class (default export)
 *   FOOTER_EVENTS — event name constants
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const FOOTER_EVENTS = {
  NEWSLETTER_SUBMITTED: 'footer:newsletter:submitted',
  NEWSLETTER_SUCCESS:   'footer:newsletter:success',
  NEWSLETTER_ERROR:     'footer:newsletter:error',
  SOCIAL_CLICKED:       'footer:social:clicked',
  NAV_CLICKED:          'footer:nav:clicked',
  BACK_TO_TOP:          'footer:back-to-top',
  THEME_TOGGLE:         'footer:theme:toggle',
};

// ---------------------------------------------------------------------------
// BEM class name constants
// ---------------------------------------------------------------------------

/** Single source of truth for all CSS class names used in this module. */
const CSS = {
  // Root
  FOOTER:               'site-footer',
  FOOTER_INNER:         'site-footer__inner',

  // Brand column
  BRAND:                'site-footer__brand',
  BRAND_LOGO:           'site-footer__logo',
  BRAND_LOGO_MARK:      'site-footer__logo-mark',
  BRAND_LOGO_TEXT:      'site-footer__logo-text',
  BRAND_TAGLINE:        'site-footer__tagline',
  SOCIAL_LIST:          'site-footer__social-list',
  SOCIAL_ITEM:          'site-footer__social-item',
  SOCIAL_LINK:          'site-footer__social-link',

  // Navigation columns
  COLUMNS:              'site-footer__columns',
  COLUMN:               'site-footer__column',
  COLUMN_HEADING:       'site-footer__column-heading',
  COLUMN_LIST:          'site-footer__column-list',
  COLUMN_ITEM:          'site-footer__column-item',
  COLUMN_LINK:          'site-footer__column-link',
  COLUMN_LINK_ACTIVE:   'site-footer__column-link--active',
  COLUMN_BADGE:         'site-footer__column-badge',

  // Newsletter
  NEWSLETTER:           'site-footer__newsletter',
  NEWSLETTER_HEADING:   'site-footer__newsletter-heading',
  NEWSLETTER_DESC:      'site-footer__newsletter-desc',
  NEWSLETTER_FORM:      'site-footer__newsletter-form',
  NEWSLETTER_FIELD:     'site-footer__newsletter-field',
  NEWSLETTER_INPUT:     'site-footer__newsletter-input',
  NEWSLETTER_BTN:       'site-footer__newsletter-btn',
  NEWSLETTER_LIVE:      'site-footer__newsletter-live',
  NEWSLETTER_SUCCESS:   'site-footer__newsletter--success',
  NEWSLETTER_ERROR:     'site-footer__newsletter--error',
  NEWSLETTER_LOADING:   'site-footer__newsletter--loading',
  NEWSLETTER_DONE:      'site-footer__newsletter--done',

  // Bottom bar
  BOTTOM:               'site-footer__bottom',
  BOTTOM_INNER:         'site-footer__bottom-inner',
  COPYRIGHT:            'site-footer__copyright',
  LEGAL_LINKS:          'site-footer__legal-links',
  LEGAL_ITEM:           'site-footer__legal-item',
  LEGAL_LINK:           'site-footer__legal-link',
  BACK_TO_TOP:          'site-footer__back-to-top',
  THEME_TOGGLE:         'site-footer__theme-toggle',
};

// ---------------------------------------------------------------------------
// Static data — footer navigation columns
// ---------------------------------------------------------------------------

/**
 * @typedef  {Object} FooterLink
 * @property {string}   label         — Link text
 * @property {string}   href          — Destination URL
 * @property {boolean}  [external]    — Open in new tab
 * @property {string}   [badge]       — Short badge label (e.g. "New")
 *
 * @typedef  {Object} FooterColumn
 * @property {string}      heading    — Column heading text
 * @property {string}      id         — Unique column identifier
 * @property {FooterLink[]} links     — Links in this column
 */

/** @type {FooterColumn[]} */
const FOOTER_COLUMNS = [
  {
    id:      'learn',
    heading: 'Learn',
    links: [
      { label: 'Tutorials',  href: '/pages/tutorials.html'  },
      { label: 'Projects',   href: '/pages/projects.html'   },
      { label: 'Quizzes',    href: '/pages/quizzes.html'    },
      { label: 'Dashboard',  href: '/pages/dashboard.html'  },
      { label: 'Roadmap',    href: '#roadmap',              badge: 'Soon' },
    ],
  },
  {
    id:      'topics',
    heading: 'Topics',
    links: [
      { label: 'Python Basics',      href: '/pages/tutorials.html#basics'   },
      { label: 'Data Science',       href: '/pages/tutorials.html#datascience' },
      { label: 'Machine Learning',   href: '/pages/tutorials.html#ml'       },
      { label: 'Deep Learning',      href: '/pages/tutorials.html#dl'       },
      { label: 'AI Agents',          href: '/pages/tutorials.html#agents',  badge: 'New' },
    ],
  },
  {
    id:      'resources',
    heading: 'Resources',
    links: [
      { label: 'Cheat Sheets',  href: '#cheatsheets'                  },
      { label: 'Glossary',      href: '#glossary'                     },
      { label: 'FAQ',           href: '#faq'                          },
      { label: 'Blog',          href: '#blog',         badge: 'Soon'  },
      { label: 'Changelog',     href: '#changelog'                    },
    ],
  },
  {
    id:      'platform',
    heading: 'Platform',
    links: [
      { label: 'About',        href: '#about'                                                },
      { label: 'Contribute',   href: 'https://github.com/python-for-ai', external: true     },
      { label: 'Open Source',  href: 'https://github.com/python-for-ai', external: true     },
      { label: 'Privacy',      href: '#privacy'                                              },
      { label: 'Terms',        href: '#terms'                                                },
    ],
  },
];

// ---------------------------------------------------------------------------
// Social platform definitions
// ---------------------------------------------------------------------------

/**
 * @typedef  {Object} SocialLink
 * @property {string} id        — Platform identifier
 * @property {string} label     — Accessible label (appended: "Python for AI on …")
 * @property {string} href      — Profile URL (placeholder until real URLs are set)
 * @property {string} icon      — SVG markup key
 */

/** @type {SocialLink[]} */
const SOCIAL_LINKS = [
  {
    id:    'github',
    label: 'GitHub',
    href:  'https://github.com/python-for-ai',
    icon:  'github',
  },
  {
    id:    'youtube',
    label: 'YouTube',
    href:  'https://youtube.com/@python-for-ai',
    icon:  'youtube',
  },
  {
    id:    'twitter',
    label: 'X (Twitter)',
    href:  'https://twitter.com/python_for_ai',
    icon:  'twitter',
  },
  {
    id:    'linkedin',
    label: 'LinkedIn',
    href:  'https://linkedin.com/company/python-for-ai',
    icon:  'linkedin',
  },
  {
    id:    'discord',
    label: 'Discord',
    href:  'https://discord.gg/python-for-ai',
    icon:  'discord',
  },
];

// ---------------------------------------------------------------------------
// Newsletter configuration
// ---------------------------------------------------------------------------

const NEWSLETTER_CONFIG = {
  /** localStorage key recording a successful subscription timestamp */
  STORAGE_KEY:        'pyai-newsletter-subscribed',

  /** How long (ms) to suppress the form after a successful subscription */
  SUPPRESS_DURATION:  7 * 24 * 60 * 60 * 1000,   // 7 days

  /** How long (ms) to disable re-submission after success in this session */
  COOLDOWN_MS:        60_000,

  /** Simulated network delay range in ms */
  SIM_DELAY:          { min: 800, max: 1800 },
};

// ---------------------------------------------------------------------------
// Inline SVG icon factory
// ---------------------------------------------------------------------------

/**
 * Returns an inline SVG string for a named icon.
 * All icons use aria-hidden="true"; surrounding text or aria-label carries
 * the accessible name.
 *
 * @param {string} name
 * @param {number} [size=20]
 * @returns {string}
 */
function icon(name, size = 20) {
  const d = size;
  const ICONS = {

    // Social platforms
    github: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" focusable="false">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205
                 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04
                 -3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7
                 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838
                 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108
                 -.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93
                 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176
                 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006
                 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653
                 .24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805
                 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896
                 -.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24
                 12.297c0-6.627-5.373-12-12-12"/>
      </svg>`,

    youtube: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" focusable="false">
        <path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501
                 -9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0
                 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247
                 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502
                 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0
                 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0
                 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/>
      </svg>`,

    twitter: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" focusable="false">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214
                 -6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713
                 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>`,

    linkedin: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" focusable="false">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852
                 -3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414
                 v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37
                 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065
                 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452
                 zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24
                 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774
                 23.2 0 22.222 0h.003z"/>
      </svg>`,

    discord: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="currentColor"
           aria-hidden="true" focusable="false">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074
                 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27
                 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0
                 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0
                 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.085.119
                 18.11.143 18.126a19.916 19.916 0 0 0 5.993 3.03.078.078
                 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.04
                 .001-.088-.041-.104a13.16 13.16 0 0 1-1.872-.892.077.077
                 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1
                 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1
                 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127
                 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36
                 .698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839
                 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177
                 -.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
      </svg>`,

    // UI icons
    arrowUp: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false">
        <line x1="12" y1="19" x2="12" y2="5"/>
        <polyline points="5 12 12 5 19 12"/>
      </svg>`,

    sun: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1"  x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1"  y1="12" x2="3"  y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
        <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
      </svg>`,

    moon: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>`,

    send: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>`,

    check: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`,

    spinner: `
      <svg width="${d}" height="${d}" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true" focusable="false"
           class="animate-spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>`,
  };

  return ICONS[name] ?? '';
}

// ---------------------------------------------------------------------------
// Escape utilities (consistent with navigation.js / header.js)
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside HTML text nodes.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Escape a string for safe use inside an HTML attribute value.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

/**
 * Lightweight RFC-5322-inspired email format check.
 * Intentionally permissive — the server validates properly.
 * This is purely a UX guard against obvious mistakes (no @, no dot, etc.)
 *
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  const trimmed = String(email).trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  // Must have exactly one @, at least one char before, domain with at least one dot
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

// ---------------------------------------------------------------------------
// Footer class
// ---------------------------------------------------------------------------

/**
 * Site-wide footer component.
 *
 * Lifecycle:
 *   1. new Footer()  — creates instance, no DOM side-effects
 *   2. .init()       — renders HTML, attaches events, starts observers
 *   3. .destroy()    — removes all listeners (SPA teardown)
 */
export class Footer {
  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   footerId:          string,
   *   siteTitle:         string,
   *   tagline:           string,
   *   newsletterHeading: string,
   *   newsletterDesc:    string,
   *   columns:           FooterColumn[],
   *   social:            SocialLink[],
   *   legalLinks:        Array<{label:string, href:string}>,
   * }}
   */
  #config;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}      */ #footer          = null;
  /** @type {HTMLInputElement|null} */ #newsletterInput = null;
  /** @type {HTMLButtonElement|null}*/ #newsletterBtn   = null;
  /** @type {HTMLElement|null}      */ #newsletterLive  = null;
  /** @type {HTMLElement|null}      */ #newsletterForm  = null;
  /** @type {HTMLElement|null}      */ #backToTopBtn    = null;
  /** @type {HTMLButtonElement|null}*/ #themeBtn        = null;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean} */ #newsletterSubmitting = false;
  /** @type {boolean} */ #newsletterDone       = false;
  /** @type {number|null} */ #cooldownTimer    = null;

  // ---- Cleanup -------------------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   footerId?:          string,
   *   siteTitle?:         string,
   *   tagline?:           string,
   *   newsletterHeading?: string,
   *   newsletterDesc?:    string,
   *   columns?:           FooterColumn[],
   *   social?:            SocialLink[],
   *   legalLinks?:        Array<{label:string, href:string}>,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = {
      footerId:          config.footerId          ?? 'site-footer',
      siteTitle:         config.siteTitle         ?? 'Python for AI',
      tagline:           config.tagline           ?? 'Learn Python for AI, Machine Learning, and Data Science through hands-on tutorials and real projects.',
      newsletterHeading: config.newsletterHeading ?? 'Stay in the loop',
      newsletterDesc:    config.newsletterDesc    ?? 'Get new tutorials, projects, and AI learning resources delivered to your inbox. No spam, unsubscribe anytime.',
      columns:           config.columns           ?? FOOTER_COLUMNS,
      social:            config.social            ?? SOCIAL_LINKS,
      legalLinks:        config.legalLinks        ?? [
        { label: 'Privacy',      href: '#privacy' },
        { label: 'Terms',        href: '#terms'   },
        { label: 'Accessibility',href: '#a11y'    },
      ],
    };
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Initialise the footer.
   * Finds or creates the footer element, renders all HTML,
   * and attaches all event listeners.
   *
   * @returns {Footer} this — for optional chaining
   */
  init() {
    this.#resolveFooterElement();
    this.#render();
    this.#cacheRefs();
    this.#attachEvents();
    this.#checkNewsletterSuppression();
    this.#syncThemeButton();
    return this;
  }

  /**
   * Programmatically update the active footer link.
   * Called by the router after each SPA navigation.
   *
   * @param {string} [pathname] — Defaults to window.location.pathname
   */
  updateActiveLink(pathname) {
    this.#highlightActiveLink(pathname ?? window.location.pathname);
  }

  /**
   * Release all event listeners and timers.
   */
  destroy() {
    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];
    if (this.#cooldownTimer !== null) {
      clearTimeout(this.#cooldownTimer);
      this.#cooldownTimer = null;
    }
  }

  // ---- DOM resolution ------------------------------------------------------

  /**
   * Resolves or creates the <footer> element.
   * Inserts it at the end of <body> if it does not already exist in the HTML.
   */
  #resolveFooterElement() {
    this.#footer = document.getElementById(this.#config.footerId);

    if (!this.#footer) {
      this.#footer    = document.createElement('footer');
      this.#footer.id = this.#config.footerId;
      document.body.appendChild(this.#footer);
    }

    this.#footer.className = CSS.FOOTER;
    this.#footer.setAttribute('role', 'contentinfo');
    this.#footer.setAttribute('aria-label', `${escapeAttr(this.#config.siteTitle)} site footer`);
  }

  // ---- HTML rendering ------------------------------------------------------

  /**
   * Renders all footer HTML into the footer element.
   * The footer is structured into three stacked regions:
   *   1. Main body   — brand + nav columns + newsletter
   *   2. Bottom bar  — copyright + legal links + back-to-top + theme toggle
   */
  #render() {
    this.#footer.innerHTML = `
      <div class="${CSS.FOOTER_INNER}">
        ${this.#renderBrandColumn()}
        ${this.#renderNavColumns()}
        ${this.#renderNewsletter()}
      </div>
      ${this.#renderBottomBar()}
    `;
  }

  /**
   * Renders the brand column: logo, tagline, social links.
   * @returns {string}
   */
  #renderBrandColumn() {
    const socialItems = this.#config.social
      .map((s) => `
        <li class="${CSS.SOCIAL_ITEM}">
          <a href="${escapeAttr(s.href)}"
             class="${CSS.SOCIAL_LINK}"
             target="_blank"
             rel="noopener noreferrer"
             aria-label="${escapeAttr(this.#config.siteTitle)} on ${escapeAttr(s.label)}"
             data-social-id="${escapeAttr(s.id)}">
            ${icon(s.icon, 20)}
          </a>
        </li>
      `).join('');

    return `
      <div class="${CSS.BRAND}">

        <!-- Logo -->
        <a href="/"
           class="${CSS.BRAND_LOGO}"
           aria-label="${escapeAttr(this.#config.siteTitle)} — return to homepage">
          <span class="${CSS.BRAND_LOGO_MARK}" aria-hidden="true">Py</span>
          <span class="${CSS.BRAND_LOGO_TEXT}">
            Python <em>for</em> AI
          </span>
        </a>

        <!-- Tagline -->
        <p class="${CSS.BRAND_TAGLINE}">
          ${escapeHtml(this.#config.tagline)}
        </p>

        <!-- Social links -->
        <ul class="${CSS.SOCIAL_LIST}" role="list" aria-label="Social media links">
          ${socialItems}
        </ul>

      </div>
    `;
  }

  /**
   * Renders the navigation columns section.
   * Each column is generated from the FOOTER_COLUMNS data array.
   * @returns {string}
   */
  #renderNavColumns() {
    const columns = this.#config.columns.map((col) => {
      const items = col.links.map((link) => {
        const externalAttrs = link.external
          ? `target="_blank" rel="noopener noreferrer"`
          : '';

        const badge = link.badge
          ? `<span class="${CSS.COLUMN_BADGE}" aria-label="(${escapeAttr(link.badge)})">${escapeHtml(link.badge)}</span>`
          : '';

        return `
          <li class="${CSS.COLUMN_ITEM}">
            <a href="${escapeAttr(link.href)}"
               class="${CSS.COLUMN_LINK}"
               data-footer-href="${escapeAttr(link.href)}"
               ${externalAttrs}
               ${link.external ? `aria-label="${escapeAttr(link.label)} (opens in new tab)"` : ''}>
              ${escapeHtml(link.label)}${badge}
            </a>
          </li>
        `;
      }).join('');

      return `
        <div class="${CSS.COLUMN}">
          <h2 class="${CSS.COLUMN_HEADING}">${escapeHtml(col.heading)}</h2>
          <ul class="${CSS.COLUMN_LIST}" role="list">
            ${items}
          </ul>
        </div>
      `;
    }).join('');

    return `
      <nav class="${CSS.COLUMNS}" aria-label="Footer navigation">
        ${columns}
      </nav>
    `;
  }

  /**
   * Renders the newsletter subscription widget.
   * If the user already subscribed within the suppression window,
   * this renders a minimal "you're subscribed" confirmation instead of the form.
   *
   * The actual suppression check happens after mounting in
   * #checkNewsletterSuppression() — this always renders the form initially
   * to avoid an empty flash during DOM construction.
   *
   * @returns {string}
   */
  #renderNewsletter() {
    const inputId  = 'footer-newsletter-email';
    const liveId   = 'footer-newsletter-live';

    return `
      <div class="${CSS.NEWSLETTER}"
           aria-labelledby="footer-newsletter-heading">

        <h2 class="${CSS.NEWSLETTER_HEADING}"
            id="footer-newsletter-heading">
          ${escapeHtml(this.#config.newsletterHeading)}
        </h2>

        <p class="${CSS.NEWSLETTER_DESC}">
          ${escapeHtml(this.#config.newsletterDesc)}
        </p>

        <form class="${CSS.NEWSLETTER_FORM}"
              id="footer-newsletter-form"
              novalidate
              aria-describedby="${liveId}">

          <div class="${CSS.NEWSLETTER_FIELD}">
            <label for="${inputId}" class="sr-only">
              Email address
            </label>
            <input
              id="${inputId}"
              class="${CSS.NEWSLETTER_INPUT}"
              type="email"
              name="email"
              autocomplete="email"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="you@example.com"
              aria-label="Your email address"
              aria-required="true"
              aria-describedby="${liveId}"
              required
            />
            <button
              class="${CSS.NEWSLETTER_BTN}"
              type="submit"
              aria-label="Subscribe to the Python for AI newsletter">
              <span class="newsletter-btn__idle" aria-hidden="false">
                ${icon('send', 16)}
                <span>Subscribe</span>
              </span>
              <span class="newsletter-btn__loading" aria-hidden="true">
                ${icon('spinner', 16)}
                <span>Sending…</span>
              </span>
            </button>
          </div>

        </form>

        <!-- ARIA live region: announces success, error, and validation messages -->
        <div id="${liveId}"
             class="${CSS.NEWSLETTER_LIVE}"
             role="status"
             aria-live="polite"
             aria-atomic="true">
        </div>

      </div>
    `;
  }

  /**
   * Renders the bottom bar: copyright, legal links, back-to-top, theme toggle.
   * @returns {string}
   */
  #renderBottomBar() {
    const year = new Date().getFullYear();

    const legalItems = this.#config.legalLinks.map((link) => `
      <li class="${CSS.LEGAL_ITEM}">
        <a href="${escapeAttr(link.href)}" class="${CSS.LEGAL_LINK}">
          ${escapeHtml(link.label)}
        </a>
      </li>
    `).join('');

    // Read current theme to set correct initial button state
    const currentTheme = document.documentElement.getAttribute('data-theme') ?? 'light';
    const isDark       = currentTheme === 'dark';

    return `
      <div class="${CSS.BOTTOM}">
        <div class="${CSS.BOTTOM_INNER}">

          <!-- Copyright -->
          <p class="${CSS.COPYRIGHT}">
            <span aria-hidden="true">&copy;</span>
            <span class="sr-only">Copyright</span>
            <span id="footer-year">${year}</span>
            ${escapeHtml(this.#config.siteTitle)}.
            Built with ♥ for AI learners everywhere.
          </p>

          <!-- Legal links -->
          <ul class="${CSS.LEGAL_LINKS}" role="list">
            ${legalItems}
          </ul>

          <!-- Controls: theme toggle + back-to-top -->
          <div class="site-footer__controls">

            <!-- Theme toggle -->
            <button class="${CSS.THEME_TOGGLE}"
                    id="footer-theme-toggle"
                    type="button"
                    aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}"
                    aria-pressed="${isDark}">
              <span class="footer-theme-icon footer-theme-icon--sun" aria-hidden="true">
                ${icon('sun', 16)}
              </span>
              <span class="footer-theme-icon footer-theme-icon--moon" aria-hidden="true">
                ${icon('moon', 16)}
              </span>
              <span class="sr-only">
                ${isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              </span>
            </button>

            <!-- Back to top -->
            <button class="${CSS.BACK_TO_TOP}"
                    id="footer-back-to-top"
                    type="button"
                    aria-label="Scroll back to the top of the page">
              ${icon('arrowUp', 16)}
              <span>Top</span>
            </button>

          </div>

        </div>
      </div>
    `;
  }

  // ---- DOM reference caching -----------------------------------------------

  /**
   * Cache references to rendered interactive elements.
   * Called once after #render() to avoid repeated querySelector calls.
   */
  #cacheRefs() {
    this.#newsletterInput = this.#footer.querySelector(`.${CSS.NEWSLETTER_INPUT}`);
    this.#newsletterBtn   = this.#footer.querySelector(`.${CSS.NEWSLETTER_BTN}`);
    this.#newsletterLive  = this.#footer.querySelector(`.${CSS.NEWSLETTER_LIVE}`);
    this.#newsletterForm  = this.#footer.querySelector(`.${CSS.NEWSLETTER_FORM}`);
    this.#backToTopBtn    = this.#footer.querySelector(`.${CSS.BACK_TO_TOP}`);
    this.#themeBtn        = this.#footer.querySelector(`.${CSS.THEME_TOGGLE}`);
  }

  // ---- Event attachment ----------------------------------------------------

  /**
   * Attaches all event listeners.
   * Stored cleanup references allow complete teardown in destroy().
   */
  #attachEvents() {
    this.#attachNewsletterEvents();
    this.#attachNavEvents();
    this.#attachSocialEvents();
    this.#attachBackToTopEvents();
    this.#attachThemeEvents();
    this.#subscribeToExternalEvents();
    this.#highlightActiveLink(window.location.pathname);
  }

  // ---- Newsletter ----------------------------------------------------------

  /**
   * Attaches input validation and form submit handlers for the newsletter widget.
   */
  #attachNewsletterEvents() {
    if (!this.#newsletterForm || !this.#newsletterInput) return;

    // Live validation on blur — show error if email is malformed
    const onBlur = () => {
      const val = this.#newsletterInput.value.trim();
      if (val.length > 0 && !isValidEmail(val)) {
        this.#setNewsletterMessage(
          'Please enter a valid email address.',
          'error',
          false /* do not announce immediately on blur — wait for submit */
        );
        this.#newsletterInput.setAttribute('aria-invalid', 'true');
      } else {
        this.#clearNewsletterMessage();
        this.#newsletterInput.removeAttribute('aria-invalid');
      }
    };

    // Clear error styling when the user starts typing again
    const onInput = () => {
      if (this.#newsletterInput.getAttribute('aria-invalid') === 'true') {
        this.#clearNewsletterMessage();
        this.#newsletterInput.removeAttribute('aria-invalid');
      }
    };

    this.#newsletterInput.addEventListener('blur',  onBlur);
    this.#newsletterInput.addEventListener('input', onInput);

    this.#cleanupFns.push(() => {
      this.#newsletterInput?.removeEventListener('blur',  onBlur);
      this.#newsletterInput?.removeEventListener('input', onInput);
    });

    // Form submit
    const onSubmit = (e) => {
      e.preventDefault();
      this.#handleNewsletterSubmit();
    };

    this.#newsletterForm.addEventListener('submit', onSubmit);
    this.#cleanupFns.push(() =>
      this.#newsletterForm?.removeEventListener('submit', onSubmit)
    );
  }

  /**
   * Handles the newsletter form submission.
   *
   * State machine:
   *   idle → (validate) → loading → success | error → idle (on error, after cooldown on success)
   */
  async #handleNewsletterSubmit() {
    // Guard: already submitting or in cooldown
    if (this.#newsletterSubmitting || this.#newsletterDone) return;

    const email = this.#newsletterInput?.value.trim() ?? '';

    // Client-side validation
    if (!email) {
      this.#setNewsletterMessage('Please enter your email address.', 'error');
      this.#newsletterInput?.setAttribute('aria-invalid', 'true');
      this.#newsletterInput?.focus();
      return;
    }

    if (!isValidEmail(email)) {
      this.#setNewsletterMessage('Please enter a valid email address (e.g. you@example.com).', 'error');
      this.#newsletterInput?.setAttribute('aria-invalid', 'true');
      this.#newsletterInput?.focus();
      return;
    }

    // ── Loading state ────────────────────────────────────────────────────────
    this.#newsletterSubmitting = true;
    this.#setLoadingState(true);
    this.#clearNewsletterMessage();
    this.#newsletterInput.removeAttribute('aria-invalid');

    this.#dispatch(FOOTER_EVENTS.NEWSLETTER_SUBMITTED, { email });

    // ── Simulated network request ────────────────────────────────────────────
    // Replace this block with a real fetch() call when the backend is ready.
    // The frontend API contract: resolve → success, reject → error.
    const result = await this.#simulateSubscription(email);

    this.#setLoadingState(false);
    this.#newsletterSubmitting = false;

    if (result.ok) {
      this.#handleNewsletterSuccess(email);
    } else {
      this.#handleNewsletterError(result.message);
    }
  }

  /**
   * Simulates a subscription API call.
   * Replace the body of this method with a real fetch() in a later milestone.
   *
   * @param {string} email
   * @returns {Promise<{ok:boolean, message?:string}>}
   */
  #simulateSubscription(email) {
    const { min, max } = NEWSLETTER_CONFIG.SIM_DELAY;
    const delay = min + Math.random() * (max - min);

    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate a ~95% success rate for demo purposes
        if (Math.random() > 0.05) {
          resolve({ ok: true });
        } else {
          resolve({
            ok:      false,
            message: 'Something went wrong. Please try again in a moment.',
          });
        }
      }, delay);
    });
  }

  /**
   * Handles a successful subscription response.
   * @param {string} email
   */
  #handleNewsletterSuccess(email) {
    this.#newsletterDone = true;

    // Persist the suppression timestamp
    try {
      localStorage.setItem(
        NEWSLETTER_CONFIG.STORAGE_KEY,
        String(Date.now())
      );
    } catch {
      // Storage unavailable — swallow silently
    }

    // Update UI to success state
    const widget = this.#footer.querySelector(`.${CSS.NEWSLETTER}`);
    widget?.classList.add(CSS.NEWSLETTER_SUCCESS);

    // Replace the form with a confirmation message
    if (this.#newsletterForm) {
      this.#newsletterForm.setAttribute('aria-hidden', 'true');
      this.#newsletterForm.hidden = true;
    }

    this.#setNewsletterMessage(
      `🎉 You're subscribed! We'll send new Python for AI content to ${email}.`,
      'success'
    );

    this.#dispatch(FOOTER_EVENTS.NEWSLETTER_SUCCESS, { email });

    // Cooldown: re-enable after COOLDOWN_MS (in case the user wants to subscribe another address)
    this.#cooldownTimer = setTimeout(() => {
      this.#newsletterDone = false;
      this.#cooldownTimer  = null;
    }, NEWSLETTER_CONFIG.COOLDOWN_MS);
  }

  /**
   * Handles an error response from the subscription attempt.
   * @param {string} [message]
   */
  #handleNewsletterError(message) {
    const widget = this.#footer.querySelector(`.${CSS.NEWSLETTER}`);
    widget?.classList.add(CSS.NEWSLETTER_ERROR);

    // Brief error class that auto-removes so the user can retry
    setTimeout(() => widget?.classList.remove(CSS.NEWSLETTER_ERROR), 4000);

    this.#setNewsletterMessage(
      message ?? 'Something went wrong. Please try again.',
      'error'
    );

    // Return focus to the input so the user can correct and retry
    this.#newsletterInput?.focus();

    this.#dispatch(FOOTER_EVENTS.NEWSLETTER_ERROR, { message });
  }

  /**
   * Toggles the newsletter button loading indicator.
   * @param {boolean} isLoading
   */
  #setLoadingState(isLoading) {
    if (!this.#newsletterBtn) return;

    const idleSpan    = this.#newsletterBtn.querySelector('.newsletter-btn__idle');
    const loadingSpan = this.#newsletterBtn.querySelector('.newsletter-btn__loading');

    this.#newsletterBtn.disabled = isLoading;
    this.#newsletterBtn.setAttribute('aria-busy', String(isLoading));

    if (idleSpan)    idleSpan.setAttribute('aria-hidden',    String(isLoading));
    if (loadingSpan) loadingSpan.setAttribute('aria-hidden', String(!isLoading));

    const widget = this.#footer.querySelector(`.${CSS.NEWSLETTER}`);
    widget?.classList.toggle(CSS.NEWSLETTER_LOADING, isLoading);
  }

  /**
   * Set the ARIA live region message and optionally apply a visual modifier class.
   *
   * @param {string}            message
   * @param {'success'|'error'|'info'} type
   * @param {boolean}           [announce=true] — whether to update the live region
   */
  #setNewsletterMessage(message, type, announce = true) {
    if (!this.#newsletterLive) return;

    // Clear first so re-announcements of the same string still trigger AT
    this.#newsletterLive.textContent = '';
    this.#newsletterLive.className   = CSS.NEWSLETTER_LIVE;
    this.#newsletterLive.classList.add(`${CSS.NEWSLETTER_LIVE}--${type}`);

    if (announce) {
      requestAnimationFrame(() => {
        if (this.#newsletterLive) {
          this.#newsletterLive.textContent = message;
        }
      });
    }
  }

  /** Clear the ARIA live region and its modifier classes. */
  #clearNewsletterMessage() {
    if (!this.#newsletterLive) return;
    this.#newsletterLive.textContent = '';
    this.#newsletterLive.className   = CSS.NEWSLETTER_LIVE;
  }

  /**
   * Check whether the newsletter form should be suppressed because the user
   * already subscribed within the suppression window.
   * Runs after the DOM is rendered so the form elements already exist.
   */
  #checkNewsletterSuppression() {
    try {
      const stored = localStorage.getItem(NEWSLETTER_CONFIG.STORAGE_KEY);
      if (!stored) return;

      const subscribedAt = Number(stored);
      if (!Number.isFinite(subscribedAt)) return;

      const age = Date.now() - subscribedAt;

      if (age < NEWSLETTER_CONFIG.SUPPRESS_DURATION) {
        // Already subscribed recently — show confirmation instead of the form
        this.#newsletterDone = true;

        if (this.#newsletterForm) {
          this.#newsletterForm.setAttribute('aria-hidden', 'true');
          this.#newsletterForm.hidden = true;
        }

        this.#setNewsletterMessage(
          '✓ You\'re already subscribed. Thank you for being part of the Python for AI community!',
          'success'
        );

        const widget = this.#footer.querySelector(`.${CSS.NEWSLETTER}`);
        widget?.classList.add(CSS.NEWSLETTER_SUCCESS);
      }
    } catch {
      // localStorage unavailable — show form as normal
    }
  }

  // ---- Footer navigation link events ---------------------------------------

  /**
   * Attaches a single delegated click listener to the nav columns region.
   * Dispatches FOOTER_EVENTS.NAV_CLICKED for analytics / router integration.
   */
  #attachNavEvents() {
    const columns = this.#footer.querySelector(`.${CSS.COLUMNS}`);
    if (!columns) return;

    const onClick = (e) => {
      const link = e.target.closest(`.${CSS.COLUMN_LINK}`);
      if (!link) return;

      // Determine which column this link belongs to
      const column = link.closest(`.${CSS.COLUMN}`);
      const heading = column?.querySelector(`.${CSS.COLUMN_HEADING}`)?.textContent?.trim() ?? '';

      this.#dispatch(FOOTER_EVENTS.NAV_CLICKED, {
        column: heading,
        label:  link.textContent?.trim() ?? '',
        href:   link.getAttribute('href') ?? '',
      });
    };

    columns.addEventListener('click', onClick);
    this.#cleanupFns.push(() => columns.removeEventListener('click', onClick));
  }

  // ---- Social link events --------------------------------------------------

  /**
   * Attaches a delegated click listener to the social links list.
   * Dispatches FOOTER_EVENTS.SOCIAL_CLICKED.
   */
  #attachSocialEvents() {
    const socialList = this.#footer.querySelector(`.${CSS.SOCIAL_LIST}`);
    if (!socialList) return;

    const onClick = (e) => {
      const link = e.target.closest(`.${CSS.SOCIAL_LINK}`);
      if (!link) return;

      this.#dispatch(FOOTER_EVENTS.SOCIAL_CLICKED, {
        platform: link.dataset.socialId ?? '',
        href:     link.getAttribute('href') ?? '',
      });
    };

    socialList.addEventListener('click', onClick);
    this.#cleanupFns.push(() => socialList.removeEventListener('click', onClick));
  }

  // ---- Back-to-top ---------------------------------------------------------

  /**
   * Attaches the back-to-top button handler.
   * Smooth-scrolls to the top of the page, then moves keyboard focus to the
   * skip link (or the <h1> if no skip link exists) so keyboard users do not
   * lose their place after the scroll completes.
   */
  #attachBackToTopEvents() {
    if (!this.#backToTopBtn) return;

    const onClick = () => {
      this.#dispatch(FOOTER_EVENTS.BACK_TO_TOP);

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Move focus to the top of the page content after scroll finishes.
      // We use a one-shot 'scrollend' listener (with a setTimeout fallback for
      // browsers that do not yet support it) to ensure focus moves after
      // the scroll animation rather than immediately.
      const moveFocus = () => {
        const focusTarget =
          document.querySelector('.skip-link') ??
          document.querySelector('#main-content') ??
          document.querySelector('main h1') ??
          document.querySelector('main');

        if (focusTarget) {
          // Make temporarily focusable if not natively focusable
          const hadTabindex = focusTarget.hasAttribute('tabindex');
          if (!hadTabindex) focusTarget.setAttribute('tabindex', '-1');

          focusTarget.focus({ preventScroll: true });

          if (!hadTabindex) {
            // Remove the synthetic tabindex so Tab order is not disrupted
            focusTarget.addEventListener(
              'blur',
              () => focusTarget.removeAttribute('tabindex'),
              { once: true }
            );
          }
        }
      };

      if ('onscrollend' in window) {
        window.addEventListener('scrollend', moveFocus, { once: true });
      } else {
        // Fallback: wait a generous 600ms for scroll to complete
        setTimeout(moveFocus, 600);
      }
    };

    this.#backToTopBtn.addEventListener('click', onClick);
    this.#cleanupFns.push(() =>
      this.#backToTopBtn?.removeEventListener('click', onClick)
    );
  }

  // ---- Theme toggle --------------------------------------------------------

  /**
   * Attaches the footer theme toggle button.
   * The footer does not own theme state — it dispatches FOOTER_EVENTS.THEME_TOGGLE
   * and the navigation.js ThemeManager handles the actual switch.
   * The footer button syncs its label/state via the nav:theme:changed event.
   */
  #attachThemeEvents() {
    if (!this.#themeBtn) return;

    const onClick = () => {
      this.#dispatch(FOOTER_EVENTS.THEME_TOGGLE);

      // Optimistically toggle the button appearance while waiting for
      // nav:theme:changed to fire from navigation.js
      const currentTheme = document.documentElement.getAttribute('data-theme') ?? 'light';
      const nextTheme    = currentTheme === 'dark' ? 'light' : 'dark';
      this.#applyThemeButtonState(nextTheme);
    };

    this.#themeBtn.addEventListener('click', onClick);
    this.#cleanupFns.push(() =>
      this.#themeBtn?.removeEventListener('click', onClick)
    );
  }

  /**
   * Subscribe to external events emitted by other components.
   */
  #subscribeToExternalEvents() {
    // Sync theme button when navigation.js toggles the theme
    const onThemeChange = (e) => {
      const theme = e.detail?.theme ?? document.documentElement.getAttribute('data-theme') ?? 'light';
      this.#applyThemeButtonState(theme);
    };

    document.addEventListener('nav:theme:changed', onThemeChange);
    this.#cleanupFns.push(() =>
      document.removeEventListener('nav:theme:changed', onThemeChange)
    );

    // Update active link on SPA navigation
    const onRouterNav = (e) => {
      const path = e.detail?.pathname ?? window.location.pathname;
      this.#highlightActiveLink(path);
    };

    document.addEventListener('router:navigated', onRouterNav);
    this.#cleanupFns.push(() =>
      document.removeEventListener('router:navigated', onRouterNav)
    );
  }

  // ---- Theme button state --------------------------------------------------

  /**
   * Apply the correct label and aria-pressed state to the footer theme button.
   * @param {'light'|'dark'} theme
   */
  #applyThemeButtonState(theme) {
    if (!this.#themeBtn) return;

    const isDark  = theme === 'dark';
    const label   = isDark ? 'Switch to light mode' : 'Switch to dark mode';

    this.#themeBtn.setAttribute('aria-label',   label);
    this.#themeBtn.setAttribute('aria-pressed', String(isDark));

    // Update the sr-only text span
    const srSpan = this.#themeBtn.querySelector('.sr-only');
    if (srSpan) srSpan.textContent = label;
  }

  /**
   * Read the current data-theme attribute and sync the button on init.
   */
  #syncThemeButton() {
    const theme = document.documentElement.getAttribute('data-theme') ?? 'light';
    this.#applyThemeButtonState(theme);
  }

  // ---- Active link management ----------------------------------------------

  /**
   * Marks the footer nav link that best matches the current pathname as active.
   * Uses the same normalisation and prefix-matching logic as navigation.js
   * so both navbars are always consistent.
   *
   * @param {string} pathname
   */
  #highlightActiveLink(pathname) {
    const links = this.#footer.querySelectorAll(`.${CSS.COLUMN_LINK}`);
    if (links.length === 0) return;

    const normCurrent = pathname.length > 1
      ? pathname.replace(/\/$/, '').replace(/\.html$/, '')
      : pathname;

    links.forEach((link) => {
      const href     = link.getAttribute('data-footer-href') ?? link.getAttribute('href') ?? '';
      const normHref = href.length > 1
        ? href.replace(/\/$/, '').replace(/\.html$/, '').split('#')[0]
        : href;

      // Skip hash-only links (they all live on the same page)
      if (normHref.startsWith('#') || normHref === '') {
        link.classList.remove(CSS.COLUMN_LINK_ACTIVE);
        return;
      }

      const isExact  = normHref === normCurrent;
      const isPrefix = normHref !== '/' && normCurrent.startsWith(normHref + '/');
      const isActive = isExact || isPrefix;

      link.classList.toggle(CSS.COLUMN_LINK_ACTIVE, isActive);
      if (isActive) {
        link.setAttribute('aria-current', isExact ? 'page' : 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  // ---- Event bus -----------------------------------------------------------

  /**
   * Publish an event to the project event bus + dispatch a native CustomEvent.
   * Consistent with navigation.js and header.js.
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

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default Footer;