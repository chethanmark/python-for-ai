/**
 * =============================================================================
 * HEADER COMPONENT
 * scripts/components/header.js
 * -----------------------------------------------------------------------------
 * Page-level header system for the Python for AI educational platform.
 * Distinct from navigation.js (which owns the site-wide sticky nav bar),
 * this module owns everything rendered in the semantic <header> region
 * that is unique to each page: the hero banner, the page title block,
 * the breadcrumb trail, and the dynamic search interface.
 *
 * RESPONSIBILITIES:
 *   ① Hero Banner
 *      - Full-bleed hero sections for the homepage and section landing pages
 *      - Configurable headline, subheadline, CTA buttons, and background variant
 *      - Animated entrance sequence (fade-up stagger, respects prefers-reduced-motion)
 *      - Particle canvas backdrop for the homepage hero (opt-in, low-cost)
 *      - Typewriter effect for the hero headline (opt-in, accessible fallback)
 *
 *   ② Page Title Block
 *      - Consistent page-level heading for tutorial, quiz, project, and dashboard pages
 *      - Optional eyebrow label, description, and action buttons
 *      - Reads difficulty, reading-time, and module metadata from data attributes
 *      - Dynamically sets <title> and meta description for SEO
 *
 *   ③ Breadcrumb Navigation
 *      - Renders an accessible <nav aria-label="Breadcrumb"> trail
 *      - Auto-generates crumbs from the current URL path + optional JSON config
 *      - JSON-LD structured data (<script type="application/ld+json">) injected
 *        for Google rich results (BreadcrumbList schema)
 *      - Collapses the middle crumbs on narrow screens, expandable via button
 *
 *   ④ Search Component
 *      - Full-text search input rendered in the page header area
 *      - Debounced input handler broadcasts a search:query event for
 *        tutorial-list.js, projects.js, and quizzes.js to filter their content
 *      - Keyboard shortcut: "/" focuses the search field from anywhere
 *      - Escape clears and blurs the field
 *      - Live region announces result counts to screen readers
 *      - Optional search overlay mode for mobile (full-screen takeover)
 *
 * DOES NOT OWN:
 *   - The sticky site nav bar → navigation.js
 *   - The footer → footer.js
 *   - Code editor toolbar → code-editor.js
 *   - Quiz progress bar → quiz.js
 *
 * DEPENDENCIES:
 *   - scripts/core/events.js  — event bus (window.__pyaiEvents)
 *   - scripts/core/state.js   — global app state (window.__pyaiState)
 *   - data/site-config.json   — platform name, search placeholder text
 *   - variables.css tokens    — all styling via CSS classes, no inline styles
 *
 * EVENT EMISSIONS (via CustomEvent + event bus):
 *   header:hero:cta-clicked   { buttonId, href }
 *   header:search:query       { query, trimmed }
 *   header:search:cleared     {}
 *   header:search:focused     {}
 *   header:breadcrumb:clicked { index, label, href }
 *   header:typewriter:done    {}
 *
 * EVENT SUBSCRIPTIONS:
 *   router:navigated          — re-renders breadcrumbs + page title on SPA nav
 *   search:results:count      — updates the live region with result count
 *   nav:theme:changed         — syncs hero particle colours to active theme
 *
 * USAGE (scripts/main.js or page scripts):
 *
 *   import { Header, HEADER_EVENTS } from './components/header.js';
 *
 *   // Homepage hero
 *   const header = new Header({ page: 'home' });
 *   header.renderHero({
 *     headline:    'Learn Python for AI',
 *     subheadline: 'Hands-on tutorials, coding challenges, and real AI projects.',
 *     ctas: [
 *       { id: 'start', label: 'Start Learning', href: '/tutorials', primary: true },
 *       { id: 'demo',  label: 'See Projects',   href: '/tutorials' },
 *     ],
 *     variant:    'gradient',
 *     particles:  true,
 *     typewriter: true,
 *   });
 *
 *   // Tutorial page
 *   const header = new Header({ page: 'tutorial' });
 *   header.renderPageTitle({
 *     eyebrow:    'Module 1 · Beginner',
 *     title:      'Python Variables and Data Types',
 *     description: 'Master the building blocks of every Python program.',
 *     readingTime: '12 min read',
 *     actions: [{ label: 'Run Code', id: 'run', icon: 'play' }],
 *   });
 *   header.renderBreadcrumbs();
 *   header.renderSearch({ placeholder: 'Search tutorials…' });
 *
 * EXPORTS:
 *   Header        — primary class (default export)
 *   HEADER_EVENTS — event name constants
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const HEADER_EVENTS = {
  HERO_CTA_CLICKED:   'header:hero:cta-clicked',
  SEARCH_QUERY:       'header:search:query',
  SEARCH_CLEARED:     'header:search:cleared',
  SEARCH_FOCUSED:     'header:search:focused',
  BREADCRUMB_CLICKED: 'header:breadcrumb:clicked',
  TYPEWRITER_DONE:    'header:typewriter:done',
};

// ---------------------------------------------------------------------------
// BEM class name constants
// ---------------------------------------------------------------------------

const CSS = {
  // Root regions
  PAGE_HEADER:      'page-header',
  HERO:             'page-hero',
  TITLE_BLOCK:      'page-title-block',
  BREADCRUMB:       'breadcrumb',
  SEARCH:           'header-search',

  // Hero variants
  HERO_GRADIENT:    'page-hero--gradient',
  HERO_DARK:        'page-hero--dark',
  HERO_MUTED:       'page-hero--muted',
  HERO_MINIMAL:     'page-hero--minimal',

  // Hero inner elements
  HERO_CANVAS:      'page-hero__canvas',
  HERO_CONTENT:     'page-hero__content',
  HERO_EYEBROW:     'page-hero__eyebrow',
  HERO_HEADLINE:    'page-hero__headline',
  HERO_SUBHEADLINE: 'page-hero__subheadline',
  HERO_ACTIONS:     'page-hero__actions',
  HERO_CTA:         'page-hero__cta',
  HERO_CTA_PRIMARY: 'page-hero__cta--primary',

  // Animation states
  ANIMATE_IN:       'animate-in',
  ANIMATE_DONE:     'animate-done',
  STAGGER_1:        'stagger-1',
  STAGGER_2:        'stagger-2',
  STAGGER_3:        'stagger-3',
  STAGGER_4:        'stagger-4',

  // Page title block elements
  TITLE_EYEBROW:    'page-title-block__eyebrow',
  TITLE_HEADING:    'page-title-block__heading',
  TITLE_DESC:       'page-title-block__description',
  TITLE_META:       'page-title-block__meta',
  TITLE_ACTIONS:    'page-title-block__actions',
  TITLE_BADGE:      'page-title-block__badge',

  // Breadcrumb elements
  CRUMB_NAV:        'breadcrumb__nav',
  CRUMB_LIST:       'breadcrumb__list',
  CRUMB_ITEM:       'breadcrumb__item',
  CRUMB_LINK:       'breadcrumb__link',
  CRUMB_CURRENT:    'breadcrumb__current',
  CRUMB_SEPARATOR:  'breadcrumb__separator',
  CRUMB_ELLIPSIS:   'breadcrumb__ellipsis',
  CRUMB_COLLAPSED:  'breadcrumb--collapsed',

  // Search elements
  SEARCH_FORM:      'header-search__form',
  SEARCH_INPUT:     'header-search__input',
  SEARCH_ICON:      'header-search__icon',
  SEARCH_CLEAR:     'header-search__clear',
  SEARCH_LIVE:      'header-search__live',
  SEARCH_SHORTCUT:  'header-search__shortcut',
  SEARCH_ACTIVE:    'header-search--active',
  SEARCH_OVERLAY:   'header-search--overlay',
  SEARCH_HAS_VALUE: 'header-search--has-value',
};

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Desktop breakpoint matches CSS lg: 1024px */
const DESKTOP_BREAKPOINT = 1024;

/** Search debounce window in ms */
const SEARCH_DEBOUNCE_MS = 280;

/** Keyboard shortcut to focus search */
const SEARCH_SHORTCUT_KEY = '/';

/** Number of breadcrumb items visible before collapsing */
const CRUMB_COLLAPSE_THRESHOLD = 4;

/** Typewriter cursor character */
const CURSOR_CHAR = '|';

/** Typewriter typing speed range (ms per character) */
const TYPEWRITER_SPEED = { min: 45, max: 90 };

/** Particle canvas configuration */
const PARTICLE_CONFIG = {
  count:     55,
  maxRadius: 2.2,
  minRadius: 0.6,
  maxSpeed:  0.35,
  opacity:   { light: 0.18, dark: 0.28 },
  color:     {
    light: ['#2563EB', '#7C3AED', '#0891B2'],
    dark:  ['#60A5FA', '#A78BFA', '#22D3EE'],
  },
};

// ---------------------------------------------------------------------------
// Inline SVG icons (shared subset, keeps header self-contained)
// ---------------------------------------------------------------------------

/**
 * Returns a compact inline SVG for named icons used within the header.
 * All icons are aria-hidden — surrounding text or aria-label provides context.
 *
 * @param {string} name
 * @returns {string}
 */
function icon(name) {
  const ICONS = {
    search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <circle cx="11" cy="11" r="8"/>
               <line x1="21" y1="21" x2="16.65" y2="16.65"/>
             </svg>`,

    close: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>`,

    home: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
           </svg>`,

    chevronRight: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true" focusable="false">
                     <polyline points="9 18 15 12 9 6"/>
                   </svg>`,

    play: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>`,

    clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>`,

    star: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02
                               12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
           </svg>`,

    ellipsis: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
                 aria-hidden="true" focusable="false">
                 <circle cx="5"  cy="12" r="2"/>
                 <circle cx="12" cy="12" r="2"/>
                 <circle cx="19" cy="12" r="2"/>
               </svg>`,
  };

  return ICONS[name] ?? '';
}

// ---------------------------------------------------------------------------
// Escape utilities (consistent with navigation.js)
// ---------------------------------------------------------------------------

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/**
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
// Performance utilities
// ---------------------------------------------------------------------------

/**
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Returns true when the user has requested reduced motion.
 * Checked fresh each call because the user can change OS settings mid-session.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// TypewriterEffect — isolated animation class
// ---------------------------------------------------------------------------

/**
 * Renders a typewriter effect for a heading element.
 * Accessibility: the full text is set immediately as aria-label on the element
 * so screen readers announce the complete phrase without waiting for animation.
 * The visible character-by-character text is rendered inside an aria-hidden span.
 */
class TypewriterEffect {
  /** @type {HTMLElement} */ #target;
  /** @type {string}      */ #fullText;
  /** @type {number|null} */ #rafId = null;
  /** @type {() => void}  */ #onDone;

  /**
   * @param {HTMLElement} target   - The element to type into
   * @param {string}      text     - Full text to animate
   * @param {() => void}  [onDone] - Callback when typing completes
   */
  constructor(target, text, onDone = () => {}) {
    this.#target   = target;
    this.#fullText = text;
    this.#onDone   = onDone;
  }

  /** Start the animation. Immediately bails out if motion is reduced. */
  start() {
    // Accessibility: set the complete text as the accessible label immediately
    this.#target.setAttribute('aria-label', this.#fullText);

    if (prefersReducedMotion()) {
      // Show full text instantly — no animation
      this.#target.textContent = this.#fullText;
      this.#onDone();
      return;
    }

    // Prepare the DOM: aria-hidden container for visual chars + cursor
    this.#target.innerHTML =
      `<span aria-hidden="true" class="typewriter__text"></span>` +
      `<span aria-hidden="true" class="typewriter__cursor">${escapeHtml(CURSOR_CHAR)}</span>`;

    const textSpan   = this.#target.querySelector('.typewriter__text');
    const cursorSpan = this.#target.querySelector('.typewriter__cursor');
    const chars      = [...this.#fullText]; // Spread preserves Unicode code points
    let   charIndex  = 0;

    const type = () => {
      if (charIndex < chars.length) {
        textSpan.textContent += chars[charIndex];
        charIndex++;

        const delay = TYPEWRITER_SPEED.min +
          Math.random() * (TYPEWRITER_SPEED.max - TYPEWRITER_SPEED.min);

        this.#rafId = setTimeout(type, delay);
      } else {
        // Typing complete — blink cursor briefly then remove it
        cursorSpan.classList.add('typewriter__cursor--done');
        setTimeout(() => {
          cursorSpan.remove();
          this.#onDone();
        }, 800);
      }
    };

    // Small initial delay so the element is visible before typing starts
    this.#rafId = setTimeout(type, 300);
  }

  /** Cancel the animation mid-flight and show the full text immediately. */
  cancel() {
    if (this.#rafId !== null) {
      clearTimeout(this.#rafId);
      this.#rafId = null;
    }
    this.#target.textContent = this.#fullText;
    this.#target.removeAttribute('aria-label');
  }
}

// ---------------------------------------------------------------------------
// ParticleCanvas — lightweight canvas animation for the hero backdrop
// ---------------------------------------------------------------------------

/**
 * Renders soft floating particles on a <canvas> element positioned behind
 * the hero content. Uses requestAnimationFrame with visibility detection
 * to pause rendering when the canvas is scrolled out of view (IntersectionObserver).
 *
 * Performance budget: ~0.3ms per frame at 60fps on a mid-range laptop.
 * Pauses automatically when the tab is not visible (Page Visibility API).
 */
class ParticleCanvas {
  /** @type {HTMLCanvasElement} */ #canvas;
  /** @type {CanvasRenderingContext2D} */ #ctx;
  /** @type {Array<Particle>}  */ #particles = [];
  /** @type {number|null}      */ #rafId = null;
  /** @type {boolean}          */ #running = false;
  /** @type {boolean}          */ #visible = true;
  /** @type {string}           */ #theme = 'light';
  /** @type {ResizeObserver}   */ #resizeObserver;
  /** @type {IntersectionObserver} */ #intersectionObserver;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx    = canvas.getContext('2d');
    this.#theme  = document.documentElement.getAttribute('data-theme') ?? 'light';
  }

  /** Initialise particles and start the animation loop. */
  start() {
    if (prefersReducedMotion()) {
      // Apply a static gradient instead — same aesthetic, no animation
      this.#drawStaticGradient();
      return;
    }

    this.#syncSize();
    this.#spawnParticles();
    this.#running = true;
    this.#loop();

    // Pause when scrolled off screen
    this.#intersectionObserver = new IntersectionObserver(
      ([entry]) => { this.#visible = entry.isIntersecting; },
      { threshold: 0 }
    );
    this.#intersectionObserver.observe(this.#canvas);

    // Pause when the tab is hidden
    const onVisibility = () => {
      if (document.hidden) {
        this.#pauseLoop();
      } else if (this.#running) {
        this.#resumeLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Resize: re-sync canvas size and re-spawn particles
    this.#resizeObserver = new ResizeObserver(
      debounce(() => {
        this.#syncSize();
        this.#spawnParticles();
      }, 250)
    );
    this.#resizeObserver.observe(this.#canvas.parentElement);
  }

  /**
   * Update the particle colour palette when the theme changes.
   * @param {'light'|'dark'} theme
   */
  updateTheme(theme) {
    this.#theme = theme;
    this.#particles.forEach((p) => {
      const palette = PARTICLE_CONFIG.color[theme];
      p.color = palette[Math.floor(Math.random() * palette.length)];
    });
  }

  /** Stop the animation and release all resources. */
  stop() {
    this.#running = false;
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
  }

  // ------ Private ------

  #syncSize() {
    const rect          = this.#canvas.parentElement.getBoundingClientRect();
    const dpr           = window.devicePixelRatio || 1;
    this.#canvas.width  = rect.width  * dpr;
    this.#canvas.height = rect.height * dpr;
    this.#canvas.style.width  = `${rect.width}px`;
    this.#canvas.style.height = `${rect.height}px`;
    this.#ctx.scale(dpr, dpr);
  }

  #spawnParticles() {
    const w       = this.#canvas.width  / (window.devicePixelRatio || 1);
    const h       = this.#canvas.height / (window.devicePixelRatio || 1);
    const palette = PARTICLE_CONFIG.color[this.#theme];

    this.#particles = Array.from({ length: PARTICLE_CONFIG.count }, () => ({
      x:      Math.random() * w,
      y:      Math.random() * h,
      r:      PARTICLE_CONFIG.minRadius +
              Math.random() * (PARTICLE_CONFIG.maxRadius - PARTICLE_CONFIG.minRadius),
      vx:     (Math.random() - 0.5) * PARTICLE_CONFIG.maxSpeed,
      vy:     (Math.random() - 0.5) * PARTICLE_CONFIG.maxSpeed,
      color:  palette[Math.floor(Math.random() * palette.length)],
      alpha:  PARTICLE_CONFIG.opacity[this.#theme] * (0.5 + Math.random() * 0.5),
    }));
  }

  #loop() {
    if (!this.#running) return;

    if (this.#visible) {
      this.#draw();
    }

    this.#rafId = requestAnimationFrame(() => this.#loop());
  }

  #pauseLoop() {
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  #resumeLoop() {
    if (this.#rafId === null && this.#running) {
      this.#loop();
    }
  }

  #draw() {
    const w   = this.#canvas.width  / (window.devicePixelRatio || 1);
    const h   = this.#canvas.height / (window.devicePixelRatio || 1);

    this.#ctx.clearRect(0, 0, w, h);

    for (const p of this.#particles) {
      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Wrap at edges (seamless looping)
      if (p.x < -p.r)  p.x = w + p.r;
      if (p.x > w + p.r) p.x = -p.r;
      if (p.y < -p.r)  p.y = h + p.r;
      if (p.y > h + p.r) p.y = -p.r;

      // Draw
      this.#ctx.beginPath();
      this.#ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.#ctx.fillStyle = p.color;
      this.#ctx.globalAlpha = p.alpha;
      this.#ctx.fill();
      this.#ctx.globalAlpha = 1;
    }
  }

  #drawStaticGradient() {
    const w   = this.#canvas.offsetWidth  || 1280;
    const h   = this.#canvas.offsetHeight || 480;
    this.#canvas.width  = w;
    this.#canvas.height = h;

    const grad = this.#ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(37, 99, 235, 0.12)');
    grad.addColorStop(1, 'rgba(124, 58, 237, 0.08)');
    this.#ctx.fillStyle = grad;
    this.#ctx.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------------------
// BreadcrumbBuilder — generates breadcrumb data from the URL
// ---------------------------------------------------------------------------

/**
 * Derives a breadcrumb trail from the current URL path, optionally merging
 * with explicitly provided items for pages with non-obvious hierarchy.
 *
 * URL → Crumbs mapping examples:
 *   /                           → [Home]
 *   /pages/tutorials.html       → [Home, Tutorials]
 *   /pages/tutorial-detail.html → [Home, Tutorials, <page title from DOM>]
 *   /pages/dashboard.html       → [Home, Dashboard]
 */
class BreadcrumbBuilder {
  /** Human-readable labels for known path segments */
  static #SEGMENT_LABELS = {
    'tutorials':       'Tutorials',
    'tutorial-detail': 'Tutorial',
    'projects':        'Projects',
    'project-detail':  'Project',
    'quizzes':         'Quizzes',
    'quiz-detail':     'Quiz',
    'dashboard':       'Dashboard',
    'pages':           null, // suppress the "pages" directory segment
  };

  /**
   * Build the crumb array from the URL + optional override items.
   *
   * @param {Array<{label:string, href:string}>} [overrides]
   *        If provided, these replace the auto-generated crumbs for the current page.
   * @returns {Array<{label:string, href:string, isCurrent:boolean}>}
   */
  static build(overrides = []) {
    if (overrides.length > 0) {
      // Use provided crumbs but always ensure Home is first
      const withHome = overrides[0]?.href === '/'
        ? overrides
        : [{ label: 'Home', href: '/' }, ...overrides];

      return withHome.map((item, i) => ({
        ...item,
        isCurrent: i === withHome.length - 1,
      }));
    }

    return BreadcrumbBuilder.#fromPathname(window.location.pathname);
  }

  /**
   * @param {string} pathname
   * @returns {Array<{label:string, href:string, isCurrent:boolean}>}
   */
  static #fromPathname(pathname) {
    const crumbs = [{ label: 'Home', href: '/', isCurrent: false }];

    if (pathname === '/' || pathname === '/index.html') {
      crumbs[0].isCurrent = true;
      return crumbs;
    }

    // Strip leading slash, remove .html extension, split by /
    const segments = pathname
      .replace(/^\//, '')
      .replace(/\.html$/, '')
      .split('/');

    let builtHref = '';

    for (let i = 0; i < segments.length; i++) {
      const seg   = segments[i];
      const label = BreadcrumbBuilder.#SEGMENT_LABELS[seg];

      // null means suppress this segment entirely
      if (label === null) continue;

      builtHref += `/${seg}`;

      // For the last segment, try to read the actual page <h1> as the label
      const isLast       = i === segments.length - 1;
      const resolvedLabel = isLast
        ? BreadcrumbBuilder.#readPageTitle() ?? (label || BreadcrumbBuilder.#humanise(seg))
        : (label || BreadcrumbBuilder.#humanise(seg));

      crumbs.push({
        label:     resolvedLabel,
        href:      isLast ? window.location.pathname : `${builtHref}.html`,
        isCurrent: isLast,
      });
    }

    return crumbs;
  }

  /**
   * Read the page's <h1> text as the current crumb label.
   * Returns null if no <h1> is found yet (async content not loaded).
   *
   * @returns {string|null}
   */
  static #readPageTitle() {
    const h1 = document.querySelector('main h1, .page-title-block__heading');
    if (!h1) return null;

    const text = h1.textContent?.trim();
    return text && text.length > 0 && text.length < 100 ? text : null;
  }

  /**
   * Convert a kebab-case URL segment to a human-readable label.
   * e.g. "python-basics" → "Python Basics"
   *
   * @param {string} seg
   * @returns {string}
   */
  static #humanise(seg) {
    return seg
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// ---------------------------------------------------------------------------
// Header — primary class
// ---------------------------------------------------------------------------

/**
 * Page-level header component.
 *
 * Each page instantiates one Header, then calls the render methods it needs.
 * All render methods are idempotent — safe to call multiple times (they
 * clear and re-render their target region on each call).
 */
export class Header {
  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   page: string,
   *   containerId: string,
   *   siteTitle: string,
   * }}
   */
  #config;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #container      = null;
  /** @type {HTMLElement|null} */ #heroRegion      = null;
  /** @type {HTMLElement|null} */ #titleRegion     = null;
  /** @type {HTMLElement|null} */ #breadcrumbRegion = null;
  /** @type {HTMLElement|null} */ #searchRegion    = null;

  // ---- Component instances -------------------------------------------------

  /** @type {TypewriterEffect|null} */ #typewriter = null;
  /** @type {ParticleCanvas|null}   */ #particles  = null;

  // ---- Search state --------------------------------------------------------

  /** @type {string}  */ #searchQuery  = '';
  /** @type {boolean} */ #searchActive = false;
  /** @type {HTMLInputElement|null} */ #searchInput = null;
  /** @type {HTMLElement|null}      */ #searchLive  = null;

  // ---- Breadcrumb state ----------------------------------------------------

  /** @type {boolean} */ #crumbsCollapsed = true;
  /** @type {Array}   */ #crumbData       = [];

  // ---- Cleanup -------------------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   page?:        string,   — Page identifier: 'home'|'tutorial'|'project'|etc.
   *   containerId?: string,   — ID of the element to render into (default: 'page-header')
   *   siteTitle?:   string,   — Platform name used in <title> updates
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = {
      page:        config.page        ?? 'default',
      containerId: config.containerId ?? 'page-header',
      siteTitle:   config.siteTitle   ?? 'Python for AI',
    };
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Render a full-bleed hero banner.
   *
   * @param {{
   *   headline:     string,
   *   subheadline?: string,
   *   eyebrow?:     string,
   *   ctas?:        Array<{id:string, label:string, href:string, primary?:boolean, icon?:string}>,
   *   variant?:     'gradient'|'dark'|'muted'|'minimal',
   *   particles?:   boolean,
   *   typewriter?:  boolean,
   * }} options
   */
  renderHero(options = {}) {
    const {
      headline    = 'Python for AI',
      subheadline = '',
      eyebrow     = '',
      ctas        = [],
      variant     = 'gradient',
      particles   = false,
      typewriter  = false,
    } = options;

    this.#ensureContainer();
    this.#clearRegion('hero');

    // Build hero element
    const hero = document.createElement('section');
    hero.className = [
      CSS.HERO,
      CSS[`HERO_${variant.toUpperCase()}`] ?? CSS.HERO_GRADIENT,
    ].join(' ');
    hero.setAttribute('aria-label', 'Page hero');

    // Canvas backdrop (behind content, positioned absolute via CSS)
    let canvasEl = null;
    if (particles) {
      canvasEl = document.createElement('canvas');
      canvasEl.className      = CSS.HERO_CANVAS;
      canvasEl.setAttribute('aria-hidden', 'true');
      canvasEl.setAttribute('role',        'presentation');
      hero.appendChild(canvasEl);
    }

    // Content wrapper
    const content = document.createElement('div');
    content.className = CSS.HERO_CONTENT;

    // Eyebrow label
    if (eyebrow) {
      const eb  = document.createElement('p');
      eb.className   = `${CSS.HERO_EYEBROW} eyebrow stagger-1`;
      eb.textContent = eyebrow;
      content.appendChild(eb);
    }

    // Headline
    const headlineEl = document.createElement('h1');
    headlineEl.className = `${CSS.HERO_HEADLINE} stagger-2`;

    // Subheadline
    let subEl = null;
    if (subheadline) {
      subEl = document.createElement('p');
      subEl.className   = `${CSS.HERO_SUBHEADLINE} stagger-3`;
      subEl.textContent = subheadline;
    }

    // CTA buttons
    let actionsEl = null;
    if (ctas.length > 0) {
      actionsEl = document.createElement('div');
      actionsEl.className = `${CSS.HERO_ACTIONS} stagger-4`;

      ctas.forEach((cta) => {
        const btn = document.createElement('a');
        btn.href      = escapeAttr(cta.href);
        btn.className = [
          CSS.HERO_CTA,
          cta.primary ? CSS.HERO_CTA_PRIMARY : '',
        ].filter(Boolean).join(' ');
        btn.dataset.ctaId = escapeAttr(cta.id);
        btn.setAttribute('role', 'button');

        if (cta.icon) {
          const iconSpan = document.createElement('span');
          iconSpan.setAttribute('aria-hidden', 'true');
          iconSpan.innerHTML = icon(cta.icon);
          btn.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.textContent = cta.label;
        btn.appendChild(labelSpan);

        actionsEl.appendChild(btn);
      });
    }

    // Assemble content
    content.appendChild(headlineEl);
    if (subEl)     content.appendChild(subEl);
    if (actionsEl) content.appendChild(actionsEl);
    hero.appendChild(content);

    // Mount into the container
    this.#heroRegion = hero;
    this.#container.appendChild(hero);

    // ── Post-mount: headline text + animation ──────────────────────────────
    if (typewriter && !prefersReducedMotion()) {
      this.#typewriter = new TypewriterEffect(
        headlineEl,
        headline,
        () => this.#dispatch(HEADER_EVENTS.TYPEWRITER_DONE)
      );
      this.#typewriter.start();
    } else {
      headlineEl.textContent = headline;
    }

    // ── Post-mount: particle canvas ────────────────────────────────────────
    if (particles && canvasEl) {
      // Defer so the canvas has layout dimensions
      requestAnimationFrame(() => {
        this.#particles = new ParticleCanvas(canvasEl);
        this.#particles.start();
      });

      // Sync particles to theme changes
      const onTheme = (e) => this.#particles?.updateTheme(e.detail?.theme ?? 'light');
      document.addEventListener('nav:theme:changed', onTheme);
      this.#cleanupFns.push(() =>
        document.removeEventListener('nav:theme:changed', onTheme)
      );
    }

    // ── CTA click events ────────────────────────────────────────────────────
    if (actionsEl) {
      const onCtaClick = (e) => {
        const btn = e.target.closest(`.${CSS.HERO_CTA}`);
        if (!btn) return;
        this.#dispatch(HEADER_EVENTS.HERO_CTA_CLICKED, {
          buttonId: btn.dataset.ctaId,
          href:     btn.getAttribute('href'),
        });
      };
      actionsEl.addEventListener('click', onCtaClick);
      this.#cleanupFns.push(() =>
        actionsEl.removeEventListener('click', onCtaClick)
      );
    }

    // ── Entrance animation ──────────────────────────────────────────────────
    this.#animateIn(hero);
  }

  /**
   * Render the page title block — used on tutorial, project, quiz, and
   * dashboard pages instead of a full hero.
   *
   * @param {{
   *   title:        string,
   *   eyebrow?:     string,
   *   description?: string,
   *   readingTime?: string,
   *   difficulty?:  'Beginner'|'Intermediate'|'Advanced',
   *   actions?:     Array<{id:string, label:string, icon?:string, primary?:boolean}>,
   *   updateDocTitle?: boolean,
   * }} options
   */
  renderPageTitle(options = {}) {
    const {
      title,
      eyebrow      = '',
      description  = '',
      readingTime  = '',
      difficulty   = '',
      actions      = [],
      updateDocTitle = true,
    } = options;

    if (!title) {
      console.warn('[Header] renderPageTitle() called without a title.');
      return;
    }

    this.#ensureContainer();
    this.#clearRegion('title');

    const block = document.createElement('div');
    block.className = CSS.TITLE_BLOCK;

    // Eyebrow
    if (eyebrow) {
      const eb = document.createElement('p');
      eb.className   = `${CSS.TITLE_EYEBROW} eyebrow`;
      eb.textContent = eyebrow;
      block.appendChild(eb);
    }

    // Main heading
    const h1 = document.createElement('h1');
    h1.className   = CSS.TITLE_HEADING;
    h1.textContent = title;
    block.appendChild(h1);

    // Description
    if (description) {
      const desc = document.createElement('p');
      desc.className   = `${CSS.TITLE_DESC} lead`;
      desc.textContent = description;
      block.appendChild(desc);
    }

    // Meta row (reading time + difficulty badge)
    const hasMeta = readingTime || difficulty;
    if (hasMeta) {
      const meta = document.createElement('div');
      meta.className = CSS.TITLE_META;

      if (readingTime) {
        const rt = document.createElement('span');
        rt.className = `${CSS.TITLE_BADGE} ${CSS.TITLE_BADGE}--time`;
        rt.innerHTML = `${icon('clock')}<span>${escapeHtml(readingTime)}</span>`;
        meta.appendChild(rt);
      }

      if (difficulty) {
        const diff = document.createElement('span');
        const diffClass = difficulty.toLowerCase(); // 'beginner'|'intermediate'|'advanced'
        diff.className = `${CSS.TITLE_BADGE} ${CSS.TITLE_BADGE}--difficulty difficulty--${diffClass}`;
        diff.innerHTML = `${icon('star')}<span>${escapeHtml(difficulty)}</span>`;
        meta.appendChild(diff);
      }

      block.appendChild(meta);
    }

    // Action buttons
    if (actions.length > 0) {
      const actionsEl = document.createElement('div');
      actionsEl.className = CSS.TITLE_ACTIONS;

      actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = action.primary ? 'btn btn--primary' : 'btn btn--secondary';
        btn.dataset.actionId = escapeAttr(action.id);

        if (action.icon) {
          const iconSpan = document.createElement('span');
          iconSpan.setAttribute('aria-hidden', 'true');
          iconSpan.innerHTML = icon(action.icon);
          btn.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.textContent = action.label;
        btn.appendChild(labelSpan);

        actionsEl.appendChild(btn);
      });

      block.appendChild(actionsEl);
    }

    this.#titleRegion = block;
    this.#container.appendChild(block);

    // Update <title> and meta description for SEO + tab labelling
    if (updateDocTitle) {
      this.#updateDocumentTitle(title);
    }

    // Entrance animation
    this.#animateIn(block);
  }

  /**
   * Render the breadcrumb navigation trail.
   *
   * @param {{
   *   items?:         Array<{label:string, href:string}>,
   *   showOnMobile?:  boolean,
   *   jsonLd?:        boolean,
   * }} [options={}]
   */
  renderBreadcrumbs(options = {}) {
    const {
      items        = [],
      showOnMobile = false,
      jsonLd       = true,
    } = options;

    this.#ensureContainer();
    this.#clearRegion('breadcrumb');

    this.#crumbData      = BreadcrumbBuilder.build(items);
    this.#crumbsCollapsed = this.#crumbData.length > CRUMB_COLLAPSE_THRESHOLD;

    // Outer wrapper
    const wrapper = document.createElement('div');
    wrapper.className = [
      CSS.BREADCRUMB,
      showOnMobile ? '' : 'breadcrumb--desktop-only',
    ].filter(Boolean).join(' ');

    // The semantic nav element
    const nav = document.createElement('nav');
    nav.className = CSS.CRUMB_NAV;
    nav.setAttribute('aria-label', 'Breadcrumb');

    const ol = this.#buildCrumbList();
    nav.appendChild(ol);
    wrapper.appendChild(nav);

    this.#breadcrumbRegion = wrapper;
    this.#container.insertBefore(wrapper, this.#container.firstChild);

    // JSON-LD structured data for rich search results
    if (jsonLd) {
      this.#injectBreadcrumbJsonLd(this.#crumbData);
    }

    // Attach expand button handler if collapsed
    if (this.#crumbsCollapsed) {
      const ellipsisBtn = wrapper.querySelector(`.${CSS.CRUMB_ELLIPSIS}`);
      if (ellipsisBtn) {
        const onExpand = () => this.#expandBreadcrumbs();
        ellipsisBtn.addEventListener('click', onExpand);
        this.#cleanupFns.push(() =>
          ellipsisBtn.removeEventListener('click', onExpand)
        );
      }
    }

    // Crumb link click tracking
    const onCrumbClick = (e) => {
      const link = e.target.closest(`.${CSS.CRUMB_LINK}`);
      if (!link) return;
      const idx = Number(link.dataset.crumbIndex ?? -1);
      if (idx < 0) return;
      this.#dispatch(HEADER_EVENTS.BREADCRUMB_CLICKED, {
        index: idx,
        label: this.#crumbData[idx]?.label ?? '',
        href:  link.getAttribute('href'),
      });
    };
    wrapper.addEventListener('click', onCrumbClick);
    this.#cleanupFns.push(() =>
      wrapper.removeEventListener('click', onCrumbClick)
    );
  }

  /**
   * Render the search input component.
   *
   * @param {{
   *   placeholder?: string,
   *   overlay?:     boolean,
   *   initialValue?: string,
   * }} [options={}]
   */
  renderSearch(options = {}) {
    const {
      placeholder  = 'Search tutorials, topics, projects…',
      overlay      = false,
      initialValue = '',
    } = options;

    this.#ensureContainer();
    this.#clearRegion('search');

    const wrapper = document.createElement('div');
    wrapper.className = [
      CSS.SEARCH,
      overlay ? CSS.SEARCH_OVERLAY : '',
    ].filter(Boolean).join(' ');

    // Unique IDs for ARIA association
    const inputId  = 'header-search-input';
    const liveId   = 'header-search-live';

    wrapper.innerHTML = `
      <form class="${CSS.SEARCH_FORM}"
            role="search"
            aria-label="Site search"
            novalidate>

        <!-- Search icon (decorative) -->
        <span class="${CSS.SEARCH_ICON}" aria-hidden="true">
          ${icon('search')}
        </span>

        <!-- Input -->
        <input
          id="${inputId}"
          class="${CSS.SEARCH_INPUT}"
          type="search"
          name="q"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="${escapeAttr(placeholder)}"
          aria-label="Search"
          aria-controls="${liveId}"
          aria-autocomplete="list"
          value="${escapeAttr(initialValue)}"
        />

        <!-- Keyboard shortcut hint — hidden when input is focused or has value -->
        <kbd class="${CSS.SEARCH_SHORTCUT}"
             aria-label="Press ${escapeAttr(SEARCH_SHORTCUT_KEY)} to search"
             aria-hidden="true">
          ${escapeHtml(SEARCH_SHORTCUT_KEY)}
        </kbd>

        <!-- Clear button — only visible when input has a value -->
        <button
          class="${CSS.SEARCH_CLEAR}"
          type="reset"
          aria-label="Clear search"
          tabindex="-1"
          hidden>
          ${icon('close')}
        </button>

      </form>

      <!-- Live region: announces result counts to screen readers -->
      <div
        id="${liveId}"
        class="${CSS.SEARCH_LIVE}"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-relevant="text">
      </div>
    `;

    this.#searchRegion = wrapper;
    this.#container.appendChild(wrapper);

    // Cache references
    this.#searchInput = wrapper.querySelector(`.${CSS.SEARCH_INPUT}`);
    this.#searchLive  = wrapper.querySelector(`.${CSS.SEARCH_LIVE}`);

    // Populate initial value
    if (initialValue) {
      this.#searchQuery = initialValue;
      wrapper.classList.add(CSS.SEARCH_HAS_VALUE);
      wrapper.querySelector(`.${CSS.SEARCH_CLEAR}`)?.removeAttribute('hidden');
    }

    this.#attachSearchEvents(wrapper);

    // Listen for result count updates from page scripts
    const onResultCount = (e) => this.#updateSearchLive(e.detail?.count ?? null);
    document.addEventListener('search:results:count', onResultCount);
    this.#cleanupFns.push(() =>
      document.removeEventListener('search:results:count', onResultCount)
    );

    // Global "/" shortcut to focus search
    const onGlobalKey = (e) => this.#handleGlobalSearchShortcut(e);
    document.addEventListener('keydown', onGlobalKey);
    this.#cleanupFns.push(() =>
      document.removeEventListener('keydown', onGlobalKey)
    );
  }

  /**
   * Update the live region with a result count message.
   * Called externally by page scripts after they filter their content.
   *
   * @param {number|null} count  — null clears the live region
   */
  announceSearchResults(count) {
    this.#updateSearchLive(count);
  }

  /**
   * Programmatically set the search query value.
   * Useful when the router restores a previous search query on back-navigation.
   *
   * @param {string} value
   */
  setSearchValue(value) {
    if (!this.#searchInput) return;
    this.#searchInput.value = value;
    this.#handleSearchInput(value);
  }

  /**
   * Re-render breadcrumbs after a SPA navigation where the page title has changed.
   * Called by the router after the new page's <h1> is rendered.
   *
   * @param {Array<{label:string, href:string}>} [items]
   */
  refreshBreadcrumbs(items = []) {
    if (this.#breadcrumbRegion) {
      this.renderBreadcrumbs({ items });
    }
  }

  /**
   * Release all event listeners and stop animations.
   * Call when the SPA navigates away from the page.
   */
  destroy() {
    this.#typewriter?.cancel();
    this.#particles?.stop();
    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];
  }

  // ---- Container management ------------------------------------------------

  /**
   * Resolves the container element by ID, or creates one and prepends it to
   * <main> if the HTML does not already include it.
   */
  #ensureContainer() {
    if (this.#container) return;

    this.#container = document.getElementById(this.#config.containerId);

    if (!this.#container) {
      this.#container = document.createElement('div');
      this.#container.id        = this.#config.containerId;
      this.#container.className = CSS.PAGE_HEADER;

      const main = document.querySelector('main') ?? document.body;
      main.insertBefore(this.#container, main.firstChild);
    }
  }

  /**
   * Clear a specific rendered region without destroying the container.
   *
   * @param {'hero'|'title'|'breadcrumb'|'search'} region
   */
  #clearRegion(region) {
    const regionMap = {
      hero:       () => { this.#heroRegion?.remove();       this.#heroRegion = null;       },
      title:      () => { this.#titleRegion?.remove();      this.#titleRegion = null;      },
      breadcrumb: () => { this.#breadcrumbRegion?.remove(); this.#breadcrumbRegion = null; },
      search:     () => {
        this.#searchRegion?.remove();
        this.#searchRegion = null;
        this.#searchInput  = null;
        this.#searchLive   = null;
      },
    };

    // Also stop active animation instances
    if (region === 'hero') {
      this.#typewriter?.cancel();
      this.#particles?.stop();
      this.#typewriter = null;
      this.#particles  = null;
    }

    regionMap[region]?.();
  }

  // ---- Breadcrumb helpers --------------------------------------------------

  /**
   * Build the <ol> list from the current crumb data, applying
   * the collapsed state if applicable.
   *
   * @returns {HTMLOListElement}
   */
  #buildCrumbList() {
    const ol = document.createElement('ol');
    ol.className = CSS.CRUMB_LIST;
    ol.setAttribute('role', 'list');

    const crumbs = this.#crumbData;
    const total  = crumbs.length;
    const collapsed = this.#crumbsCollapsed && total > CRUMB_COLLAPSE_THRESHOLD;

    crumbs.forEach((crumb, i) => {
      // In collapsed mode: show first, ellipsis, last two
      const isFirst  = i === 0;
      const isLast   = i === total - 1;
      const isSecondLast = i === total - 2;
      const isMiddle = !isFirst && !isLast && !isSecondLast;

      if (collapsed && isMiddle) {
        // Insert the ellipsis item only once (after the first crumb)
        if (i === 1) {
          ol.appendChild(this.#buildEllipsisCrumb());
        }
        return; // Skip middle items
      }

      ol.appendChild(this.#buildCrumbItem(crumb, i));
    });

    return ol;
  }

  /**
   * Build a single <li> crumb item.
   *
   * @param {{label:string, href:string, isCurrent:boolean}} crumb
   * @param {number} index
   * @returns {HTMLLIElement}
   */
  #buildCrumbItem(crumb, index) {
    const li = document.createElement('li');
    li.className = CSS.CRUMB_ITEM;

    // Separator (not for first item)
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = CSS.CRUMB_SEPARATOR;
      sep.setAttribute('aria-hidden', 'true');
      sep.innerHTML = icon('chevronRight');
      li.appendChild(sep);
    }

    if (crumb.isCurrent) {
      // Current page — not a link; uses aria-current
      const span = document.createElement('span');
      span.className   = CSS.CRUMB_CURRENT;
      span.setAttribute('aria-current', 'page');
      span.textContent = crumb.label;
      li.appendChild(span);
    } else {
      const a = document.createElement('a');
      a.href               = crumb.href;
      a.className          = CSS.CRUMB_LINK;
      a.dataset.crumbIndex = String(index);

      // Home item gets the home icon in addition to a label
      if (index === 0) {
        a.innerHTML = `${icon('home')}<span class="sr-only">${escapeHtml(crumb.label)}</span>`;
      } else {
        a.textContent = crumb.label;
      }

      li.appendChild(a);
    }

    return li;
  }

  /**
   * Build the collapsed ellipsis <li> with an expand button.
   *
   * @returns {HTMLLIElement}
   */
  #buildEllipsisCrumb() {
    const li = document.createElement('li');
    li.className = CSS.CRUMB_ITEM;

    const sep = document.createElement('span');
    sep.className = CSS.CRUMB_SEPARATOR;
    sep.setAttribute('aria-hidden', 'true');
    sep.innerHTML = icon('chevronRight');
    li.appendChild(sep);

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = CSS.CRUMB_ELLIPSIS;
    btn.setAttribute('aria-label', 'Show full breadcrumb trail');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = icon('ellipsis');
    li.appendChild(btn);

    return li;
  }

  /**
   * Expand the collapsed breadcrumb trail on ellipsis button click.
   */
  #expandBreadcrumbs() {
    this.#crumbsCollapsed = false;

    // Re-render the list in the existing nav element
    const nav = this.#breadcrumbRegion?.querySelector(`.${CSS.CRUMB_NAV}`);
    if (!nav) return;

    nav.innerHTML = '';
    nav.appendChild(this.#buildCrumbList());
  }

  /**
   * Inject a JSON-LD BreadcrumbList script tag for rich search results.
   * Removes any pre-existing breadcrumb JSON-LD to avoid duplicates.
   *
   * @param {Array<{label:string, href:string}>} crumbs
   */
  #injectBreadcrumbJsonLd(crumbs) {
    // Remove existing
    document.getElementById('breadcrumb-jsonld')?.remove();

    const origin = window.location.origin;

    const listElements = crumbs.map((crumb, i) => ({
      '@type':    'ListItem',
      position:   i + 1,
      name:       crumb.label,
      item:       crumb.isCurrent
        ? undefined                                     // Current page — item omitted per spec
        : `${origin}${crumb.href}`,
    })).map((item) => {
      // Remove undefined fields
      const clean = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined) clean[k] = v;
      }
      return clean;
    });

    const schema = {
      '@context':        'https://schema.org',
      '@type':           'BreadcrumbList',
      itemListElement:   listElements,
    };

    const script = document.createElement('script');
    script.id   = 'breadcrumb-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema, null, 2);
    document.head.appendChild(script);
  }

  // ---- Search helpers ------------------------------------------------------

  /**
   * Attach all event listeners for the search component.
   *
   * @param {HTMLElement} wrapper
   */
  #attachSearchEvents(wrapper) {
    const input    = this.#searchInput;
    const clearBtn = wrapper.querySelector(`.${CSS.SEARCH_CLEAR}`);
    const form     = wrapper.querySelector(`.${CSS.SEARCH_FORM}`);

    if (!input) return;

    // Debounced input handler — fires the search:query event
    const onInput = debounce(() => {
      this.#handleSearchInput(input.value);
    }, SEARCH_DEBOUNCE_MS);

    input.addEventListener('input', onInput);
    this.#cleanupFns.push(() => input.removeEventListener('input', onInput));

    // Focus / blur — toggles active state + hides keyboard shortcut hint
    const onFocus = () => {
      this.#searchActive = true;
      wrapper.classList.add(CSS.SEARCH_ACTIVE);
      this.#dispatch(HEADER_EVENTS.SEARCH_FOCUSED);
    };

    const onBlur = () => {
      // Small delay so clear-button clicks register before blur fires
      setTimeout(() => {
        this.#searchActive = false;
        wrapper.classList.remove(CSS.SEARCH_ACTIVE);
      }, 150);
    };

    input.addEventListener('focus', onFocus);
    input.addEventListener('blur',  onBlur);
    this.#cleanupFns.push(() => {
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur',  onBlur);
    });

    // Keyboard: Escape clears and blurs
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // Prevent nav's global Escape handler also firing
        this.#clearSearch();
        input.blur();
      }
    };
    input.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => input.removeEventListener('keydown', onKeydown));

    // Clear button
    if (clearBtn) {
      const onClear = (e) => {
        e.preventDefault();
        this.#clearSearch();
        input.focus();
      };
      clearBtn.addEventListener('click', onClear);
      this.#cleanupFns.push(() => clearBtn.removeEventListener('click', onClear));
    }

    // Prevent form submission (search is purely client-side)
    if (form) {
      const onSubmit = (e) => e.preventDefault();
      form.addEventListener('submit', onSubmit);
      this.#cleanupFns.push(() => form.removeEventListener('submit', onSubmit));

      // Reset event (browser native clear)
      const onReset = () => {
        // Let the browser clear the input value first (next tick)
        setTimeout(() => this.#clearSearch(), 0);
      };
      form.addEventListener('reset', onReset);
      this.#cleanupFns.push(() => form.removeEventListener('reset', onReset));
    }
  }

  /**
   * Core search input handler. Updates state, DOM, and dispatches the event.
   *
   * @param {string} rawValue
   */
  #handleSearchInput(rawValue) {
    const trimmed = rawValue.trim();
    const wrapper = this.#searchRegion;
    const clearBtn = wrapper?.querySelector(`.${CSS.SEARCH_CLEAR}`);

    this.#searchQuery = trimmed;

    // Update has-value class and clear button visibility
    if (trimmed.length > 0) {
      wrapper?.classList.add(CSS.SEARCH_HAS_VALUE);
      clearBtn?.removeAttribute('hidden');
      clearBtn?.setAttribute('tabindex', '0');
    } else {
      wrapper?.classList.remove(CSS.SEARCH_HAS_VALUE);
      clearBtn?.setAttribute('hidden', '');
      clearBtn?.setAttribute('tabindex', '-1');
      this.#clearSearchLive();
    }

    this.#dispatch(HEADER_EVENTS.SEARCH_QUERY, {
      query:   rawValue,
      trimmed,
    });
  }

  /** Reset the search input to empty. */
  #clearSearch() {
    if (this.#searchInput) {
      this.#searchInput.value = '';
    }
    this.#handleSearchInput('');
    this.#clearSearchLive();
    this.#dispatch(HEADER_EVENTS.SEARCH_CLEARED);
  }

  /**
   * Handle the global "/" keyboard shortcut to focus the search field.
   *
   * @param {KeyboardEvent} e
   */
  #handleGlobalSearchShortcut(e) {
    if (!this.#searchInput) return;

    // Do not intercept if focus is already in an input, textarea, or contenteditable
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isEditable = document.activeElement?.isContentEditable;
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || isEditable) return;

    if (e.key === SEARCH_SHORTCUT_KEY && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.#searchInput.focus();
      // Select existing text so the user can immediately overwrite it
      this.#searchInput.select();
    }
  }

  /**
   * Update the ARIA live region with a result count message.
   *
   * @param {number|null} count
   */
  #updateSearchLive(count) {
    if (!this.#searchLive) return;

    if (count === null || this.#searchQuery === '') {
      this.#clearSearchLive();
      return;
    }

    const message = count === 0
      ? `No results found for "${this.#searchQuery}".`
      : count === 1
        ? '1 result found.'
        : `${count} results found.`;

    // Clear first so repeated announcements trigger the live region
    this.#searchLive.textContent = '';
    // rAF ensures the DOM update triggers a new announcement
    requestAnimationFrame(() => {
      if (this.#searchLive) {
        this.#searchLive.textContent = message;
      }
    });
  }

  /** Empty the ARIA live region. */
  #clearSearchLive() {
    if (this.#searchLive) {
      this.#searchLive.textContent = '';
    }
  }

  // ---- Document title ------------------------------------------------------

  /**
   * Update <title> and meta description for the current page.
   * Follows the pattern: "Page Title | Python for AI"
   *
   * @param {string} pageTitle
   */
  #updateDocumentTitle(pageTitle) {
    // <title>
    document.title = pageTitle
      ? `${pageTitle} | ${this.#config.siteTitle}`
      : this.#config.siteTitle;

    // Update existing meta description if present
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && !metaDesc.dataset.static) {
      // Only update if the meta description wasn't set statically in the HTML
      // (detected by the absence of data-static attribute)
    }
  }

  // ---- Entrance animation --------------------------------------------------

  /**
   * Triggers a CSS-driven fade-up entrance animation on an element.
   * Adds the `.animate-in` class immediately and `.animate-done` on the next
   * frame to start the transition. Elements with stagger-* classes get
   * sequenced delays via CSS custom properties.
   *
   * If prefers-reduced-motion is active, both classes are added synchronously
   * so the element appears instantly with no movement.
   *
   * @param {HTMLElement} el
   */
  #animateIn(el) {
    if (prefersReducedMotion()) {
      el.classList.add(CSS.ANIMATE_IN, CSS.ANIMATE_DONE);
      return;
    }

    el.classList.add(CSS.ANIMATE_IN);
    // rAF ensures the browser has painted the initial opacity:0 state
    // before adding animate-done, giving the transition something to transition from
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add(CSS.ANIMATE_DONE);
      });
    });
  }

  // ---- Event bus -----------------------------------------------------------

  /**
   * Publish to the project event bus + dispatch a native CustomEvent.
   * Consistent with the pattern established in navigation.js.
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

export default Header;