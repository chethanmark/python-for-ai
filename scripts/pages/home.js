/**
 * =============================================================================
 * HOME PAGE MODULE
 * scripts/pages/home.js
 * -----------------------------------------------------------------------------
 * Interactive landing page for the Python for AI educational platform.
 * This module owns the complete home page lifecycle: data loading, HTML
 * generation, reactive event subscriptions, DOM event delegation, and
 * clean teardown on route navigation.
 *
 * ARCHITECTURE:
 *   HomePage (default export)
 *     └─ Self-contained: no imported sub-components.
 *        All state is read from the platform event bus and the injected
 *        ProgressTracker reference. The page renders itself into the router
 *        outlet and tears itself down fully when the route changes.
 *
 * SECTIONS (rendered in document order):
 *   1.  Hero Banner            — headline, sub-headline, CTA buttons, animated XP ring
 *   2.  Welcome Card           — time-aware greeting, user name, motivational copy
 *   3.  Continue Learning      — resume last tutorial / quiz / project from tracker
 *   4.  Learning Statistics    — six stat tiles (tutorials, quizzes, projects, XP, streak, accuracy)
 *   5.  Featured Courses       — curated list of 6 courses with difficulty, duration, completion %
 *   6.  Learning Paths         — three skill tracks (Beginner / Intermediate / Advanced)
 *   7.  Daily Challenge        — one rotating puzzle with a countdown to reset
 *   8.  Recent Activity        — time-sorted feed of tutorial/quiz/project completions
 *   9.  Achievement Preview    — unlocked badges + 4 locked previews
 *  10.  Quick Actions          — 6 shortcut buttons to platform areas
 *  11.  AI Playground Preview  — editor mock with a copy-to-playground CTA
 *  12.  Footer Integration     — newsletter sign-up callout above the global footer
 *
 * REACTIVE UPDATES:
 *   • progress:updated   → re-renders statistics, continue learning, recent activity,
 *                          achievement preview, and the XP ring in the hero
 *   • state:updated      → re-renders the welcome card (user name / theme)
 *   • theme:changed      → updates the hero section class for dark/light palette
 *   • router:afterNavigate → ignored (this page only runs while mounted)
 *
 * EVENT EMISSIONS:
 *   home:mounted   { pathname }
 *   home:updated   { section, timestamp }
 *   home:destroyed { pathname }
 *
 * ACCESSIBILITY:
 *   • Landmark roles on every section (main, nav, region, article, aside)
 *   • ARIA live region for progress announcements
 *   • All interactive elements have visible labels
 *   • Focus management: after mount, focus moves to the H1 for keyboard users
 *   • Reduced motion: XP ring animation and hero parallax are suppressed
 *   • Colour contrast: stat tiles use CSS custom properties for WCAG AA
 *
 * INTEGRATION POINTS (injected via constructor config):
 *   • tracker  — ProgressTracker instance → getSummary() called on every refresh
 *   • router   — Router instance → router.navigate() on CTA clicks
 *   • store    — StateStore instance → store.getUser(), store.getTheme()
 *
 * USAGE (routes/index.js, called by router.js component loader):
 *
 *   // router.js component loader for the '/' route:
 *   {
 *     path:      '/',
 *     title:     'Home',
 *     component: () => import('./pages/home.js'),
 *   }
 *
 *   // router.js calls component.mount(outlet, ctx) and component.unmount()
 *   // The module's default export provides both via HomePage.
 *
 *   // Alternatively, constructed directly in main.js:
 *   import HomePage from './pages/home.js';
 *   const page = new HomePage({ containerId: 'app-outlet', tracker, router, store });
 *   page.initialize();
 *   page.mount();
 *
 * EXPORTS:
 *   HomePage  — primary class (default export)
 *   HOME_EVENTS — event name constants
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { PROGRESS_EVENTS } from '../components/progress-tracker.js';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the home page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOME_EVENTS = Object.freeze({
  MOUNTED:   'home:mounted',
  UPDATED:   'home:updated',
  DESTROYED: 'home:destroyed',
});

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth, zero magic strings
// ---------------------------------------------------------------------------

/**
 * @type {Readonly<Record<string, string>>}
 */
const CSS = Object.freeze({
  // Page root
  ROOT:                   'home-page',
  ROOT_DARK:              'home-page--dark',
  ROOT_REDUCED_MOTION:    'home-page--reduced-motion',

  // Live region
  LIVE:                   'home-page__live',

  // 1. Hero
  HERO:                   'home-hero',
  HERO_INNER:             'home-hero__inner',
  HERO_CONTENT:           'home-hero__content',
  HERO_EYEBROW:           'home-hero__eyebrow',
  HERO_HEADING:           'home-hero__heading',
  HERO_SUB:               'home-hero__sub',
  HERO_ACTIONS:           'home-hero__actions',
  HERO_BTN_PRIMARY:       'home-hero__btn-primary',
  HERO_BTN_SECONDARY:     'home-hero__btn-secondary',
  HERO_VISUAL:            'home-hero__visual',
  HERO_RING_WRAP:         'home-hero__ring-wrap',
  HERO_RING_SVG:          'home-hero__ring-svg',
  HERO_RING_TRACK:        'home-hero__ring-track',
  HERO_RING_FILL:         'home-hero__ring-fill',
  HERO_RING_LABEL:        'home-hero__ring-label',
  HERO_RING_LEVEL:        'home-hero__ring-level',
  HERO_RING_XP:           'home-hero__ring-xp',
  HERO_STATS:             'home-hero__stats',
  HERO_STAT:              'home-hero__stat',
  HERO_STAT_VALUE:        'home-hero__stat-value',
  HERO_STAT_LABEL:        'home-hero__stat-label',

  // 2. Welcome card
  WELCOME:                'home-welcome',
  WELCOME_INNER:          'home-welcome__inner',
  WELCOME_GREETING:       'home-welcome__greeting',
  WELCOME_NAME:           'home-welcome__name',
  WELCOME_MSG:            'home-welcome__msg',
  WELCOME_DATE:           'home-welcome__date',
  WELCOME_FLAME:          'home-welcome__flame',
  WELCOME_STREAK:         'home-welcome__streak',

  // 3. Continue learning
  CONTINUE:               'home-continue',
  CONTINUE_GRID:          'home-continue__grid',
  CONTINUE_CARD:          'home-continue__card',
  CONTINUE_ICON:          'home-continue__icon',
  CONTINUE_BODY:          'home-continue__body',
  CONTINUE_TITLE:         'home-continue__title',
  CONTINUE_META:          'home-continue__meta',
  CONTINUE_PROGRESS:      'home-continue__progress',
  CONTINUE_PROGRESS_FILL: 'home-continue__progress-fill',
  CONTINUE_ARROW:         'home-continue__arrow',

  // 4. Statistics
  STATS:                  'home-stats',
  STATS_GRID:             'home-stats__grid',
  STAT_TILE:              'home-stats__tile',
  STAT_ICON:              'home-stats__icon',
  STAT_VALUE:             'home-stats__value',
  STAT_LABEL:             'home-stats__label',
  STAT_DELTA:             'home-stats__delta',
  STAT_DELTA_UP:          'home-stats__delta--up',
  STAT_DELTA_NEUTRAL:     'home-stats__delta--neutral',

  // 5. Featured courses
  COURSES:                'home-courses',
  COURSES_GRID:           'home-courses__grid',
  COURSE_CARD:            'home-courses__card',
  COURSE_BADGE:           'home-courses__badge',
  COURSE_BADGE_BEGINNER:  'home-courses__badge--beginner',
  COURSE_BADGE_INTER:     'home-courses__badge--intermediate',
  COURSE_BADGE_ADVANCED:  'home-courses__badge--advanced',
  COURSE_THUMB:           'home-courses__thumb',
  COURSE_BODY:            'home-courses__body',
  COURSE_TITLE:           'home-courses__title',
  COURSE_DESC:            'home-courses__desc',
  COURSE_META:            'home-courses__meta',
  COURSE_DURATION:        'home-courses__duration',
  COURSE_LESSONS:         'home-courses__lessons',
  COURSE_BAR:             'home-courses__bar',
  COURSE_BAR_FILL:        'home-courses__bar-fill',
  COURSE_CTA:             'home-courses__cta',

  // 6. Learning paths
  PATHS:                  'home-paths',
  PATHS_GRID:             'home-paths__grid',
  PATH_CARD:              'home-paths__card',
  PATH_CARD_BEGINNER:     'home-paths__card--beginner',
  PATH_CARD_INTER:        'home-paths__card--intermediate',
  PATH_CARD_ADVANCED:     'home-paths__card--advanced',
  PATH_ICON:              'home-paths__icon',
  PATH_TITLE:             'home-paths__title',
  PATH_DESC:              'home-paths__desc',
  PATH_TOPICS:            'home-paths__topics',
  PATH_TOPIC:             'home-paths__topic',
  PATH_COUNT:             'home-paths__count',
  PATH_CTA:               'home-paths__cta',

  // 7. Daily challenge
  CHALLENGE:              'home-challenge',
  CHALLENGE_INNER:        'home-challenge__inner',
  CHALLENGE_BADGE:        'home-challenge__badge',
  CHALLENGE_HEADING:      'home-challenge__heading',
  CHALLENGE_PROMPT:       'home-challenge__prompt',
  CHALLENGE_CODE:         'home-challenge__code',
  CHALLENGE_TIMER:        'home-challenge__timer',
  CHALLENGE_TIMER_LABEL:  'home-challenge__timer-label',
  CHALLENGE_TIMER_VALUE:  'home-challenge__timer-value',
  CHALLENGE_CTA:          'home-challenge__cta',

  // 8. Recent activity
  ACTIVITY:               'home-activity',
  ACTIVITY_LIST:          'home-activity__list',
  ACTIVITY_ITEM:          'home-activity__item',
  ACTIVITY_ICON:          'home-activity__icon',
  ACTIVITY_BODY:          'home-activity__body',
  ACTIVITY_TITLE:         'home-activity__title',
  ACTIVITY_TIME:          'home-activity__time',
  ACTIVITY_EMPTY:         'home-activity__empty',

  // 9. Achievement preview
  ACHIEVEMENTS:           'home-achievements',
  ACHIEVEMENT_GRID:       'home-achievements__grid',
  ACHIEVEMENT_BADGE:      'home-achievements__badge',
  ACHIEVEMENT_LOCKED:     'home-achievements__badge--locked',
  ACHIEVEMENT_ICON:       'home-achievements__icon',
  ACHIEVEMENT_TITLE:      'home-achievements__title',

  // 10. Quick actions
  ACTIONS:                'home-actions',
  ACTIONS_GRID:           'home-actions__grid',
  ACTION_CARD:            'home-actions__card',
  ACTION_ICON:            'home-actions__icon',
  ACTION_LABEL:           'home-actions__label',
  ACTION_DESC:            'home-actions__desc',

  // 11. Playground preview
  PLAYGROUND:             'home-playground',
  PLAYGROUND_INNER:       'home-playground__inner',
  PLAYGROUND_EDITOR:      'home-playground__editor',
  PLAYGROUND_TOPBAR:      'home-playground__topbar',
  PLAYGROUND_DOT:         'home-playground__dot',
  PLAYGROUND_FILENAME:    'home-playground__filename',
  PLAYGROUND_CODE:        'home-playground__code',
  PLAYGROUND_OUTPUT:      'home-playground__output',
  PLAYGROUND_OUTPUT_LINE: 'home-playground__output-line',
  PLAYGROUND_CTA:         'home-playground__cta',
  PLAYGROUND_CONTENT:     'home-playground__content',
  PLAYGROUND_HEADING:     'home-playground__heading',
  PLAYGROUND_SUB:         'home-playground__sub',

  // 12. Footer callout
  FOOTER_CTA:             'home-footer-cta',
  FOOTER_CTA_INNER:       'home-footer-cta__inner',
  FOOTER_CTA_HEADING:     'home-footer-cta__heading',
  FOOTER_CTA_SUB:         'home-footer-cta__sub',
  FOOTER_CTA_FORM:        'home-footer-cta__form',
  FOOTER_CTA_INPUT:       'home-footer-cta__input',
  FOOTER_CTA_BTN:         'home-footer-cta__btn',

  // Section scaffolding
  SECTION:                'home-section',
  SECTION_INNER:          'home-section__inner',
  SECTION_HEADER:         'home-section__header',
  SECTION_TITLE:          'home-section__title',
  SECTION_SUBTITLE:       'home-section__subtitle',
  SECTION_LINK:           'home-section__link',
});

// ---------------------------------------------------------------------------
// Static content data
// ---------------------------------------------------------------------------

/**
 * Featured course definitions.
 * Completion percentage is filled dynamically from tracker data.
 *
 * @type {ReadonlyArray<object>}
 */
const FEATURED_COURSES = Object.freeze([
  {
    id:         'python-fundamentals',
    title:      'Python Fundamentals',
    desc:       'Core syntax, data types, control flow, and functions — everything you need to write Python confidently.',
    difficulty: 'beginner',
    duration:   '4h 30m',
    lessons:    22,
    icon:       '🐍',
    accent:     'var(--color-success)',
    path:       '/tutorials?course=python-fundamentals',
  },
  {
    id:         'data-science-with-pandas',
    title:      'Data Science with Pandas',
    desc:       'Load, clean, transform, and visualise real datasets using the industry-standard Pandas library.',
    difficulty: 'intermediate',
    duration:   '6h 15m',
    lessons:    31,
    icon:       '📊',
    accent:     'var(--color-primary)',
    path:       '/tutorials?course=data-science-with-pandas',
  },
  {
    id:         'machine-learning-sklearn',
    title:      'Machine Learning with scikit-learn',
    desc:       'Build, train, and evaluate classification and regression models from scratch.',
    difficulty: 'intermediate',
    duration:   '8h 00m',
    lessons:    38,
    icon:       '🤖',
    accent:     'var(--color-accent)',
    path:       '/tutorials?course=machine-learning-sklearn',
  },
  {
    id:         'neural-networks-pytorch',
    title:      'Neural Networks with PyTorch',
    desc:       'Design deep learning architectures and train them on real image and text datasets.',
    difficulty: 'advanced',
    duration:   '10h 45m',
    lessons:    47,
    icon:       '🧠',
    accent:     'var(--color-danger)',
    path:       '/tutorials?course=neural-networks-pytorch',
  },
  {
    id:         'nlp-transformers',
    title:      'NLP with Transformers',
    desc:       'Leverage pre-trained language models (BERT, GPT) for real-world text understanding tasks.',
    difficulty: 'advanced',
    duration:   '9h 20m',
    lessons:    41,
    icon:       '💬',
    accent:     'var(--color-warning)',
    path:       '/tutorials?course=nlp-transformers',
  },
  {
    id:         'ai-project-portfolio',
    title:      'Build Your AI Portfolio',
    desc:       'Bring together everything you have learned by building five portfolio-ready AI projects.',
    difficulty: 'intermediate',
    duration:   '12h 00m',
    lessons:    30,
    icon:       '🏆',
    accent:     'var(--color-primary)',
    path:       '/projects',
  },
]);

/**
 * Learning path definitions.
 *
 * @type {ReadonlyArray<object>}
 */
const LEARNING_PATHS = Object.freeze([
  {
    id:         'beginner',
    level:      'Beginner',
    cssClass:   CSS.PATH_CARD_BEGINNER,
    icon:       '🌱',
    title:      'AI Foundations',
    desc:       'Start from zero. Learn Python, data structures, and your first machine learning models.',
    topics:     ['Python Basics', 'NumPy & Pandas', 'Data Visualisation', 'Linear Regression'],
    courseCount: 5,
    hoursTotal: 22,
    path:       '/paths/beginner',
  },
  {
    id:         'intermediate',
    level:      'Intermediate',
    cssClass:   CSS.PATH_CARD_INTER,
    icon:       '🚀',
    title:      'Applied ML Engineer',
    desc:       'Build real projects with scikit-learn, explore NLP, and learn deployment fundamentals.',
    topics:     ['scikit-learn', 'Feature Engineering', 'Model Evaluation', 'Flask APIs'],
    courseCount: 7,
    hoursTotal: 38,
    path:       '/paths/intermediate',
  },
  {
    id:         'advanced',
    level:      'Advanced',
    cssClass:   CSS.PATH_CARD_ADVANCED,
    icon:       '💎',
    title:      'Deep Learning Specialist',
    desc:       'Master PyTorch, Transformers, and cutting-edge research techniques in deep learning.',
    topics:     ['PyTorch', 'CNNs & RNNs', 'Transformers', 'Reinforcement Learning'],
    courseCount: 6,
    hoursTotal: 44,
    path:       '/paths/advanced',
  },
]);

/**
 * Daily challenge rotating pool.
 * The active challenge is derived from the day-of-year index mod pool length.
 *
 * @type {ReadonlyArray<object>}
 */
const CHALLENGE_POOL = Object.freeze([
  {
    title:  'List Comprehension',
    prompt: 'Rewrite the following for-loop as a single list comprehension that filters even numbers and squares them.',
    code:   'result = []\nfor x in range(20):\n    if x % 2 == 0:\n        result.append(x ** 2)',
    xp:     50,
  },
  {
    title:  'Dictionary Inversion',
    prompt: 'Write a function that inverts a dictionary — swapping keys and values — handling duplicate values gracefully.',
    code:   'def invert_dict(d):\n    # Your solution here\n    pass',
    xp:     60,
  },
  {
    title:  'Generator Pipeline',
    prompt: 'Create a generator that yields Fibonacci numbers up to a given maximum value without storing them in a list.',
    code:   'def fibonacci_up_to(max_val):\n    # Your solution here\n    pass',
    xp:     70,
  },
  {
    title:  'Decorator Pattern',
    prompt: 'Implement a @memoize decorator that caches the return value of any function for a given set of arguments.',
    code:   'def memoize(fn):\n    # Your solution here\n    pass',
    xp:     80,
  },
  {
    title:  'NumPy Vectorisation',
    prompt: 'Replace the Python loop with a vectorised NumPy operation to compute the element-wise sigmoid of an array.',
    code:   'import math\ndef sigmoid_loop(arr):\n    return [1 / (1 + math.exp(-x)) for x in arr]',
    xp:     65,
  },
  {
    title:  'Pandas Groupby',
    prompt: 'Given a DataFrame with columns [user_id, category, amount], compute the top-3 categories by total amount.',
    code:   'import pandas as pd\ndf = pd.read_csv("sales.csv")\n# Your solution here',
    xp:     75,
  },
  {
    title:  'Regex Extraction',
    prompt: 'Write a regex pattern that extracts all email addresses from a multi-line string.',
    code:   'import re\ntext = """..."""\n# Your solution here',
    xp:     55,
  },
]);

/**
 * Quick action button definitions.
 *
 * @type {ReadonlyArray<object>}
 */
const QUICK_ACTIONS = Object.freeze([
  {
    action:  'continue-learning',
    icon:    '▶',
    label:   'Continue Learning',
    desc:    'Pick up where you left off',
    accent:  'var(--color-primary)',
    path:    '/tutorials',
  },
  {
    action:  'start-quiz',
    icon:    '✏️',
    label:   'Take a Quiz',
    desc:    'Test your knowledge',
    accent:  'var(--color-success)',
    path:    '/quizzes',
  },
  {
    action:  'open-playground',
    icon:    '⌨️',
    label:   'Open Playground',
    desc:    'Write and run Python',
    accent:  'var(--color-accent)',
    path:    '/playground',
  },
  {
    action:  'browse-tutorials',
    icon:    '📚',
    label:   'Browse Tutorials',
    desc:    'Explore all courses',
    accent:  'var(--color-warning)',
    path:    '/tutorials',
  },
  {
    action:  'view-projects',
    icon:    '🔧',
    label:   'View Projects',
    desc:    'Build real AI apps',
    accent:  'var(--color-code)',
    path:    '/projects',
  },
  {
    action:  'view-dashboard',
    icon:    '📈',
    label:   'My Dashboard',
    desc:    'Track your progress',
    accent:  'var(--color-primary)',
    path:    '/dashboard',
  },
]);

/** Playground preview code sample */
const PLAYGROUND_SAMPLE = Object.freeze({
  filename: 'hello_ai.py',
  code: [
    'import numpy as np',
    '',
    '# Simple neural network layer',
    'def relu(x):',
    '    return np.maximum(0, x)',
    '',
    'weights = np.random.randn(4, 3)',
    'inputs  = np.array([1.0, 0.5, -0.3, 0.8])',
    '',
    'output = relu(inputs @ weights)',
    'print("Layer output:", output)',
  ],
  output: [
    '>>> Layer output: [0.842  0.     0.317]',
  ],
});

// ---------------------------------------------------------------------------
// Pure utility functions (module-private)
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

/**
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}

/**
 * Returns true when the user prefers reduced motion.
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
 * Return a time-appropriate greeting string.
 * @returns {string}
 */
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

/**
 * Format a Unix ms timestamp as a relative human-readable string.
 * @param {number} ts
 * @returns {string}
 */
function relativeTime(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1)  return 'yesterday';
  if (d < 7)    return `${d} days ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/**
 * Compute the index of today's daily challenge.
 * Uses day-of-year so the challenge changes at midnight.
 * @returns {number}
 */
function todayChallengeIndex() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff  = now - start;
  const dayOfYear = Math.floor(diff / 86_400_000);
  return dayOfYear % CHALLENGE_POOL.length;
}

/**
 * Milliseconds until the next local midnight.
 * Used to set the challenge reset countdown.
 * @returns {number}
 */
function msUntilMidnight() {
  const now       = new Date();
  const midnight  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/**
 * Format milliseconds as HH:MM:SS.
 * @param {number} ms
 * @returns {string}
 */
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h  = Math.floor(totalSec / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * Get a summary from the tracker or return a zero-state fallback.
 * @param {import('../components/progress-tracker.js').ProgressTracker|null} tracker
 * @returns {object}
 */
function getSummary(tracker) {
  if (!tracker?.getSummary) {
    return {
      xp: 0, level: 1, progressPct: 0, xpForNext: 100, xpNeeded: 100, isMaxLevel: false,
      streak:   { current: 0, longest: 0, lastDate: null, freezes: 0 },
      tutorials:{ started: 0, completed: 0, pct: 0, records: {} },
      quizzes:  { attempted: 0, passed: 0, accuracy: 0, pct: 0, records: {} },
      projects: { total: 0, completed: 0, pct: 0, records: {} },
      achievements: { unlocked: 0, total: 33, pct: 0, recent: [], all: [] },
      createdAt: Date.now(), updatedAt: Date.now(), storageAvailable: false,
    };
  }
  try { return tracker.getSummary(); } catch { return getSummary(null); }
}

// ---------------------------------------------------------------------------
// HomePage — primary class
// ---------------------------------------------------------------------------

/**
 * Home page module for the Python for AI platform.
 *
 * This class is designed to be used in two ways:
 *
 * 1. Via the router component loader (preferred):
 *    The router calls module.mount(outlet, ctx) and module.unmount()
 *    using the static helpers exposed on the class.
 *
 * 2. Directly in main.js:
 *    const page = new HomePage({ containerId, tracker, router, store });
 *    page.initialize(); page.mount();
 *
 * In both cases the full lifecycle is:
 *   constructor → initialize() → mount() → [reactive updates] → destroy()
 */
export default class HomePage {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   containerId: string,
   *   tracker:     object|null,
   *   router:      object|null,
   *   store:       object|null,
   * }}
   */
  #config;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #root       = null;
  /** @type {HTMLElement|null} */ #liveRegion = null;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean}  */ #mounted     = false;
  /** @type {boolean}  */ #destroyed   = false;

  /** @type {object}   — latest progress summary */ #summary;

  /** @type {string}   — current theme mode: 'light' | 'dark' | 'auto' */
  #theme = 'auto';

  // ---- Timers --------------------------------------------------------------

  /** @type {number|null} — setInterval for the daily challenge countdown */
  #challengeTimer = null;

  /** @type {Function} — debounced refresh */
  #debouncedRefresh;

  // ---- Cleanup references --------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   containerId?: string,
   *   tracker?:     object|null,
   *   router?:      object|null,
   *   store?:       object|null,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId: config.containerId ?? 'app-outlet',
      tracker:     config.tracker     ?? null,
      router:      config.router      ?? null,
      store:       config.store       ?? null,
    });

    this.#summary          = getSummary(this.#config.tracker);
    this.#debouncedRefresh = debounce(() => this.refresh(), 250);
  }

  // ---- Static router integration helpers -----------------------------------

  /**
   * Called by router.js when the '/' route is matched.
   * Creates and mounts an instance into the provided outlet element.
   * Stores the instance reference on the element for unmount().
   *
   * @param {HTMLElement} outlet
   * @param {object}      ctx — Router context with params, query, meta
   */
  static mount(outlet, ctx) {
    const instance = new HomePage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker  ?? null,
      router:      ctx?.meta?.router   ?? null,
      store:       ctx?.meta?.store    ?? null,
    });
    outlet.__homePage = instance;
    instance.#root = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * Called by router.js when navigating away from the '/' route.
   *
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__homePage?.destroy();
    delete outlet.__homePage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Prepare internal state, resolve the current theme, and register
   * all external event listeners.
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * @returns {HomePage} this — for chaining
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    // Resolve current theme from store
    if (this.#config.store) {
      try {
        this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light';
      } catch { /* ignore */ }
    }

    // Fetch initial summary
    this.#summary = getSummary(this.#config.tracker);

    return this;
  }

  /**
   * Render the home page into the container and attach all event listeners.
   *
   * @returns {HomePage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    // Resolve container
    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }

    if (!this.#root) {
      console.error(`[HomePage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.render();
    this.#attachEventListeners();
    this.#startChallengeTimer();

    this.#mounted = true;

    // Move focus to the main heading after mount for keyboard users
    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(HOME_EVENTS.MOUNTED, { pathname: '/' });
    this.#announce('Home page loaded.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   * Called on mount() and after any full re-render trigger.
   *
   * @returns {HomePage} this
   */
  render() {
    if (!this.#root) return this;

    const s            = this.#summary;
    const isDark       = this.#theme === 'dark';
    const reducedMotion = prefersReducedMotion();

    this.#root.className = [
      CSS.ROOT,
      isDark        ? CSS.ROOT_DARK           : '',
      reducedMotion ? CSS.ROOT_REDUCED_MOTION : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', 'Python for AI — Home');

    this.#root.innerHTML = `
      <!-- ARIA live region for screen reader announcements -->
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text">
      </div>

      ${this.#renderHero(s)}
      ${this.#renderWelcome(s)}
      ${this.#renderContinueLearning(s)}
      ${this.#renderStatistics(s)}
      ${this.#renderFeaturedCourses(s)}
      ${this.#renderLearningPaths()}
      ${this.#renderDailyChallenge()}
      ${this.#renderRecentActivity(s)}
      ${this.#renderAchievements(s)}
      ${this.#renderQuickActions()}
      ${this.#renderPlayground()}
      ${this.#renderFooterCTA()}
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);

    // Animate the hero XP ring after paint
    requestAnimationFrame(() => this.#animateHeroRing(s));

    return this;
  }

  /**
   * Refresh data from the tracker and re-render dynamic sections only.
   * More efficient than a full render() for reactive updates.
   *
   * @returns {HomePage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    this.#summary = getSummary(this.#config.tracker);

    const s = this.#summary;

    // Surgically update only the sections that depend on tracker data
    this.#updateSection('hero-visual',      this.#renderHeroVisual(s));
    this.#updateSection('welcome-section',  this.#renderWelcomeInner(s));
    this.#updateSection('continue-section', this.#renderContinueLearningInner(s));
    this.#updateSection('stats-section',    this.#renderStatisticsInner(s));
    this.#updateSection('activity-section', this.#renderRecentActivityInner(s));
    this.#updateSection('achievements-section', this.#renderAchievementsInner(s));

    requestAnimationFrame(() => this.#animateHeroRing(s));

    this.#dispatch(HOME_EVENTS.UPDATED, { section: 'all', timestamp: Date.now() });

    return this;
  }

  /**
   * Remove all event listeners, cancel timers, and clear the DOM.
   *
   * @returns {HomePage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedRefresh.cancel();

    if (this.#challengeTimer !== null) {
      clearInterval(this.#challengeTimer);
      this.#challengeTimer = null;
    }

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    if (this.#root) {
      this.#root.innerHTML = '';
      this.#root.className = '';
      this.#root.removeAttribute('role');
      this.#root.removeAttribute('aria-label');
    }

    this.#destroyed = true;
    this.#mounted   = false;

    this.#dispatch(HOME_EVENTS.DESTROYED, { pathname: '/' });

    return this;
  }

  // ---- Private: section rendering -----------------------------------------

  /**
   * Render the hero banner section.
   *
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderHero(s) {
    return `
      <section class="${CSS.HERO}" aria-labelledby="hero-heading">
        <div class="${CSS.HERO_INNER}">
          <div class="${CSS.HERO_CONTENT}">
            <p class="${CSS.HERO_EYEBROW}">
              Python for AI — Interactive Learning Platform
            </p>
            <h1 class="${CSS.HERO_HEADING}" id="hero-heading" tabindex="-1">
              Learn AI Engineering,<br>
              One Line at a Time.
            </h1>
            <p class="${CSS.HERO_SUB}">
              Hands-on tutorials, real Python code, instant feedback, and a
              gamified learning experience that makes mastering AI genuinely fun.
            </p>
            <div class="${CSS.HERO_ACTIONS}">
              <button class="${CSS.HERO_BTN_PRIMARY}"
                      type="button"
                      data-action="start-learning"
                      aria-label="Start learning Python for AI">
                Start Learning Free
              </button>
              <button class="${CSS.HERO_BTN_SECONDARY}"
                      type="button"
                      data-action="open-playground"
                      aria-label="Open the Python playground">
                Open Playground
              </button>
            </div>
          </div>

          <div class="${CSS.HERO_VISUAL}" id="hero-visual">
            ${this.#renderHeroVisual(s)}
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Render the XP ring and stat callouts inside the hero visual panel.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderHeroVisual(s) {
    const pct          = s.progressPct ?? 0;
    const circumference = 2 * Math.PI * 56;    // r = 56
    const offset        = circumference * (1 - pct / 100);

    return `
      <div class="${CSS.HERO_RING_WRAP}"
           role="img"
           aria-label="Level ${s.level}, ${pct}% progress to next level">
        <svg class="${CSS.HERO_RING_SVG}"
             viewBox="0 0 128 128"
             aria-hidden="true"
             focusable="false">
          <circle class="${CSS.HERO_RING_TRACK}"
                  cx="64" cy="64" r="56"
                  fill="none"
                  stroke-width="10"/>
          <circle class="${CSS.HERO_RING_FILL}"
                  id="hero-xp-ring"
                  cx="64" cy="64" r="56"
                  fill="none"
                  stroke-width="10"
                  stroke-linecap="round"
                  stroke-dasharray="${circumference.toFixed(2)}"
                  stroke-dashoffset="${circumference.toFixed(2)}"
                  data-target="${offset.toFixed(2)}"
                  style="transform:rotate(-90deg);transform-origin:50% 50%"/>
        </svg>
        <div class="${CSS.HERO_RING_LABEL}">
          <span class="${CSS.HERO_RING_LEVEL}">Lv ${s.level}</span>
          <span class="${CSS.HERO_RING_XP}">${s.xp.toLocaleString()} XP</span>
        </div>
      </div>

      <div class="${CSS.HERO_STATS}" role="list" aria-label="Learning highlights">
        <div class="${CSS.HERO_STAT}" role="listitem">
          <span class="${CSS.HERO_STAT_VALUE}">${s.tutorials.completed}</span>
          <span class="${CSS.HERO_STAT_LABEL}">Tutorials</span>
        </div>
        <div class="${CSS.HERO_STAT}" role="listitem">
          <span class="${CSS.HERO_STAT_VALUE}">${s.streak.current}</span>
          <span class="${CSS.HERO_STAT_LABEL}">Day Streak</span>
        </div>
        <div class="${CSS.HERO_STAT}" role="listitem">
          <span class="${CSS.HERO_STAT_VALUE}">${s.achievements.unlocked}</span>
          <span class="${CSS.HERO_STAT_LABEL}">Badges</span>
        </div>
      </div>
    `;
  }

  /**
   * Render the welcome card section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderWelcome(s) {
    return `
      <section class="${CSS.WELCOME}"
               id="welcome-section"
               aria-labelledby="welcome-heading">
        ${this.#renderWelcomeInner(s)}
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderWelcomeInner(s) {
    let name = '';
    if (this.#config.store) {
      try { name = this.#config.store.getUser()?.name ?? ''; } catch { /* ignore */ }
    }

    const greet   = greeting();
    const streak  = s.streak.current;
    const today   = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    const motivations = [
      'Every expert was once a beginner. You\'re building your AI future.',
      `${streak} days of learning — consistency is your superpower.`,
      'The best time to learn AI was yesterday. The second best time is now.',
      'You\'re closer to your AI goals than you were yesterday.',
      'Data is the new oil. You\'re learning to refine it.',
    ];
    const motivation = streak >= 3
      ? `${streak} days strong — your consistency is building real expertise.`
      : motivations[new Date().getDate() % motivations.length];

    return `
      <div class="${CSS.WELCOME_INNER}">
        <div>
          <h2 class="${CSS.WELCOME_GREETING}" id="welcome-heading">
            ${escapeHtml(greet)}${name ? `, ${escapeHtml(name)}` : ''}!
          </h2>
          <p class="${CSS.WELCOME_MSG}">${escapeHtml(motivation)}</p>
          <p class="${CSS.WELCOME_DATE}">${escapeHtml(today)}</p>
        </div>
        <div class="${CSS.WELCOME_STREAK}"
             aria-label="${streak} day learning streak">
          <span class="${CSS.WELCOME_FLAME}" aria-hidden="true"
                style="color:${streak > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)'}">
            🔥
          </span>
          <span style="font-size:var(--text-2xl);font-weight:var(--font-bold)">
            ${streak}
          </span>
          <span style="color:var(--color-text-secondary);font-size:var(--text-sm)">
            day streak
          </span>
        </div>
      </div>
    `;
  }

  /**
   * Render the Continue Learning section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderContinueLearning(s) {
    return `
      <section class="${CSS.SECTION}"
               id="continue-section"
               aria-labelledby="continue-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">
              Continue Learning
            </h2>
          </div>
          ${this.#renderContinueLearningInner(s)}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderContinueLearningInner(s) {
    const items = [];

    // Most recent in-progress tutorial
    const inProgressTutorials = Object.values(s.tutorials.records)
      .filter((t) => t.startedAt && !t.completedAt)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressTutorials.length > 0) {
      const t = inProgressTutorials[0];
      items.push({
        icon:    '📖',
        title:   t.title ?? t.id ?? 'Tutorial',
        meta:    `Section ${(t.lastSection ?? 0) + 1} · ${relativeTime(t.startedAt)}`,
        pct:     0,
        action:  'resume-tutorial',
        payload: { id: t.id },
        accent:  'var(--color-primary)',
      });
    }

    // Most recently attempted quiz
    const quizzes = Object.values(s.quizzes.records)
      .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));

    if (quizzes.length > 0) {
      const q = quizzes[0];
      const qPct = q.totalQuestions > 0
        ? Math.round((q.bestScore / q.totalQuestions) * 100)
        : 0;
      items.push({
        icon:    '✏️',
        title:   q.title ?? q.id ?? 'Quiz',
        meta:    `${q.attempts} attempt${q.attempts !== 1 ? 's' : ''} · Best: ${qPct}%`,
        pct:     qPct,
        action:  'resume-quiz',
        payload: { id: q.id },
        accent:  'var(--color-success)',
      });
    }

    // In-progress project
    const inProgressProjects = Object.values(s.projects.records)
      .filter((p) => p.state === 'in-progress')
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressProjects.length > 0) {
      const p = inProgressProjects[0];
      items.push({
        icon:    '🔧',
        title:   p.title ?? p.id ?? 'Project',
        meta:    `In progress · ${relativeTime(p.startedAt)}`,
        pct:     0,
        action:  'resume-project',
        payload: { id: p.id },
        accent:  'var(--color-accent)',
      });
    }

    if (items.length === 0) {
      return `
        <div class="${CSS.SECTION_INNER}" style="text-align:center;padding:var(--space-12) 0">
          <p style="color:var(--color-text-secondary);margin-bottom:var(--space-4)">
            You haven't started any tutorials yet.
          </p>
          <button class="btn btn--primary"
                  type="button"
                  data-action="browse-tutorials"
                  aria-label="Browse all tutorials">
            Browse Tutorials
          </button>
        </div>
      `;
    }

    const cards = items.map((item) => `
      <button class="${CSS.CONTINUE_CARD}"
              type="button"
              data-action="${escapeAttr(item.action)}"
              data-payload='${escapeAttr(JSON.stringify(item.payload))}'
              aria-label="Resume: ${escapeAttr(item.title)}">
        <span class="${CSS.CONTINUE_ICON}"
              aria-hidden="true"
              style="color:${item.accent}">${escapeHtml(item.icon)}</span>
        <span class="${CSS.CONTINUE_BODY}">
          <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.CONTINUE_META}">${escapeHtml(item.meta)}</span>
          ${item.pct > 0 ? `
            <span class="${CSS.CONTINUE_PROGRESS}"
                  role="progressbar"
                  aria-valuenow="${item.pct}"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label="${item.pct}% complete">
              <span class="${CSS.CONTINUE_PROGRESS_FILL}"
                    style="width:${item.pct}%"></span>
            </span>
          ` : ''}
        </span>
        <span class="${CSS.CONTINUE_ARROW}" aria-hidden="true">›</span>
      </button>
    `).join('');

    return `<div class="${CSS.CONTINUE_GRID}">${cards}</div>`;
  }

  /**
   * Render the learning statistics section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderStatistics(s) {
    return `
      <section class="${CSS.SECTION} ${CSS.STATS}"
               id="stats-section"
               aria-labelledby="stats-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="stats-heading">
              Your Learning Stats
            </h2>
          </div>
          ${this.#renderStatisticsInner(s)}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderStatisticsInner(s) {
    const tiles = [
      {
        icon:   '📚',
        value:  s.tutorials.completed,
        label:  'Tutorials Completed',
        accent: 'var(--color-primary)',
      },
      {
        icon:   '✅',
        value:  `${s.quizzes.passed}/${s.quizzes.attempted}`,
        label:  'Quizzes Passed',
        accent: 'var(--color-success)',
      },
      {
        icon:   '🔧',
        value:  s.projects.completed,
        label:  'Projects Completed',
        accent: 'var(--color-accent)',
      },
      {
        icon:   '⭐',
        value:  s.xp.toLocaleString(),
        label:  'Total XP Earned',
        accent: 'var(--color-warning)',
      },
      {
        icon:   '🔥',
        value:  s.streak.current,
        label:  'Day Streak',
        accent: 'var(--color-danger)',
      },
      {
        icon:   '🎯',
        value:  `${s.quizzes.accuracy}%`,
        label:  'Quiz Accuracy',
        accent: 'var(--color-code)',
      },
    ];

    const tilesHtml = tiles.map((tile) => `
      <div class="${CSS.STAT_TILE}"
           role="listitem"
           aria-label="${escapeAttr(String(tile.value))} ${escapeAttr(tile.label)}">
        <span class="${CSS.STAT_ICON}" aria-hidden="true"
              style="color:${tile.accent}">${escapeHtml(tile.icon)}</span>
        <span class="${CSS.STAT_VALUE}">${escapeHtml(String(tile.value))}</span>
        <span class="${CSS.STAT_LABEL}">${escapeHtml(tile.label)}</span>
      </div>
    `).join('');

    return `<div class="${CSS.STATS_GRID}" role="list" aria-label="Learning statistics">${tilesHtml}</div>`;
  }

  /**
   * Render the featured courses section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderFeaturedCourses(s) {
    const completedIds = new Set(
      Object.entries(s.tutorials.records)
        .filter(([, t]) => t.completedAt)
        .map(([id]) => id)
    );

    const cards = FEATURED_COURSES.map((course) => {
      const isCompleted = completedIds.has(course.id);
      const pct         = isCompleted ? 100 : 0;

      const difficultyLabel = {
        beginner:     'Beginner',
        intermediate: 'Intermediate',
        advanced:     'Advanced',
      }[course.difficulty] ?? course.difficulty;

      const badgeClass = {
        beginner:     CSS.COURSE_BADGE_BEGINNER,
        intermediate: CSS.COURSE_BADGE_INTER,
        advanced:     CSS.COURSE_BADGE_ADVANCED,
      }[course.difficulty] ?? '';

      return `
        <article class="${CSS.COURSE_CARD}"
                 aria-labelledby="course-title-${escapeAttr(course.id)}">
          <div class="${CSS.COURSE_THUMB}"
               aria-hidden="true"
               style="background:${course.accent}20;color:${course.accent}">
            <span style="font-size:2.5rem">${escapeHtml(course.icon)}</span>
          </div>
          <div class="${CSS.COURSE_BODY}">
            <span class="${CSS.COURSE_BADGE} ${badgeClass}">
              ${escapeHtml(difficultyLabel)}
            </span>
            <h3 class="${CSS.COURSE_TITLE}" id="course-title-${escapeAttr(course.id)}">
              ${escapeHtml(course.title)}
            </h3>
            <p class="${CSS.COURSE_DESC}">${escapeHtml(course.desc)}</p>
            <div class="${CSS.COURSE_META}">
              <span class="${CSS.COURSE_DURATION}" aria-label="${escapeAttr(course.duration)} duration">
                🕐 ${escapeHtml(course.duration)}
              </span>
              <span class="${CSS.COURSE_LESSONS}" aria-label="${course.lessons} lessons">
                📝 ${course.lessons} lessons
              </span>
            </div>
            <div class="${CSS.COURSE_BAR}"
                 role="progressbar"
                 aria-valuenow="${pct}"
                 aria-valuemin="0"
                 aria-valuemax="100"
                 aria-label="${pct}% complete">
              <div class="${CSS.COURSE_BAR_FILL}"
                   style="width:${pct}%;background:${course.accent}">
              </div>
            </div>
            <button class="${CSS.COURSE_CTA}"
                    type="button"
                    data-action="open-course"
                    data-payload='${escapeAttr(JSON.stringify({ id: course.id, path: course.path }))}'
                    aria-label="${isCompleted ? 'Review' : 'Start'} ${escapeAttr(course.title)}"
                    style="--btn-accent:${course.accent}">
              ${isCompleted ? 'Review Course' : 'Start Course'}
            </button>
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}"
               aria-labelledby="courses-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="courses-heading">
              Featured Courses
            </h2>
            <button class="${CSS.SECTION_LINK}"
                    type="button"
                    data-action="browse-tutorials"
                    aria-label="View all courses">
              View All →
            </button>
          </div>
          <div class="${CSS.COURSES_GRID}" role="list" aria-label="Featured courses">
            ${cards}
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Render the learning paths section.
   *
   * @returns {string}
   */
  #renderLearningPaths() {
    const cards = LEARNING_PATHS.map((lp) => `
      <article class="${CSS.PATH_CARD} ${lp.cssClass}"
               aria-labelledby="path-title-${escapeAttr(lp.id)}">
        <span class="${CSS.PATH_ICON}" aria-hidden="true">${escapeHtml(lp.icon)}</span>
        <div>
          <span style="font-size:var(--text-xs);text-transform:uppercase;
                       letter-spacing:0.08em;opacity:0.7;display:block;margin-bottom:var(--space-1)">
            ${escapeHtml(lp.level)}
          </span>
          <h3 class="${CSS.PATH_TITLE}" id="path-title-${escapeAttr(lp.id)}">
            ${escapeHtml(lp.title)}
          </h3>
        </div>
        <p class="${CSS.PATH_DESC}">${escapeHtml(lp.desc)}</p>
        <ul class="${CSS.PATH_TOPICS}" aria-label="Topics covered">
          ${lp.topics.map((t) => `
            <li class="${CSS.PATH_TOPIC}">${escapeHtml(t)}</li>
          `).join('')}
        </ul>
        <p class="${CSS.PATH_COUNT}">
          ${lp.courseCount} courses · ${lp.hoursTotal}h total
        </p>
        <button class="${CSS.PATH_CTA}"
                type="button"
                data-action="open-path"
                data-payload='${escapeAttr(JSON.stringify({ id: lp.id, path: lp.path }))}'
                aria-label="Start the ${escapeAttr(lp.title)} learning path">
          Start Path →
        </button>
      </article>
    `).join('');

    return `
      <section class="${CSS.SECTION}"
               aria-labelledby="paths-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="paths-heading">
              Learning Paths
            </h2>
            <p class="${CSS.SECTION_SUBTITLE}">
              Structured programmes that take you from zero to job-ready.
            </p>
          </div>
          <div class="${CSS.PATHS_GRID}">${cards}</div>
        </div>
      </section>
    `;
  }

  /**
   * Render the daily challenge section.
   *
   * @returns {string}
   */
  #renderDailyChallenge() {
    const challenge       = CHALLENGE_POOL[todayChallengeIndex()];
    const timeRemaining   = msUntilMidnight();
    const countdownStr    = formatCountdown(timeRemaining);

    const codeLines = challenge.code
      .split('\n')
      .map((line, i) => `
        <span class="home-challenge__code-line">
          <span class="home-challenge__code-linenum" aria-hidden="true">${i + 1}</span>
          ${escapeHtml(line)}
        </span>
      `)
      .join('');

    return `
      <section class="${CSS.CHALLENGE}"
               aria-labelledby="challenge-heading">
        <div class="${CSS.CHALLENGE_INNER}">
          <div>
            <span class="${CSS.CHALLENGE_BADGE}">⚡ Daily Challenge</span>
            <h2 class="${CSS.SECTION_TITLE} ${CSS.CHALLENGE_HEADING}"
                id="challenge-heading">
              ${escapeHtml(challenge.title)}
            </h2>
            <p class="${CSS.CHALLENGE_PROMPT}">${escapeHtml(challenge.prompt)}</p>
            <pre class="${CSS.CHALLENGE_CODE}"
                 tabindex="0"
                 aria-label="Challenge starting code"><code>${codeLines}</code></pre>
            <button class="${CSS.CHALLENGE_CTA}"
                    type="button"
                    data-action="open-challenge"
                    data-payload='${escapeAttr(JSON.stringify({ index: todayChallengeIndex() }))}'
                    aria-label="Solve daily challenge and earn ${challenge.xp} XP">
              Solve Challenge — +${challenge.xp} XP
            </button>
          </div>
          <div>
            <div class="${CSS.CHALLENGE_TIMER}"
                 role="timer"
                 aria-live="off"
                 aria-label="Time remaining until next challenge">
              <span class="${CSS.CHALLENGE_TIMER_LABEL}">Resets in</span>
              <span class="${CSS.CHALLENGE_TIMER_VALUE}"
                    id="challenge-countdown">
                ${escapeHtml(countdownStr)}
              </span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Render the recent activity section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderRecentActivity(s) {
    return `
      <section class="${CSS.SECTION} ${CSS.ACTIVITY}"
               id="activity-section"
               aria-labelledby="activity-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="activity-heading">
              Recent Activity
            </h2>
          </div>
          ${this.#renderRecentActivityInner(s)}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecentActivityInner(s) {
    const items = [];

    Object.values(s.tutorials.records)
      .filter((t) => t.completedAt)
      .forEach((t) => items.push({
        ts:     t.completedAt,
        icon:   '📖',
        title:  `Completed: ${t.title ?? t.id ?? 'Tutorial'}`,
        accent: 'var(--color-primary)',
      }));

    Object.values(s.quizzes.records)
      .filter((q) => q.lastAttemptAt)
      .forEach((q) => items.push({
        ts:     q.lastAttemptAt,
        icon:   '✏️',
        title:  `Quiz: ${q.title ?? q.id} — ${Math.round((q.bestScore / q.totalQuestions) * 100)}%`,
        accent: 'var(--color-success)',
      }));

    Object.values(s.projects.records)
      .filter((p) => p.completedAt)
      .forEach((p) => items.push({
        ts:     p.completedAt,
        icon:   '🔧',
        title:  `Completed project: ${p.title ?? p.id}`,
        accent: 'var(--color-accent)',
      }));

    s.achievements.recent.slice(0, 3).forEach((a) => {
      if (a.unlockedAt) {
        items.push({
          ts:     a.unlockedAt,
          icon:   '🏆',
          title:  `Achievement: ${a.title ?? a.id}`,
          accent: 'var(--color-warning)',
        });
      }
    });

    items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const visible = items.slice(0, 8);

    if (visible.length === 0) {
      return `
        <p class="${CSS.ACTIVITY_EMPTY}">
          No activity yet. Complete your first tutorial to get started!
        </p>
      `;
    }

    const rows = visible.map((item) => `
      <li class="${CSS.ACTIVITY_ITEM}">
        <span class="${CSS.ACTIVITY_ICON}" aria-hidden="true"
              style="color:${item.accent}">${escapeHtml(item.icon)}</span>
        <span class="${CSS.ACTIVITY_BODY}">
          <span class="${CSS.ACTIVITY_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.ACTIVITY_TIME}">${relativeTime(item.ts)}</span>
        </span>
      </li>
    `).join('');

    return `
      <ul class="${CSS.ACTIVITY_LIST}"
          role="list"
          aria-label="Recent learning activity">
        ${rows}
      </ul>
    `;
  }

  /**
   * Render the achievement preview section.
   *
   * @param {object} s
   * @returns {string}
   */
  #renderAchievements(s) {
    return `
      <section class="${CSS.SECTION} ${CSS.ACHIEVEMENTS}"
               id="achievements-section"
               aria-labelledby="achievements-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="achievements-heading">
              Achievements
            </h2>
            <span>${s.achievements.unlocked} / ${s.achievements.total} unlocked</span>
          </div>
          ${this.#renderAchievementsInner(s)}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderAchievementsInner(s) {
    const unlocked = s.achievements.all.filter((a) => a.unlocked).slice(0, 8);
    const locked   = s.achievements.all.filter((a) => !a.unlocked).slice(0, 4);

    const unlockedHtml = unlocked.map((a) => `
      <div class="${CSS.ACHIEVEMENT_BADGE}"
           role="listitem"
           aria-label="${escapeAttr(a.title)}: ${escapeAttr(a.description)}">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">
          ${escapeHtml(a.icon ?? '🏅')}
        </span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">${escapeHtml(a.title)}</span>
      </div>
    `).join('');

    const lockedHtml = locked.map(() => `
      <div class="${CSS.ACHIEVEMENT_BADGE} ${CSS.ACHIEVEMENT_LOCKED}"
           role="listitem"
           aria-label="Locked achievement">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">🔒</span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">Locked</span>
      </div>
    `).join('');

    const allHtml = unlockedHtml + lockedHtml;

    if (!allHtml) {
      return `
        <p style="color:var(--color-text-secondary)">
          Complete tutorials and quizzes to unlock your first achievement!
        </p>
      `;
    }

    return `
      <div class="${CSS.ACHIEVEMENT_GRID}"
           role="list"
           aria-label="Achievements">
        ${allHtml}
      </div>
    `;
  }

  /**
   * Render the quick actions section.
   *
   * @returns {string}
   */
  #renderQuickActions() {
    const cards = QUICK_ACTIONS.map((qa) => `
      <button class="${CSS.ACTION_CARD}"
              type="button"
              data-action="${escapeAttr(qa.action)}"
              data-payload='${escapeAttr(JSON.stringify({ path: qa.path }))}'
              aria-label="${escapeAttr(qa.label)}: ${escapeAttr(qa.desc)}">
        <span class="${CSS.ACTION_ICON}"
              aria-hidden="true"
              style="color:${qa.accent}">${escapeHtml(qa.icon)}</span>
        <span class="${CSS.ACTION_LABEL}">${escapeHtml(qa.label)}</span>
        <span class="${CSS.ACTION_DESC}">${escapeHtml(qa.desc)}</span>
      </button>
    `).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.ACTIONS}"
               aria-labelledby="actions-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="actions-heading">Quick Actions</h2>
          </div>
          <div class="${CSS.ACTIONS_GRID}">${cards}</div>
        </div>
      </section>
    `;
  }

  /**
   * Render the AI playground preview section.
   *
   * @returns {string}
   */
  #renderPlayground() {
    const codeHtml = PLAYGROUND_SAMPLE.code
      .map((line) => `<span class="home-playground__code-line">${escapeHtml(line)}</span>`)
      .join('\n');

    const outputHtml = PLAYGROUND_SAMPLE.output
      .map((line) => `<span class="${CSS.PLAYGROUND_OUTPUT_LINE}">${escapeHtml(line)}</span>`)
      .join('\n');

    return `
      <section class="${CSS.PLAYGROUND}"
               aria-labelledby="playground-heading">
        <div class="${CSS.PLAYGROUND_INNER}">
          <div class="${CSS.PLAYGROUND_CONTENT}">
            <span style="font-size:var(--text-xs);text-transform:uppercase;
                         letter-spacing:0.08em;color:var(--color-accent);
                         font-weight:var(--font-semibold)">
              ⌨️ Interactive Playground
            </span>
            <h2 class="${CSS.PLAYGROUND_HEADING}" id="playground-heading">
              Write Real Python in Your Browser
            </h2>
            <p class="${CSS.PLAYGROUND_SUB}">
              The Python for AI playground runs directly in your browser using
              Pyodide — zero setup required. Experiment with NumPy, Pandas, scikit-learn,
              and more without installing anything.
            </p>
            <button class="${CSS.PLAYGROUND_CTA}"
                    type="button"
                    data-action="open-playground"
                    aria-label="Open the Python AI playground">
              Open Playground →
            </button>
          </div>
          <div class="${CSS.PLAYGROUND_EDITOR}"
               aria-label="Example Python code in the playground"
               aria-hidden="true">
            <div class="${CSS.PLAYGROUND_TOPBAR}">
              <span class="${CSS.PLAYGROUND_DOT}" style="background:#ff5f56"></span>
              <span class="${CSS.PLAYGROUND_DOT}" style="background:#ffbd2e"></span>
              <span class="${CSS.PLAYGROUND_DOT}" style="background:#27c93f"></span>
              <span class="${CSS.PLAYGROUND_FILENAME}">${escapeHtml(PLAYGROUND_SAMPLE.filename)}</span>
            </div>
            <pre class="${CSS.PLAYGROUND_CODE}"><code>${codeHtml}</code></pre>
            <div class="${CSS.PLAYGROUND_OUTPUT}">
              <pre><code>${outputHtml}</code></pre>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Render the footer newsletter CTA section.
   *
   * @returns {string}
   */
  #renderFooterCTA() {
    return `
      <section class="${CSS.FOOTER_CTA}"
               aria-labelledby="footer-cta-heading">
        <div class="${CSS.FOOTER_CTA_INNER}">
          <div>
            <h2 class="${CSS.FOOTER_CTA_HEADING}" id="footer-cta-heading">
              Stay ahead of the AI curve.
            </h2>
            <p class="${CSS.FOOTER_CTA_SUB}">
              Get weekly Python tips, new tutorial announcements, and AI project ideas
              delivered to your inbox.
            </p>
          </div>
          <div class="${CSS.FOOTER_CTA_FORM}"
               role="form"
               aria-label="Newsletter sign-up">
            <label for="home-newsletter-email" class="sr-only">
              Email address
            </label>
            <input class="${CSS.FOOTER_CTA_INPUT}"
                   id="home-newsletter-email"
                   type="email"
                   name="email"
                   placeholder="you@example.com"
                   autocomplete="email"
                   aria-label="Email address for newsletter"
                   aria-required="true"
                   maxlength="254">
            <button class="${CSS.FOOTER_CTA_BTN}"
                    type="button"
                    data-action="newsletter-subscribe"
                    aria-label="Subscribe to the newsletter">
              Subscribe
            </button>
          </div>
        </div>
      </section>
    `;
  }

  // ---- Private: animations -------------------------------------------------

  /**
   * Animate the hero XP ring fill from 0 to the target offset.
   * Suppressed when prefers-reduced-motion is active.
   *
   * @param {object} s
   */
  #animateHeroRing(s) {
    const ring = this.#root?.querySelector('#hero-xp-ring');
    if (!ring) return;

    const target = ring.dataset.target ?? '0';

    if (prefersReducedMotion()) {
      ring.setAttribute('stroke-dashoffset', target);
      return;
    }

    // Trigger CSS transition
    ring.style.transition = 'stroke-dashoffset 1s ease-out';
    requestAnimationFrame(() => {
      ring.setAttribute('stroke-dashoffset', target);
    });
  }

  // ---- Private: challenge timer -------------------------------------------

  /**
   * Start a 1-second interval that updates the challenge countdown display.
   */
  #startChallengeTimer() {
    this.#challengeTimer = setInterval(() => {
      const el = this.#root?.querySelector('#challenge-countdown');
      if (!el) return;
      el.textContent = formatCountdown(msUntilMidnight());
    }, 1000);
  }

  // ---- Private: targeted section update -----------------------------------

  /**
   * Replace the inner HTML of a named section without re-rendering the whole page.
   *
   * @param {string} sectionId — The element's id attribute
   * @param {string} html
   */
  #updateSection(sectionId, html) {
    const el = this.#root?.querySelector(`#${sectionId}`);
    if (el) {
      el.innerHTML = html;
    }
  }

  // ---- Private: event subscriptions ----------------------------------------

  /**
   * Attach all external event listeners.
   * Every listener is stored in #cleanupFns for precise teardown.
   */
  #attachEventListeners() {
    // ── progress:updated → debounced full refresh ─────────────────────────
    const onProgressUpdated = () => this.#debouncedRefresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated)
    );

    // ── progress:xp:gained → update hero ring only ─────────────────────────
    const onXpGained = () => {
      this.#summary = getSummary(this.#config.tracker);
      this.#updateSection('hero-visual', this.#renderHeroVisual(this.#summary));
      requestAnimationFrame(() => this.#animateHeroRing(this.#summary));
    };
    document.addEventListener(PROGRESS_EVENTS.XP_GAINED, onXpGained);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.XP_GAINED, onXpGained)
    );

    // ── state:updated → refresh welcome card (user name change) ───────────
    const onStateUpdated = (e) => {
      const path = e.detail?.path;
      if (path === 'user' || path === null) {
        this.#updateSection('welcome-section', this.#renderWelcomeInner(this.#summary));
      }
      if (path === 'theme') {
        try {
          this.#theme = this.#config.store?.getTheme()?.resolvedMode ?? this.#theme;
        } catch { /* ignore */ }
        this.#root?.classList.toggle(CSS.ROOT_DARK, this.#theme === 'dark');
      }
    };
    document.addEventListener('state:updated', onStateUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener('state:updated', onStateUpdated)
    );

    // ── theme:changed → toggle dark class ─────────────────────────────────
    const onThemeChanged = (e) => {
      const resolved = e.detail?.resolvedMode ?? e.detail?.mode;
      if (resolved) {
        this.#theme = resolved;
        this.#root?.classList.toggle(CSS.ROOT_DARK, resolved === 'dark');
      }
    };
    document.addEventListener('theme:changed', onThemeChanged);
    this.#cleanupFns.push(() =>
      document.removeEventListener('theme:changed', onThemeChanged)
    );

    // ── router:afterNavigate → no-op while mounted (handled by router) ────

    // ── Click delegation on the page root ────────────────────────────────
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    // ── Newsletter form submission via Enter key ─────────────────────────
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest(`#home-newsletter-email`);
        if (input) {
          e.preventDefault();
          this.#handleNewsletterSubmit(input);
        }
      }
    };
    this.#root?.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('keydown', onKeydown));
  }

  // ---- Private: click handler ---------------------------------------------

  /**
   * Handle all delegated click events on the page.
   * Reads data-action and data-payload attributes from the closest ancestor
   * that carries them.
   *
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    let   payload = {};

    try {
      if (actionEl.dataset.payload) {
        payload = JSON.parse(actionEl.dataset.payload);
      }
    } catch { /* malformed payload — proceed with empty */ }

    switch (action) {
      case 'start-learning':
        this.#navigate('/tutorials');
        break;

      case 'open-playground':
        this.#navigate('/playground');
        break;

      case 'continue-learning':
      case 'browse-tutorials':
        this.#navigate('/tutorials');
        break;

      case 'start-quiz':
        this.#navigate('/quizzes');
        break;

      case 'view-projects':
        this.#navigate('/projects');
        break;

      case 'view-dashboard':
        this.#navigate('/dashboard');
        break;

      case 'resume-tutorial':
        this.#navigate(`/tutorials/${encodeURIComponent(payload.id ?? '')}`);
        break;

      case 'resume-quiz':
        this.#navigate(`/quizzes/${encodeURIComponent(payload.id ?? '')}`);
        break;

      case 'resume-project':
        this.#navigate(`/projects/${encodeURIComponent(payload.id ?? '')}`);
        break;

      case 'open-course':
        this.#navigate(payload.path ?? '/tutorials');
        break;

      case 'open-path':
        this.#navigate(payload.path ?? '/paths');
        break;

      case 'open-challenge':
        this.#navigate('/playground?challenge=daily');
        break;

      case 'newsletter-subscribe': {
        const input = this.#root?.querySelector('#home-newsletter-email');
        if (input) this.#handleNewsletterSubmit(input);
        break;
      }

      default:
        // Forward to event bus for external handlers
        this.#dispatch('home:action', { action, payload });
        break;
    }
  }

  /**
   * Handle newsletter form submission.
   *
   * @param {HTMLInputElement} input
   */
  #handleNewsletterSubmit(input) {
    const email = input.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.#announce('Please enter a valid email address.');
      input.focus();
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    input.removeAttribute('aria-invalid');

    this.#dispatch('home:newsletter:subscribe', { email });
    this.#announce('Thank you for subscribing! Check your inbox for a confirmation.');

    // Replace the form with a success message
    const form = input.closest(`.${CSS.FOOTER_CTA_FORM}`);
    if (form) {
      form.innerHTML = `
        <p role="status"
           aria-live="polite"
           style="color:var(--color-success);font-weight:var(--font-semibold);
                  padding:var(--space-3) 0">
          ✅ You're subscribed! Welcome to the Python for AI community.
        </p>
      `;
    }
  }

  // ---- Private: navigation helper ------------------------------------------

  /**
   * Navigate to a path using the injected router or a direct href fallback.
   *
   * @param {string} path
   */
  #navigate(path) {
    if (this.#config.router?.navigate) {
      this.#config.router.navigate(path);
    } else {
      window.location.href = path;
    }
  }

  // ---- Private: accessibility -----------------------------------------------

  /**
   * Write a message to the ARIA live region for screen reader announcement.
   * Clears first to ensure re-announcements of identical strings still fire.
   *
   * @param {string} message
   */
  #announce(message) {
    if (!this.#liveRegion) {
      this.#liveRegion = this.#root?.querySelector(`.${CSS.LIVE}`) ?? null;
    }
    if (!this.#liveRegion) return;
    this.#liveRegion.textContent = '';
    requestAnimationFrame(() => {
      if (this.#liveRegion) this.#liveRegion.textContent = message;
    });
  }

  // ---- Private: event bus ---------------------------------------------------

  /**
   * Publish an event to the platform event bus and as a native CustomEvent.
   * Consistent with all other modules in the codebase.
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