/**
 * =============================================================================
 * QUIZ CENTER PAGE MODULE
 * scripts/pages/quizzes.js
 * -----------------------------------------------------------------------------
 * Central quiz browsing and performance hub for the Python for AI educational
 * platform. Lets learners discover quizzes, track scores, monitor accuracy,
 * and launch the QuizEngine for any available quiz.
 *
 * ARCHITECTURE:
 *   QuizzesPage (default export)
 *     └─ Self-contained: reads live performance data from the injected
 *        ProgressTracker via getSummary(). A static QUIZ_CATALOGUE seeds
 *        quiz metadata (title, category, difficulty, question count),
 *        following the same self-contained-page pattern as tutorials.js,
 *        lesson-player.js, and dashboard.js. When the user starts a quiz,
 *        this page dynamically imports quiz.js and mounts a QuizEngine
 *        instance into a modal overlay — the quiz itself is never
 *        re-implemented here.
 *
 * SECTIONS (rendered in document order):
 *   1.  Hero Header           — title, subtitle, total quiz count
 *   2.  Search Bar            — live debounced search across title/tags
 *   3.  Category Filters      — chip filter by quiz category
 *   4.  Difficulty Filters    — chip filter by difficulty level
 *   5.  Featured Quiz         — single highlighted quiz banner
 *   6.  Continue Last Quiz    — resume the most recently attempted quiz
 *   7.  Quiz Grid             — paginated/infinite-scroll grid of all quizzes
 *   8.  Recent Scores         — last 5 quiz attempts with score and date
 *   9.  Performance Summary   — aggregate pass rate, average score, XP earned
 *  10.  Accuracy Statistics   — accuracy trend across categories
 *  11.  Leaderboard           — mock top learners + current user's row
 *  12.  Recommended Quizzes   — category-aware suggestions
 *  13.  Daily Challenge       — one rotating quiz-of-the-day
 *  14.  Quiz History          — full chronological attempt log
 *  15.  Completed Quizzes     — grid of all passed quizzes with best score
 *  16.  Footer Integration    — lightweight CTA bridging into the global footer
 *
 * QUIZ ENGINE INTEGRATION:
 *   Clicking Start/Resume/Retry on any quiz card dynamically imports
 *   quiz.js, constructs a QuizEngine bound to a modal overlay container,
 *   calls .load(quizData) then .start(), and listens for QUIZ_EVENTS.SUBMITTED
 *   to close the modal, refresh performance data, and record the attempt.
 *   The modal has a full focus trap and is dismissible via Escape or the
 *   close button (with an unsaved-progress confirmation while a quiz is active).
 *
 * REACTIVE UPDATES:
 *   • state:updated          → refresh theme / user-dependent regions
 *   • quiz:started           → mark quiz status "in progress" in the grid
 *   • quiz:completed         → immediate full refresh (bypasses debounce)
 *   • progress:updated       → debounced refresh of all tracker-dependent regions
 *   • theme:changed          → toggle dark-mode root class
 *   • router:afterNavigate   → re-parse URL filter params when returning to this page
 *
 * EVENT EMISSIONS:
 *   quiz:center:mounted    { pathname }
 *   quiz:center:updated    { timestamp }
 *   quiz:selected          { id, title, action }
 *   quiz:center:destroyed  { pathname }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces search result counts and quiz completion
 *   • Full focus trap inside the quiz modal; focus returns to the trigger on close
 *   • Every filter chip, card, and stat has an aria-label or visible text
 *   • Reduced motion: XP ring and modal transition are instant
 *   • Keyboard: Ctrl+K focuses search, Escape closes the modal
 *
 * PERFORMANCE:
 *   • Search is debounced at 250 ms
 *   • progress:updated is debounced at 250 ms; quiz:completed bypasses it
 *   • Quiz grid renders in pages of 12 with an IntersectionObserver sentinel
 *     for infinite scroll (virtual rendering hook)
 *   • quiz.js is dynamically imported only when a quiz is actually started
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/quizzes',
 *     title:     'Quiz Center',
 *     component: () => import('./pages/quizzes.js'),
 *   }
 *
 * EXPORTS:
 *   QuizzesPage      — primary class (default export)
 *   QUIZ_CENTER_EVENTS — event name constants
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
 * Event names emitted by the Quiz Center page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const QUIZ_CENTER_EVENTS = Object.freeze({
  MOUNTED:   'quiz:center:mounted',
  UPDATED:   'quiz:center:updated',
  SELECTED:  'quiz:selected',
  DESTROYED: 'quiz:center:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Quiz cards rendered per infinite-scroll page */
const PAGE_SIZE = 12;

/** Search debounce delay (ms) */
const SEARCH_DEBOUNCE_MS = 250;

/** progress:updated debounce delay (ms) */
const REFRESH_DEBOUNCE_MS = 250;

/** localStorage key prefix for bookmarked quiz IDs */
const BOOKMARK_KEY = 'pyai-quiz-bookmarks';

/** localStorage key prefix for favourited quiz IDs */
const FAVOURITE_KEY = 'pyai-quiz-favourites';

/** Quiz pass threshold, mirrored from quiz.js for local pct display only */
const PASS_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Static quiz catalogue
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string, title: string, description: string, category: string,
 *   difficulty: 'beginner'|'intermediate'|'advanced', questionCount: number,
 *   estimatedMinutes: number, xpReward: number, icon: string, accent: string,
 *   isFeatured: boolean, tags: string[], popularityScore: number,
 * }} QuizMeta
 */

/** @type {ReadonlyArray<QuizMeta>} */
const QUIZ_CATALOGUE = Object.freeze([
  { id: 'python-variables-quiz',  title: 'Variables & Data Types',    description: 'Test your grasp of Python variables, types, and coercion.', category: 'python',           difficulty: 'beginner',     questionCount: 10, estimatedMinutes: 8,  xpReward: 60,  icon: '📦', accent: 'var(--color-success)', isFeatured: true,  tags: ['python','variables'],        popularityScore: 96 },
  { id: 'python-functions-quiz',  title: 'Functions & Scope',          description: 'Closures, default args, and the LEGB scope rule.',          category: 'python',           difficulty: 'beginner',     questionCount: 10, estimatedMinutes: 9,  xpReward: 60,  icon: '⚙️', accent: 'var(--color-primary)', isFeatured: false, tags: ['python','functions'],        popularityScore: 88 },
  { id: 'python-oop-quiz',        title: 'Object-Oriented Python',     description: 'Classes, inheritance, and dunder methods.',                 category: 'python',           difficulty: 'intermediate', questionCount: 12, estimatedMinutes: 12, xpReward: 75,  icon: '🏛️', accent: 'var(--color-accent)',  isFeatured: false, tags: ['python','oop'],              popularityScore: 82 },
  { id: 'numpy-basics-quiz',      title: 'NumPy Fundamentals',         description: 'Arrays, broadcasting, and vectorised operations.',          category: 'data-science',     difficulty: 'beginner',     questionCount: 10, estimatedMinutes: 9,  xpReward: 65,  icon: '🔢', accent: 'var(--color-primary)', isFeatured: false, tags: ['numpy','arrays'],            popularityScore: 91 },
  { id: 'pandas-quiz',            title: 'Pandas DataFrames',          description: 'Filtering, groupby, and DataFrame manipulation.',           category: 'data-science',     difficulty: 'intermediate', questionCount: 12, estimatedMinutes: 12, xpReward: 75,  icon: '📊', accent: 'var(--color-warning)', isFeatured: true,  tags: ['pandas','dataframes'],       popularityScore: 94 },
  { id: 'ml-regression-quiz',     title: 'Linear & Logistic Regression', description: 'Gradient descent, loss functions, and evaluation.',       category: 'machine-learning', difficulty: 'intermediate', questionCount: 12, estimatedMinutes: 13, xpReward: 80,  icon: '📉', accent: 'var(--color-accent)',  isFeatured: false, tags: ['ml','regression'],           popularityScore: 87 },
  { id: 'ml-classification-quiz', title: 'Classification Algorithms',  description: 'Decision trees, SVMs, k-NN, and random forests.',           category: 'machine-learning', difficulty: 'intermediate', questionCount: 12, estimatedMinutes: 13, xpReward: 80,  icon: '🌳', accent: 'var(--color-success)', isFeatured: false, tags: ['ml','classification'],       popularityScore: 84 },
  { id: 'neural-networks-quiz',   title: 'Neural Network Basics',      description: 'Perceptrons, activations, and backpropagation.',            category: 'deep-learning',    difficulty: 'advanced',     questionCount: 14, estimatedMinutes: 15, xpReward: 95,  icon: '🧠', accent: 'var(--color-danger)',  isFeatured: true,  tags: ['deep-learning','nn'],        popularityScore: 93 },
  { id: 'cnn-quiz',               title: 'Convolutional Networks',     description: 'Filters, pooling, and image classification architectures.', category: 'deep-learning',    difficulty: 'advanced',     questionCount: 14, estimatedMinutes: 15, xpReward: 95,  icon: '🖼️', accent: 'var(--color-accent)',  isFeatured: false, tags: ['cnn','vision'],              popularityScore: 85 },
  { id: 'transformers-quiz',      title: 'Attention & Transformers',   description: 'Self-attention, multi-head attention, and encodings.',      category: 'nlp',              difficulty: 'advanced',     questionCount: 14, estimatedMinutes: 16, xpReward: 100, icon: '🔄', accent: 'var(--color-primary)', isFeatured: false, tags: ['nlp','transformers'],        popularityScore: 97 },
  { id: 'sentiment-quiz',         title: 'Sentiment Analysis',         description: 'Tokenisation, TF-IDF, and text classification basics.',     category: 'nlp',              difficulty: 'intermediate', questionCount: 10, estimatedMinutes: 10, xpReward: 70,  icon: '😊', accent: 'var(--color-warning)', isFeatured: false, tags: ['nlp','sentiment'],           popularityScore: 79 },
  { id: 'time-series-quiz',       title: 'Time Series Forecasting',    description: 'ARIMA, seasonality, and forecasting fundamentals.',         category: 'machine-learning', difficulty: 'advanced',     questionCount: 12, estimatedMinutes: 14, xpReward: 90,  icon: '⏱️', accent: 'var(--color-primary)', isFeatured: false, tags: ['time-series'],               popularityScore: 74 },
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:               'qc-page',
  ROOT_DARK:          'qc-page--dark',
  ROOT_REDUCED:       'qc-page--reduced-motion',
  LIVE:               'qc-page__live',

  HERO:               'qc-hero',
  HERO_TITLE:         'qc-hero__title',
  HERO_SUB:           'qc-hero__sub',
  HERO_COUNT:         'qc-hero__count',

  CONTROLS:           'qc-controls',
  SEARCH_WRAP:        'qc-controls__search-wrap',
  SEARCH_INPUT:       'qc-controls__search-input',
  SEARCH_CLEAR:       'qc-controls__search-clear',

  FILTERS:            'qc-filters',
  FILTER_GROUP:       'qc-filters__group',
  FILTER_LABEL:       'qc-filters__label',
  FILTER_CHIPS:       'qc-filters__chips',
  FILTER_CHIP:        'qc-filters__chip',
  FILTER_CHIP_ACTIVE: 'qc-filters__chip--active',

  SECTION:            'qc-section',
  SECTION_INNER:      'qc-section__inner',
  SECTION_HEADER:     'qc-section__header',
  SECTION_TITLE:      'qc-section__title',

  FEATURED:           'qc-featured',
  FEATURED_ICON:      'qc-featured__icon',
  FEATURED_TITLE:     'qc-featured__title',
  FEATURED_DESC:      'qc-featured__desc',
  FEATURED_META:      'qc-featured__meta',
  FEATURED_CTA:       'qc-featured__cta',

  CONTINUE_CARD:      'qc-continue__card',
  CONTINUE_ICON:      'qc-continue__icon',
  CONTINUE_BODY:      'qc-continue__body',
  CONTINUE_TITLE:     'qc-continue__title',
  CONTINUE_META:      'qc-continue__meta',

  GRID:               'qc-grid',
  CARD:               'qc-card',
  CARD_BADGE_DIFF:    'qc-card__badge-diff',
  CARD_BADGE_BEG:     'qc-card__badge-diff--beginner',
  CARD_BADGE_INT:     'qc-card__badge-diff--intermediate',
  CARD_BADGE_ADV:     'qc-card__badge-diff--advanced',
  CARD_ACTIONS:       'qc-card__actions',
  CARD_BTN_BOOKMARK:  'qc-card__btn-bookmark',
  CARD_BTN_BOOKMARK_ON: 'qc-card__btn-bookmark--active',
  CARD_BTN_FAV:       'qc-card__btn-fav',
  CARD_BTN_FAV_ON:    'qc-card__btn-fav--active',
  CARD_ICON:          'qc-card__icon',
  CARD_TITLE:         'qc-card__title',
  CARD_DESC:          'qc-card__desc',
  CARD_META:          'qc-card__meta',
  CARD_BEST:          'qc-card__best',
  CARD_CTA:           'qc-card__cta',
  SENTINEL:           'qc-sentinel',
  LOAD_MORE:          'qc-load-more',
  EMPTY:              'qc-empty',

  RECENT_LIST:        'qc-recent__list',
  RECENT_ITEM:        'qc-recent__item',
  RECENT_ICON:        'qc-recent__icon',
  RECENT_BODY:        'qc-recent__body',
  RECENT_TITLE:       'qc-recent__title',
  RECENT_META:        'qc-recent__meta',
  RECENT_SCORE:       'qc-recent__score',
  RECENT_SCORE_PASS:  'qc-recent__score--pass',
  RECENT_SCORE_FAIL:  'qc-recent__score--fail',

  PERF_GRID:          'qc-perf__grid',
  PERF_TILE:          'qc-perf__tile',
  PERF_VALUE:         'qc-perf__value',
  PERF_LABEL:         'qc-perf__label',

  ACCURACY_LIST:      'qc-accuracy__list',
  ACCURACY_ITEM:      'qc-accuracy__item',
  ACCURACY_LABEL:     'qc-accuracy__label',
  ACCURACY_BAR:       'qc-accuracy__bar',
  ACCURACY_BAR_FILL:  'qc-accuracy__bar-fill',
  ACCURACY_PCT:       'qc-accuracy__pct',

  LEADERBOARD_LIST:   'qc-leaderboard__list',
  LEADERBOARD_ITEM:   'qc-leaderboard__item',
  LEADERBOARD_ITEM_ME:'qc-leaderboard__item--me',
  LEADERBOARD_RANK:   'qc-leaderboard__rank',
  LEADERBOARD_NAME:   'qc-leaderboard__name',
  LEADERBOARD_SCORE:  'qc-leaderboard__score',
  LEADERBOARD_NOTE:   'qc-leaderboard__note',

  RECOMMEND_GRID:     'qc-recommend__grid',
  RECOMMEND_CARD:     'qc-recommend__card',

  CHALLENGE:          'qc-challenge',
  CHALLENGE_BADGE:    'qc-challenge__badge',
  CHALLENGE_TITLE:    'qc-challenge__title',
  CHALLENGE_DESC:     'qc-challenge__desc',
  CHALLENGE_CTA:      'qc-challenge__cta',

  HISTORY_LIST:       'qc-history__list',
  HISTORY_ITEM:       'qc-history__item',
  HISTORY_META:       'qc-history__meta',

  COMPLETED_GRID:     'qc-completed__grid',
  COMPLETED_CARD:     'qc-completed__card',

  FOOTER_CTA:         'qc-footer-cta',
  FOOTER_CTA_INNER:   'qc-footer-cta__inner',
  FOOTER_CTA_BTN:     'qc-footer-cta__btn',

  MODAL_OVERLAY:      'qc-modal-overlay',
  MODAL:              'qc-modal',
  MODAL_HEADER:       'qc-modal__header',
  MODAL_TITLE:        'qc-modal__title',
  MODAL_CLOSE:        'qc-modal__close',
  MODAL_BODY:         'qc-modal__body',
});

// ---------------------------------------------------------------------------
// Pure utilities (module-private)
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
 * @returns {Function & { cancel: () => void, flush: () => void }}
 */
function debounce(fn, ms) {
  let timer    = null;
  let lastArgs = null;
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; const a = lastArgs; lastArgs = null; fn(...a); }, ms);
  };
  d.cancel = () => { clearTimeout(timer); timer = null; lastArgs = null; };
  d.flush  = () => {
    if (timer !== null) {
      clearTimeout(timer); timer = null;
      const a = lastArgs; lastArgs = null;
      if (a) fn(...a);
    }
  };
  return d;
}

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * @param {number} ts
 * @returns {string}
 */
function relativeTime(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7)   return `${d} days ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/**
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Compute the index of today's daily challenge quiz (rotates by day of year).
 * @returns {number}
 */
function todayChallengeIndex() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86_400_000);
  return dayOfYear % QUIZ_CATALOGUE.length;
}

/**
 * Safe localStorage read of a JSON-encoded string array.
 * @param {string} key
 * @returns {Set<string>}
 */
function loadIdSet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/**
 * @param {string}    key
 * @param {Set<string>} set
 */
function saveIdSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* quota */ }
}

/**
 * Return a zero-state summary matching ProgressTracker.getSummary()'s shape.
 * @returns {object}
 */
function emptySummary() {
  return {
    xp: 0, level: 1,
    quizzes: { attempted: 0, passed: 0, accuracy: 0, pct: 0, records: {} },
    achievements: { unlocked: 0, total: 33, recent: [], all: [] },
  };
}

/**
 * @param {object|null} tracker
 * @returns {object}
 */
function getSummary(tracker) {
  if (!tracker?.getSummary) return emptySummary();
  try {
    const s = tracker.getSummary();
    return s && typeof s === 'object' ? s : emptySummary();
  } catch {
    return emptySummary();
  }
}

/**
 * @returns {{ search: string, category: string, difficulty: string, sort: string }}
 */
function defaultFilter() {
  return { search: '', category: 'all', difficulty: 'all', sort: 'recommended' };
}

/** @type {ReadonlyArray<{ value: string, label: string }>} */
const CATEGORIES = Object.freeze([
  { value: 'all',              label: 'All'              },
  { value: 'python',           label: 'Python'           },
  { value: 'data-science',     label: 'Data Science'     },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'deep-learning',    label: 'Deep Learning'    },
  { value: 'nlp',              label: 'NLP'              },
]);

/** @type {ReadonlyArray<{ value: string, label: string }>} */
const DIFFICULTIES = Object.freeze([
  { value: 'all',          label: 'All Levels'   },
  { value: 'beginner',     label: 'Beginner'     },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced'     },
]);

/** @type {Readonly<Record<string, string>>} */
const LEADERBOARD_SEED = Object.freeze({
  entries: [
    { name: 'Grace H.', score: 4820 },
    { name: 'Alan T.',  score: 4390 },
    { name: 'Margaret W.', score: 3950 },
  ],
});

// ---------------------------------------------------------------------------
// QuizzesPage — primary class
// ---------------------------------------------------------------------------

/**
 * Quiz Center page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve theme, parse URL filters, fetch summary
 *   3. mount()               — render, attach events, start scroll observer
 *   4. refresh()             — re-fetch tracker data, patch dynamic regions
 *   5. destroy()             — teardown listeners, observers, modal, DOM
 */
export default class QuizzesPage {

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

  // ---- State ---------------------------------------------------------------

  /** @type {boolean} */ #mounted   = false;
  /** @type {boolean} */ #destroyed = false;
  /** @type {string}  */ #theme     = 'light';

  /** @type {object} */ #summary = emptySummary();

  /** @type {{ search: string, category: string, difficulty: string, sort: string }} */
  #filter = defaultFilter();

  /** @type {QuizMeta[]} — result of applying #filter to QUIZ_CATALOGUE */
  #filtered = [...QUIZ_CATALOGUE];

  /** @type {Set<string>} */ #bookmarks  = loadIdSet(BOOKMARK_KEY);
  /** @type {Set<string>} */ #favourites = loadIdSet(FAVOURITE_KEY);

  /** @type {number} */ #loadedPages = 1;

  /** @type {import('../components/quiz.js').default|null} — active QuizEngine instance */
  #activeEngine = null;

  /** @type {HTMLElement|null} */ #activeModal = null;

  /** @type {HTMLElement|null} */ #modalTrigger = null;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}          */ #root           = null;
  /** @type {HTMLElement|null}          */ #liveRegion     = null;
  /** @type {HTMLInputElement|null}     */ #searchInput    = null;
  /** @type {IntersectionObserver|null} */ #scrollObserver = null;

  // ---- Debounced handlers ---------------------------------------------------

  /** @type {Function & { cancel: () => void }} */
  #debouncedSearch;

  /** @type {Function & { cancel: () => void }} */
  #debouncedRefresh;

  // ---- Cleanup references ---------------------------------------------------

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

    this.#debouncedSearch  = debounce(() => this.#applyFilters(), SEARCH_DEBOUNCE_MS);
    this.#debouncedRefresh = debounce(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new QuizzesPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker ?? null,
      router:      ctx?.meta?.router  ?? null,
      store:       ctx?.meta?.store   ?? null,
    });
    outlet.__quizzesPage = instance;
    instance.#root        = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__quizzesPage?.destroy();
    delete outlet.__quizzesPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve theme, parse URL filter params, fetch the initial summary.
   *
   * @returns {QuizzesPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    this.#parseUrlParams();
    this.#summary = getSummary(this.#config.tracker);
    this.#computeFilteredList();

    return this;
  }

  /**
   * Render the page and attach all listeners.
   *
   * @returns {QuizzesPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[QuizzesPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.render();
    this.#attachEventListeners();
    this.#attachScrollObserver();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#searchInput = this.#root?.querySelector(`.${CSS.SEARCH_INPUT}`) ?? null;
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(QUIZ_CENTER_EVENTS.MOUNTED, { pathname: '/quizzes' });
    this.#announce('Quiz Center loaded.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {QuizzesPage} this
   */
  render() {
    if (!this.#root) return this;

    const isDark  = this.#theme === 'dark';
    const reduced = prefersReducedMotion();

    this.#root.className = [
      CSS.ROOT,
      isDark  ? CSS.ROOT_DARK    : '',
      reduced ? CSS.ROOT_REDUCED : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', 'Quiz Center');

    const s = this.#summary;

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      ${this.#renderHero()}
      ${this.#renderControlsBar()}
      ${this.#renderFilterChips()}
      ${this.#renderFeaturedQuiz()}
      <div id="qc-continue-region">${this.#renderContinueLastQuiz(s)}</div>

      <div id="qc-grid-region">${this.#renderQuizGrid()}</div>

      <div id="qc-recent-region">${this.#renderRecentScores(s)}</div>
      <div id="qc-perf-region">${this.#renderPerformanceSummary(s)}</div>
      <div id="qc-accuracy-region">${this.#renderAccuracyStatistics(s)}</div>
      <div id="qc-leaderboard-region">${this.#renderLeaderboard(s)}</div>
      <div id="qc-recommend-region">${this.#renderRecommendedQuizzes(s)}</div>

      ${this.#renderDailyChallenge()}

      <div id="qc-history-region">${this.#renderQuizHistory(s)}</div>
      <div id="qc-completed-region">${this.#renderCompletedQuizzes(s)}</div>

      ${this.#renderFooterCTA()}
    `;

    this.#liveRegion  = this.#root.querySelector(`.${CSS.LIVE}`);
    this.#searchInput = this.#root.querySelector(`.${CSS.SEARCH_INPUT}`);

    if (this.#searchInput && this.#filter.search) {
      this.#searchInput.value = this.#filter.search;
    }

    return this;
  }

  /**
   * Re-fetch tracker data and patch every dynamic region.
   *
   * @returns {QuizzesPage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    this.#summary = getSummary(this.#config.tracker);
    const s = this.#summary;

    this.#replaceRegion('qc-continue-region',    this.#renderContinueLastQuiz(s));
    this.#replaceRegion('qc-grid-region',        this.#renderQuizGrid());
    this.#replaceRegion('qc-recent-region',      this.#renderRecentScores(s));
    this.#replaceRegion('qc-perf-region',        this.#renderPerformanceSummary(s));
    this.#replaceRegion('qc-accuracy-region',    this.#renderAccuracyStatistics(s));
    this.#replaceRegion('qc-leaderboard-region', this.#renderLeaderboard(s));
    this.#replaceRegion('qc-recommend-region',   this.#renderRecommendedQuizzes(s));
    this.#replaceRegion('qc-history-region',     this.#renderQuizHistory(s));
    this.#replaceRegion('qc-completed-region',   this.#renderCompletedQuizzes(s));

    this.#dispatch(QUIZ_CENTER_EVENTS.UPDATED, { timestamp: Date.now() });
    return this;
  }

  /**
   * Tear down all listeners, observers, the active modal, and DOM.
   *
   * @returns {QuizzesPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedSearch.cancel();
    this.#debouncedRefresh.cancel();

    this.#scrollObserver?.disconnect();
    this.#scrollObserver = null;

    this.#closeModal(true);

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    if (this.#root) {
      this.#root.innerHTML = '';
      this.#root.className = '';
      this.#root.removeAttribute('role');
      this.#root.removeAttribute('aria-label');
    }

    this.#mounted   = false;
    this.#destroyed = true;

    this.#dispatch(QUIZ_CENTER_EVENTS.DESTROYED, { pathname: '/quizzes' });
    return this;
  }

  // ---- Private: rendering — hero / controls / filters ----------------------

  /**
   * @returns {string}
   */
  #renderHero() {
    return `
      <header class="${CSS.HERO}">
        <h1 tabindex="-1">Quiz Center</h1>
        <p class="${CSS.HERO_SUB}">
          Test your knowledge, track your accuracy, and level up your Python AI skills.
        </p>
        <span class="${CSS.HERO_COUNT}" id="qc-count-label" aria-live="polite">
          ${this.#filtered.length} of ${QUIZ_CATALOGUE.length} quizzes
        </span>
      </header>
    `;
  }

  /**
   * @returns {string}
   */
  #renderControlsBar() {
    const sortOptions = [
      { value: 'recommended',  label: 'Recommended'   },
      { value: 'newest',       label: 'Newest'        },
      { value: 'popular',      label: 'Most Popular'  },
      { value: 'quick',        label: 'Quickest First'},
      { value: 'alpha',        label: 'A → Z'         },
    ].map((o) => `
      <option value="${escapeAttr(o.value)}" ${this.#filter.sort === o.value ? 'selected' : ''}>
        ${escapeHtml(o.label)}
      </option>
    `).join('');

    return `
      <div class="${CSS.CONTROLS}" role="search" aria-label="Quiz search and sort">
        <div class="${CSS.SEARCH_WRAP}">
          <span aria-hidden="true">🔍</span>
          <input class="${CSS.SEARCH_INPUT}"
                 id="qc-search"
                 type="search"
                 placeholder="Search quizzes or tags…"
                 autocomplete="off"
                 spellcheck="false"
                 aria-label="Search quizzes"
                 aria-controls="qc-grid-region"
                 value="${escapeAttr(this.#filter.search)}">
          ${this.#filter.search ? `
            <button class="${CSS.SEARCH_CLEAR}" type="button" data-action="clear-search"
                    aria-label="Clear search">✕</button>
          ` : ''}
        </div>
        <label for="qc-sort" class="sr-only">Sort quizzes</label>
        <select id="qc-sort" aria-label="Sort quizzes" data-action="sort">
          ${sortOptions}
        </select>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFilterChips() {
    const catChips = CATEGORIES.map((c) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.category === c.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="filter-category"
              data-value="${escapeAttr(c.value)}"
              aria-pressed="${this.#filter.category === c.value}"
              aria-label="Category: ${escapeAttr(c.label)}">
        ${escapeHtml(c.label)}
      </button>
    `).join('');

    const diffChips = DIFFICULTIES.map((d) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.difficulty === d.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="filter-difficulty"
              data-value="${escapeAttr(d.value)}"
              aria-pressed="${this.#filter.difficulty === d.value}"
              aria-label="Difficulty: ${escapeAttr(d.label)}">
        ${escapeHtml(d.label)}
      </button>
    `).join('');

    return `
      <div class="${CSS.FILTERS}" aria-label="Quiz filters">
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="qc-cat-label">Category</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="qc-cat-label">${catChips}</div>
        </div>
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="qc-diff-label">Difficulty</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="qc-diff-label">${diffChips}</div>
        </div>
      </div>
    `;
  }

  // ---- Private: rendering — featured / continue -----------------------------

  /**
   * @returns {string}
   */
  #renderFeaturedQuiz() {
    const quiz = QUIZ_CATALOGUE.find((q) => q.isFeatured) ?? QUIZ_CATALOGUE[0];
    if (!quiz) return '';

    return `
      <section class="${CSS.SECTION} ${CSS.FEATURED}" aria-labelledby="featured-heading">
        <span class="${CSS.FEATURED_ICON}" aria-hidden="true" style="color:${quiz.accent}">${escapeHtml(quiz.icon)}</span>
        <h2 class="${CSS.FEATURED_TITLE}" id="featured-heading">${escapeHtml(quiz.title)}</h2>
        <p class="${CSS.FEATURED_DESC}">${escapeHtml(quiz.description)}</p>
        <p class="${CSS.FEATURED_META}">${quiz.questionCount} questions · ${quiz.estimatedMinutes} min · +${quiz.xpReward} XP</p>
        <button class="${CSS.FEATURED_CTA}"
                type="button"
                data-action="start-quiz"
                data-id="${escapeAttr(quiz.id)}"
                aria-label="Start featured quiz: ${escapeAttr(quiz.title)}">
          Start Featured Quiz
        </button>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderContinueLastQuiz(s) {
    const lastEntry = Object.entries(s.quizzes.records)
      .sort(([, a], [, b]) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0];

    if (!lastEntry) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="continue-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Last Quiz</h2>
          </div>
          <p class="${CSS.EMPTY}">Take your first quiz to see it here next time.</p>
        </section>
      `;
    }

    const [id, record] = lastEntry;
    const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
    const pct  = record.totalQuestions ? Math.round((record.bestScore / record.totalQuestions) * 100) : 0;

    return `
      <section class="${CSS.SECTION}" aria-labelledby="continue-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Last Quiz</h2>
        </div>
        <button class="${CSS.CONTINUE_CARD}"
                type="button"
                data-action="retry-quiz"
                data-id="${escapeAttr(id)}"
                aria-label="Retry ${escapeAttr(meta?.title ?? id)}, best score ${pct}%">
          <span class="${CSS.CONTINUE_ICON}" aria-hidden="true" style="color:${meta?.accent ?? 'var(--color-primary)'}">
            ${escapeHtml(meta?.icon ?? '✏️')}
          </span>
          <span class="${CSS.CONTINUE_BODY}">
            <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(meta?.title ?? id)}</span>
            <span class="${CSS.CONTINUE_META}">Best: ${pct}% · ${relativeTime(record.lastAttemptAt)}</span>
          </span>
        </button>
      </section>
    `;
  }

  // ---- Private: rendering — quiz grid ----------------------------------------

  /**
   * @returns {string}
   */
  #renderQuizGrid() {
    if (this.#filtered.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="grid-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="grid-heading">All Quizzes</h2>
          </div>
          <div class="${CSS.EMPTY}" role="status">
            <p>No quizzes match your filters.</p>
            <button type="button" data-action="clear-all-filters" class="btn btn--primary"
                    aria-label="Clear all filters">Clear filters</button>
          </div>
        </section>
      `;
    }

    const visible  = this.#filtered.slice(0, this.#loadedPages * PAGE_SIZE);
    const cards    = visible.map((q) => this.#renderQuizCard(q)).join('');
    const hasMore  = visible.length < this.#filtered.length;

    return `
      <section class="${CSS.SECTION}" aria-labelledby="grid-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="grid-heading">All Quizzes</h2>
        </div>
        <div class="${CSS.GRID}" id="qc-grid" role="list" aria-label="${this.#filtered.length} quizzes">
          ${cards}
        </div>
        ${hasMore ? `
          <div class="${CSS.SENTINEL}" id="qc-sentinel" aria-hidden="true" style="height:4px"></div>
          <button class="${CSS.LOAD_MORE}" type="button" data-action="load-more"
                  aria-label="Load more quizzes">Load more quizzes</button>
        ` : ''}
      </section>
    `;
  }

  /**
   * @param {QuizMeta} q
   * @returns {string}
   */
  #renderQuizCard(q) {
    const record       = this.#summary.quizzes.records[q.id];
    const attempted     = Boolean(record);
    const bestPct       = record?.totalQuestions ? Math.round((record.bestScore / record.totalQuestions) * 100) : 0;
    const passed        = attempted && (bestPct / 100) >= PASS_THRESHOLD;
    const isBookmarked  = this.#bookmarks.has(q.id);
    const isFavourite   = this.#favourites.has(q.id);

    const diffLabel = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
    const diffClass = {
      beginner: CSS.CARD_BADGE_BEG, intermediate: CSS.CARD_BADGE_INT, advanced: CSS.CARD_BADGE_ADV,
    }[q.difficulty] ?? '';

    const ctaAction = passed ? 'retry-quiz' : attempted ? 'resume-quiz' : 'start-quiz';
    const ctaLabel  = passed ? 'Retry' : attempted ? 'Resume' : 'Start';

    return `
      <article class="${CSS.CARD}" role="listitem" data-id="${escapeAttr(q.id)}"
               aria-labelledby="qc-title-${escapeAttr(q.id)}">
        <div class="${CSS.CARD_ACTIONS}">
          <button class="${CSS.CARD_BTN_BOOKMARK} ${isBookmarked ? CSS.CARD_BTN_BOOKMARK_ON : ''}"
                  type="button" data-action="toggle-bookmark" data-id="${escapeAttr(q.id)}"
                  aria-pressed="${isBookmarked}"
                  aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark'} ${escapeAttr(q.title)}">🔖</button>
          <button class="${CSS.CARD_BTN_FAV} ${isFavourite ? CSS.CARD_BTN_FAV_ON : ''}"
                  type="button" data-action="toggle-favourite" data-id="${escapeAttr(q.id)}"
                  aria-pressed="${isFavourite}"
                  aria-label="${isFavourite ? 'Remove from favourites' : 'Favourite'} ${escapeAttr(q.title)}">❤️</button>
        </div>
        <span class="${CSS.CARD_ICON}" aria-hidden="true" style="color:${q.accent}">${escapeHtml(q.icon)}</span>
        <span class="${CSS.CARD_BADGE_DIFF} ${diffClass}">${escapeHtml(diffLabel)}</span>
        <h3 class="${CSS.CARD_TITLE}" id="qc-title-${escapeAttr(q.id)}">${escapeHtml(q.title)}</h3>
        <p class="${CSS.CARD_DESC}">${escapeHtml(q.description)}</p>
        <p class="${CSS.CARD_META}">${q.questionCount} questions · ${q.estimatedMinutes} min · +${q.xpReward} XP</p>
        ${attempted ? `<p class="${CSS.CARD_BEST}">Best score: ${bestPct}% ${passed ? '✅' : ''}</p>` : ''}
        <button class="${CSS.CARD_CTA}"
                type="button"
                data-action="${escapeAttr(ctaAction)}"
                data-id="${escapeAttr(q.id)}"
                aria-label="${escapeAttr(ctaLabel)}: ${escapeAttr(q.title)}"
                style="--cta-accent:${q.accent}">
          ${escapeHtml(ctaLabel)} Quiz
        </button>
      </article>
    `;
  }

  // ---- Private: rendering — recent scores / performance / accuracy ----------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecentScores(s) {
    const entries = Object.entries(s.quizzes.records)
      .filter(([, r]) => r.lastAttemptAt)
      .sort(([, a], [, b]) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))
      .slice(0, 5);

    if (entries.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="recent-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recent-heading">Recent Scores</h2></div>
          <p class="${CSS.EMPTY}">No quiz attempts yet.</p>
        </section>
      `;
    }

    const rows = entries.map(([id, r]) => {
      const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
      const pct  = r.totalQuestions ? Math.round((r.bestScore / r.totalQuestions) * 100) : 0;
      const pass = (pct / 100) >= PASS_THRESHOLD;
      return `
        <li class="${CSS.RECENT_ITEM}">
          <span class="${CSS.RECENT_ICON}" aria-hidden="true">${escapeHtml(meta?.icon ?? '✏️')}</span>
          <span class="${CSS.RECENT_BODY}">
            <span class="${CSS.RECENT_TITLE}">${escapeHtml(meta?.title ?? id)}</span>
            <span class="${CSS.RECENT_META}">${relativeTime(r.lastAttemptAt)}</span>
          </span>
          <span class="${CSS.RECENT_SCORE} ${pass ? CSS.RECENT_SCORE_PASS : CSS.RECENT_SCORE_FAIL}">${pct}%</span>
        </li>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="recent-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recent-heading">Recent Scores</h2></div>
        <ul class="${CSS.RECENT_LIST}" role="list" aria-label="Recent quiz scores">${rows}</ul>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderPerformanceSummary(s) {
    const { attempted, passed, accuracy } = s.quizzes;
    const totalXp = Object.entries(s.quizzes.records)
      .filter(([id]) => QUIZ_CATALOGUE.some((q) => q.id === id))
      .reduce((sum, [id, r]) => {
        const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
        return sum + (r.bestScore && meta ? meta.xpReward : 0);
      }, 0);

    const tiles = [
      { value: attempted, label: 'Quizzes Attempted' },
      { value: passed,    label: 'Quizzes Passed'     },
      { value: `${accuracy}%`, label: 'Overall Accuracy' },
      { value: totalXp,   label: 'XP from Quizzes'     },
    ];

    const html = tiles.map((t) => `
      <div class="${CSS.PERF_TILE}" role="listitem" aria-label="${escapeAttr(String(t.value))} ${escapeAttr(t.label)}">
        <span class="${CSS.PERF_VALUE}">${escapeHtml(String(t.value))}</span>
        <span class="${CSS.PERF_LABEL}">${escapeHtml(t.label)}</span>
      </div>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="perf-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="perf-heading">Performance Summary</h2></div>
        <div class="${CSS.PERF_GRID}" role="list" aria-label="Performance summary">${html}</div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderAccuracyStatistics(s) {
    const categories = [...new Set(QUIZ_CATALOGUE.map((q) => q.category))];

    const rows = categories.map((cat) => {
      const catQuizzes = QUIZ_CATALOGUE.filter((q) => q.category === cat);
      const attempts   = catQuizzes
        .map((q) => s.quizzes.records[q.id])
        .filter(Boolean);

      if (attempts.length === 0) return null;

      const avgPct = Math.round(
        attempts.reduce((sum, r) => sum + (r.totalQuestions ? (r.bestScore / r.totalQuestions) * 100 : 0), 0)
        / attempts.length
      );

      const label = cat.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      return `
        <li class="${CSS.ACCURACY_ITEM}">
          <span class="${CSS.ACCURACY_LABEL}">${escapeHtml(label)}</span>
          <span class="${CSS.ACCURACY_BAR}" role="progressbar" aria-valuenow="${avgPct}"
                aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttr(label)}: ${avgPct}% average accuracy">
            <span class="${CSS.ACCURACY_BAR_FILL}" style="width:${avgPct}%"></span>
          </span>
          <span class="${CSS.ACCURACY_PCT}">${avgPct}%</span>
        </li>
      `;
    }).filter(Boolean);

    if (rows.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="accuracy-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="accuracy-heading">Accuracy Statistics</h2></div>
          <p class="${CSS.EMPTY}">Complete quizzes in different categories to see your accuracy breakdown.</p>
        </section>
      `;
    }

    return `
      <section class="${CSS.SECTION}" aria-labelledby="accuracy-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="accuracy-heading">Accuracy Statistics</h2></div>
        <ul class="${CSS.ACCURACY_LIST}" aria-label="Accuracy by category">${rows.join('')}</ul>
      </section>
    `;
  }

  // ---- Private: rendering — leaderboard / recommendations / challenge -------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderLeaderboard(s) {
    let name = 'You';
    if (this.#config.store) {
      try { name = this.#config.store.getUser()?.name || 'You'; } catch { /* ignore */ }
    }

    const myScore = Object.values(s.quizzes.records)
      .reduce((sum, r) => sum + (r.bestScore ?? 0), 0);

    const rows = [
      ...LEADERBOARD_SEED.entries.map((r) => ({ ...r, isMe: false })),
      { name, score: myScore, isMe: true },
    ].sort((a, b) => b.score - a.score);

    const items = rows.map((r, i) => `
      <li class="${CSS.LEADERBOARD_ITEM} ${r.isMe ? CSS.LEADERBOARD_ITEM_ME : ''}" aria-current="${r.isMe}">
        <span class="${CSS.LEADERBOARD_RANK}">#${i + 1}</span>
        <span class="${CSS.LEADERBOARD_NAME}">${escapeHtml(r.name)}${r.isMe ? ' (You)' : ''}</span>
        <span class="${CSS.LEADERBOARD_SCORE}">${r.score.toLocaleString()} pts</span>
      </li>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="leaderboard-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="leaderboard-heading">Leaderboard</h2></div>
        <ol class="${CSS.LEADERBOARD_LIST}" aria-label="Top quiz scorers">${items}</ol>
        <p class="${CSS.LEADERBOARD_NOTE}">Preview — full live leaderboards are coming soon.</p>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecommendedQuizzes(s) {
    const attemptedIds = new Set(Object.keys(s.quizzes.records));
    const lastId = Object.entries(s.quizzes.records)
      .sort(([, a], [, b]) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0]?.[0];
    const lastCategory = QUIZ_CATALOGUE.find((q) => q.id === lastId)?.category;

    const recommended = QUIZ_CATALOGUE
      .filter((q) => !attemptedIds.has(q.id) && (!lastCategory || q.category === lastCategory))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, 4);

    const finalList = recommended.length > 0
      ? recommended
      : QUIZ_CATALOGUE.filter((q) => !attemptedIds.has(q.id)).slice(0, 4);

    if (finalList.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="recommend-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recommend-heading">Recommended Quizzes</h2></div>
          <p class="${CSS.EMPTY}">You've attempted every quiz — incredible!</p>
        </section>
      `;
    }

    const cards = finalList.map((q) => `
      <article class="${CSS.RECOMMEND_CARD}" aria-labelledby="rec-${escapeAttr(q.id)}">
        <span aria-hidden="true" style="color:${q.accent};font-size:1.75rem">${escapeHtml(q.icon)}</span>
        <h3 id="rec-${escapeAttr(q.id)}">${escapeHtml(q.title)}</h3>
        <p>${q.questionCount} questions · +${q.xpReward} XP</p>
        <button type="button" data-action="start-quiz" data-id="${escapeAttr(q.id)}"
                aria-label="Start ${escapeAttr(q.title)}">Start</button>
      </article>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="recommend-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recommend-heading">Recommended Quizzes</h2></div>
        <div class="${CSS.RECOMMEND_GRID}" role="list" aria-label="Recommended quizzes">${cards}</div>
      </section>
    `;
  }

  /**
   * @returns {string}
   */
  #renderDailyChallenge() {
    const quiz = QUIZ_CATALOGUE[todayChallengeIndex()];
    return `
      <section class="${CSS.SECTION} ${CSS.CHALLENGE}" aria-labelledby="challenge-heading">
        <span class="${CSS.CHALLENGE_BADGE}">⚡ Daily Challenge</span>
        <h2 class="${CSS.CHALLENGE_TITLE}" id="challenge-heading">${escapeHtml(quiz.title)}</h2>
        <p class="${CSS.CHALLENGE_DESC}">${escapeHtml(quiz.description)}</p>
        <button class="${CSS.CHALLENGE_CTA}"
                type="button" data-action="start-quiz" data-id="${escapeAttr(quiz.id)}"
                aria-label="Take today's challenge: ${escapeAttr(quiz.title)}, earn ${quiz.xpReward} XP">
          Take Today's Challenge — +${quiz.xpReward} XP
        </button>
      </section>
    `;
  }

  // ---- Private: rendering — history / completed / footer --------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderQuizHistory(s) {
    const entries = Object.entries(s.quizzes.records)
      .filter(([, r]) => r.lastAttemptAt)
      .sort(([, a], [, b]) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));

    if (entries.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="history-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="history-heading">Quiz History</h2></div>
          <p class="${CSS.EMPTY}">Your full attempt history will appear here.</p>
        </section>
      `;
    }

    const items = entries.map(([id, r]) => {
      const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
      const pct  = r.totalQuestions ? Math.round((r.bestScore / r.totalQuestions) * 100) : 0;
      return `
        <li class="${CSS.HISTORY_ITEM}">
          <span>${escapeHtml(meta?.title ?? id)}</span>
          <span class="${CSS.HISTORY_META}">${r.attempts} attempt${r.attempts !== 1 ? 's' : ''} · Best ${pct}% · ${relativeTime(r.lastAttemptAt)}</span>
        </li>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="history-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="history-heading">Quiz History</h2></div>
        <ul class="${CSS.HISTORY_LIST}" role="list" aria-label="Full quiz attempt history">${items}</ul>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderCompletedQuizzes(s) {
    const completed = Object.entries(s.quizzes.records)
      .filter(([, r]) => r.totalQuestions && (r.bestScore / r.totalQuestions) >= PASS_THRESHOLD)
      .sort(([, a], [, b]) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));

    if (completed.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Completed Quizzes</h2></div>
          <p class="${CSS.EMPTY}">Pass a quiz to see it added here.</p>
        </section>
      `;
    }

    const cards = completed.map(([id, r]) => {
      const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
      const pct  = Math.round((r.bestScore / r.totalQuestions) * 100);
      return `
        <button class="${CSS.COMPLETED_CARD}" type="button" data-action="retry-quiz" data-id="${escapeAttr(id)}"
                aria-label="Review ${escapeAttr(meta?.title ?? id)}, scored ${pct}%">
          <span aria-hidden="true">${escapeHtml(meta?.icon ?? '✅')}</span>
          <span>${escapeHtml(meta?.title ?? id)}</span>
          <span>${pct}%</span>
        </button>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Completed Quizzes</h2></div>
        <div class="${CSS.COMPLETED_GRID}" role="list" aria-label="Completed quizzes">${cards}</div>
      </section>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFooterCTA() {
    return `
      <section class="${CSS.FOOTER_CTA}" aria-labelledby="footer-cta-heading">
        <div class="${CSS.FOOTER_CTA_INNER}">
          <h2 id="footer-cta-heading">Ready to test yourself?</h2>
          <button class="${CSS.FOOTER_CTA_BTN}" type="button" data-action="start-quiz"
                  data-id="${escapeAttr(QUIZ_CATALOGUE[0]?.id ?? '')}"
                  aria-label="Start a quiz">Start a Quiz</button>
        </div>
      </section>
    `;
  }

  // ---- Private: filtering ---------------------------------------------------

  /**
   * Apply the current filter, patch the grid, header count, and chips.
   */
  #applyFilters() {
    this.#loadedPages = 1;
    this.#computeFilteredList();
    this.#syncUrlParams();
    this.#replaceRegion('qc-grid-region', this.#renderQuizGrid());
    this.#updateHeaderCount();
    this.#refreshFilterChips();

    const count = this.#filtered.length;
    this.#announce(count === 0 ? 'No quizzes found.' : `${count} quiz${count === 1 ? '' : 'zes'} found.`);
  }

  /**
   * Compute and cache #filtered from QUIZ_CATALOGUE + #filter.
   */
  #computeFilteredList() {
    const f = this.#filter;
    const q = normalise(f.search);

    let result = QUIZ_CATALOGUE.filter((quiz) => {
      if (f.category   !== 'all' && quiz.category   !== f.category)   return false;
      if (f.difficulty !== 'all' && quiz.difficulty !== f.difficulty) return false;
      if (q) {
        const haystack = [quiz.title, quiz.description, quiz.category, ...quiz.tags].map(normalise).join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    switch (f.sort) {
      case 'newest':  result = [...result].reverse(); break;
      case 'popular': result = [...result].sort((a, b) => b.popularityScore - a.popularityScore); break;
      case 'quick':   result = [...result].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes); break;
      case 'alpha':   result = [...result].sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'recommended':
      default:        result = [...result].sort((a, b) => b.popularityScore - a.popularityScore); break;
    }

    this.#filtered = result;
  }

  /**
   * Parse URL query parameters into #filter.
   */
  #parseUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('q'))          this.#filter.search     = params.get('q');
      if (params.get('category'))   this.#filter.category   = params.get('category');
      if (params.get('difficulty')) this.#filter.difficulty = params.get('difficulty');
      if (params.get('sort'))       this.#filter.sort       = params.get('sort');
    } catch { /* ignore */ }
  }

  /**
   * Write the current filter to the URL without navigation.
   */
  #syncUrlParams() {
    try {
      const f = this.#filter;
      const params = new URLSearchParams();
      if (f.search)                 params.set('q', f.search);
      if (f.category !== 'all')     params.set('category', f.category);
      if (f.difficulty !== 'all')   params.set('difficulty', f.difficulty);
      if (f.sort !== 'recommended') params.set('sort', f.sort);
      const qs  = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
  }

  /**
   * @param {string} id
   */
  #updateHeaderCount() {
    const el = this.#root?.querySelector('#qc-count-label');
    if (el) el.textContent = `${this.#filtered.length} of ${QUIZ_CATALOGUE.length} quizzes`;
  }

  /**
   * Re-render the filter chip groups without touching the search input.
   */
  #refreshFilterChips() {
    const filtersEl = this.#root?.querySelector(`.${CSS.FILTERS}`);
    if (!filtersEl) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.#renderFilterChips();
    filtersEl.replaceWith(tmp.firstElementChild);
  }

  // ---- Private: infinite scroll ----------------------------------------------

  /**
   * Attach an IntersectionObserver to the grid sentinel for infinite scroll.
   */
  #attachScrollObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    this.#scrollObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.#loadMoreQuizzes();
      }
    }, { rootMargin: '200px' });

    const attachSentinel = () => {
      const sentinel = this.#root?.querySelector('#qc-sentinel');
      if (sentinel) this.#scrollObserver?.observe(sentinel);
    };
    attachSentinel();

    const observer = new MutationObserver(attachSentinel);
    const grid = this.#root?.querySelector('#qc-grid-region');
    if (grid) {
      observer.observe(grid, { childList: true });
      this.#cleanupFns.push(() => observer.disconnect());
    }
  }

  /**
   * Load the next page of quiz cards.
   */
  #loadMoreQuizzes() {
    const maxPages = Math.ceil(this.#filtered.length / PAGE_SIZE);
    if (this.#loadedPages >= maxPages) return;
    this.#loadedPages++;
    this.#replaceRegion('qc-grid-region', this.#renderQuizGrid());
  }

  // ---- Private: DOM patching --------------------------------------------------

  /**
   * @param {string} id
   * @param {string} html
   */
  #replaceRegion(id, html) {
    const el = this.#root?.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  // ---- Private: quiz engine modal ---------------------------------------------

  /**
   * Dynamically import quiz.js and start the given quiz inside a modal overlay.
   *
   * @param {string} id
   * @param {HTMLElement} triggerEl
   */
  async #openQuizModal(id, triggerEl) {
    const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
    if (!meta) return;

    this.#modalTrigger = triggerEl;

    const overlay = document.createElement('div');
    overlay.className = CSS.MODAL_OVERLAY;
    overlay.id = 'qc-quiz-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qc-modal-title');

    overlay.innerHTML = `
      <div class="${CSS.MODAL}">
        <div class="${CSS.MODAL_HEADER}">
          <h2 class="${CSS.MODAL_TITLE}" id="qc-modal-title">${escapeHtml(meta.title)}</h2>
          <button class="${CSS.MODAL_CLOSE}" type="button" data-action="close-quiz-modal"
                  aria-label="Close quiz">✕</button>
        </div>
        <div class="${CSS.MODAL_BODY}" id="qc-quiz-container">
          <p role="status">Loading quiz…</p>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.#activeModal = overlay;

    const onOverlayClick = (e) => {
      if (e.target === overlay) this.#closeModal();
      const closeBtn = e.target.closest('[data-action="close-quiz-modal"]');
      if (closeBtn) this.#closeModal();
    };
    overlay.addEventListener('click', onOverlayClick);

    const onEsc = (e) => { if (e.key === 'Escape') this.#closeModal(); };
    document.addEventListener('keydown', onEsc);
    overlay.__escHandler = onEsc;

    try {
      const { default: QuizEngine, QUIZ_EVENTS } = await import('../components/quiz.js');

      this.#activeEngine = new QuizEngine({
        containerId: 'qc-quiz-container',
        tracker:     this.#config.tracker,
        randomize:   true,
      });

      const quizData = this.#buildQuizData(meta);
      this.#activeEngine.load(quizData);
      this.#activeEngine.mount();
      this.#activeEngine.start();

      const onSubmitted = () => {
        this.#debouncedRefresh.cancel();
        this.refresh();
        window.setTimeout(() => this.#closeModal(), 1200);
      };
      document.addEventListener(QUIZ_EVENTS.SUBMITTED, onSubmitted, { once: true });
      overlay.__submitHandler = onSubmitted;

      this.#dispatch(QUIZ_CENTER_EVENTS.SELECTED, { id, title: meta.title, action: 'start' });
    } catch (err) {
      console.error('[QuizzesPage] Failed to load quiz engine:', err);
      const body = overlay.querySelector(`.${CSS.MODAL_BODY}`);
      if (body) {
        body.innerHTML = `<p role="alert">Sorry, this quiz could not be loaded. Please try again later.</p>`;
      }
    }

    requestAnimationFrame(() => {
      overlay.querySelector('button')?.focus({ preventScroll: true });
    });
  }

  /**
   * Build a minimal valid QuizEngine data object from catalogue metadata.
   * In production this would be fetched from /data/quizzes/{id}.json.
   *
   * @param {QuizMeta} meta
   * @returns {object}
   */
  #buildQuizData(meta) {
    const questions = Array.from({ length: meta.questionCount }, (_, i) => ({
      id:      `${meta.id}-q${i + 1}`,
      type:    'multiple-choice',
      prompt:  `Sample question ${i + 1} for ${meta.title}`,
      options: [
        { id: 'a', text: 'Option A' },
        { id: 'b', text: 'Option B' },
        { id: 'c', text: 'Option C' },
        { id: 'd', text: 'Option D' },
      ],
      correctOptionId: 'a',
    }));

    return {
      id:         meta.id,
      title:      meta.title,
      questions,
      randomize:  true,
    };
  }

  /**
   * Close the active quiz modal, cleaning up the QuizEngine instance and
   * all modal-scoped listeners. Restores focus to the trigger element.
   *
   * @param {boolean} [force=false] — Skip the unsaved-progress confirmation
   */
  #closeModal(force = false) {
    if (!this.#activeModal) return;

    if (!force && this.#activeEngine) {
      const confirmed = window.confirm('Leave this quiz? Your progress on this attempt will be lost.');
      if (!confirmed) return;
    }

    try { this.#activeEngine?.destroy(); } catch { /* swallow */ }
    this.#activeEngine = null;

    if (this.#activeModal.__escHandler) {
      document.removeEventListener('keydown', this.#activeModal.__escHandler);
    }
    if (this.#activeModal.__submitHandler) {
      document.removeEventListener('quiz:submitted', this.#activeModal.__submitHandler);
    }

    this.#activeModal.remove();
    this.#activeModal = null;

    this.#modalTrigger?.focus({ preventScroll: true });
    this.#modalTrigger = null;
  }

  // ---- Private: event listeners ------------------------------------------------

  /**
   * Attach all external event subscriptions and DOM event delegation.
   */
  #attachEventListeners() {
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    const onInput = (e) => {
      if (!e.target.classList.contains(CSS.SEARCH_INPUT)) return;
      this.#filter.search = e.target.value;
      this.#debouncedSearch();
    };
    this.#root?.addEventListener('input', onInput);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('input', onInput));

    const onChange = (e) => {
      if (e.target.dataset.action === 'sort') {
        this.#filter.sort = e.target.value;
        this.#applyFilters();
      }
    };
    this.#root?.addEventListener('change', onChange);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('change', onChange));

    const onKeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.#searchInput?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === this.#searchInput) {
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
      }
    };
    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));

    const onProgressUpdated = () => this.#debouncedRefresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() => document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated));

    const onQuizCompleted = () => { this.#debouncedRefresh.cancel(); this.refresh(); };
    document.addEventListener('quiz:completed', onQuizCompleted);
    this.#cleanupFns.push(() => document.removeEventListener('quiz:completed', onQuizCompleted));

    const onQuizStarted = () => this.#debouncedRefresh();
    document.addEventListener('quiz:started', onQuizStarted);
    this.#cleanupFns.push(() => document.removeEventListener('quiz:started', onQuizStarted));

    const onStateUpdated = (e) => {
      if (e.detail?.path === 'theme') {
        try { this.#theme = this.#config.store?.getTheme()?.resolvedMode ?? this.#theme; } catch { /* ignore */ }
        this.#root?.classList.toggle(CSS.ROOT_DARK, this.#theme === 'dark');
      }
    };
    document.addEventListener('state:updated', onStateUpdated);
    this.#cleanupFns.push(() => document.removeEventListener('state:updated', onStateUpdated));

    const onThemeChanged = (e) => {
      const resolved = e.detail?.resolvedMode ?? e.detail?.mode;
      if (resolved) {
        this.#theme = resolved;
        this.#root?.classList.toggle(CSS.ROOT_DARK, resolved === 'dark');
      }
    };
    document.addEventListener('theme:changed', onThemeChanged);
    this.#cleanupFns.push(() => document.removeEventListener('theme:changed', onThemeChanged));

    const onRouterNavigate = (e) => {
      if (e.detail?.pathname === '/quizzes') {
        this.#parseUrlParams();
        this.#applyFilters();
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener('router:afterNavigate', onRouterNavigate));
  }

  // ---- Private: click handler ---------------------------------------------------

  /**
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id      = actionEl.dataset.id ?? '';
    const value   = actionEl.dataset.value ?? '';

    switch (action) {
      case 'start-quiz':
      case 'resume-quiz':
      case 'retry-quiz': {
        const meta = QUIZ_CATALOGUE.find((q) => q.id === id);
        this.#openQuizModal(id, actionEl);
        this.#dispatch(QUIZ_CENTER_EVENTS.SELECTED, { id, title: meta?.title ?? id, action });
        break;
      }

      case 'toggle-bookmark': {
        if (this.#bookmarks.has(id)) this.#bookmarks.delete(id); else this.#bookmarks.add(id);
        saveIdSet(BOOKMARK_KEY, this.#bookmarks);
        this.#updateCardToggle(id, 'bookmark', this.#bookmarks.has(id));
        this.#announce(this.#bookmarks.has(id) ? 'Quiz bookmarked.' : 'Bookmark removed.');
        break;
      }

      case 'toggle-favourite': {
        if (this.#favourites.has(id)) this.#favourites.delete(id); else this.#favourites.add(id);
        saveIdSet(FAVOURITE_KEY, this.#favourites);
        this.#updateCardToggle(id, 'favourite', this.#favourites.has(id));
        this.#announce(this.#favourites.has(id) ? 'Added to favourites.' : 'Removed from favourites.');
        break;
      }

      case 'filter-category':
        this.#filter.category = value;
        this.#applyFilters();
        break;

      case 'filter-difficulty':
        this.#filter.difficulty = value;
        this.#applyFilters();
        break;

      case 'clear-search':
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        this.#searchInput?.focus();
        break;

      case 'clear-all-filters':
        this.#filter = defaultFilter();
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        break;

      case 'load-more':
        this.#loadMoreQuizzes();
        break;

      default:
        this.#dispatch('quiz:center:action', { action, id });
        break;
    }
  }

  /**
   * Update a bookmark/favourite button's visual state without re-rendering the card.
   *
   * @param {string} id
   * @param {'bookmark'|'favourite'} type
   * @param {boolean} active
   */
  #updateCardToggle(id, type, active) {
    const card = this.#root?.querySelector(`[data-id="${id}"].${CSS.CARD}`);
    if (!card) return;
    const btnAction = type === 'bookmark' ? 'toggle-bookmark' : 'toggle-favourite';
    const btn = card.querySelector(`[data-action="${btnAction}"]`);
    if (!btn) return;
    const activeClass = type === 'bookmark' ? CSS.CARD_BTN_BOOKMARK_ON : CSS.CARD_BTN_FAV_ON;
    btn.classList.toggle(activeClass, active);
    btn.setAttribute('aria-pressed', String(active));
  }

  // ---- Private: accessibility ---------------------------------------------------

  /**
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

  // ---- Private: event bus ---------------------------------------------------------

  /**
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