/**
 * =============================================================================
 * PROJECTS CENTER PAGE MODULE
 * scripts/pages/projects.js
 * -----------------------------------------------------------------------------
 * Project discovery and tracking hub for the Python for AI educational
 * platform. Lets learners browse, search, filter, bookmark, and track
 * real-world Python/AI build projects, comparable to GitHub Learning Lab,
 * freeCodeCamp, Codecademy Projects, and DataCamp Projects.
 *
 * ARCHITECTURE:
 *   ProjectsPage (default export)
 *     └─ Self-contained: reads live completion/progress data from the
 *        injected ProgressTracker via getSummary(). A static PROJECT_CATALOGUE
 *        seeds project metadata (title, category, difficulty, technologies,
 *        skills). No sub-components are imported — this follows the same
 *        self-contained-page pattern as tutorials.js, dashboard.js, and
 *        quizzes.js.
 *
 * SECTIONS (rendered in document order):
 *   1.  Hero Section         — title, subtitle, total project count
 *   2.  Controls Bar         — search input + sort selector
 *   3.  Filter Chips         — category, difficulty, technology, saved/in-progress
 *   4.  Featured Project     — single highlighted project banner
 *   5.  Recommended Projects — category-aware suggestions
 *   6.  Continue Project     — most recently active in-progress project
 *   7.  Project Categories   — quick-jump chips into each category
 *   8.  Project Grid         — paginated/infinite-scroll grid of all projects
 *   9.  Trending Projects    — sorted by popularity score
 *  10.  Beginner Projects    — filtered by difficulty
 *  11.  Intermediate Projects— filtered by difficulty
 *  12.  Advanced Projects    — filtered by difficulty
 *  13.  Recently Viewed      — last 5 project cards opened (localStorage log)
 *  14.  Recently Completed   — last 5 finished projects
 *  15.  Saved Projects       — bookmarked projects grid
 *  16.  Footer Integration   — lightweight CTA bridging into the global footer
 *
 * PROJECT CARD CONTRACT:
 *   Every card renders: thumbnail (icon on accent-tinted background), title,
 *   difficulty badge, estimated duration, XP reward, skills-learned chips,
 *   technology chips, completion percentage, a progress bar, a bookmark
 *   toggle, a favourite toggle, and a single primary CTA that reads
 *   Start / Continue / Review depending on tracker state.
 *
 * REACTIVE UPDATES:
 *   • state:updated          → refresh theme-dependent regions
 *   • project:started        → mark card in-progress, refresh Continue section
 *   • project:completed      → immediate full refresh (bypasses debounce)
 *   • progress:updated       → debounced refresh of all tracker-dependent regions
 *   • theme:changed          → toggle dark-mode root class
 *   • router:afterNavigate   → re-parse URL filter params when returning here
 *
 * EVENT EMISSIONS:
 *   projects:mounted    { pathname }
 *   projects:updated    { timestamp }
 *   project:selected    { id, title, action }
 *   projects:destroyed  { pathname }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces search result counts and filter changes
 *   • Every card, chip, and button carries a descriptive aria-label
 *   • Keyboard: Ctrl+K focuses search, Escape clears search when focused
 *   • Reduced motion: card entrance and progress-bar transitions are instant
 *   • Landmark roles: main, search, region, list, listitem, progressbar
 *
 * PERFORMANCE:
 *   • Search is debounced at 250 ms
 *   • progress:updated is debounced at 250 ms; project:completed bypasses it
 *   • The main grid renders in pages of 12 with an IntersectionObserver
 *     sentinel + MutationObserver re-attach for infinite scroll
 *   • Category/difficulty sub-sections (Trending, Beginner, etc.) are capped
 *     at 4 cards each — they are previews, not full paginated lists
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/projects',
 *     title:     'Projects',
 *     component: () => import('./pages/projects.js'),
 *   }
 *
 * EXPORTS:
 *   ProjectsPage    — primary class (default export)
 *   PROJECTS_EVENTS — event name constants
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
 * Event names emitted by the Projects Center page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROJECTS_EVENTS = Object.freeze({
  MOUNTED:   'projects:mounted',
  UPDATED:   'projects:updated',
  SELECTED:  'project:selected',
  DESTROYED: 'projects:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Project cards rendered per infinite-scroll page */
const PAGE_SIZE = 12;

/** Search debounce delay (ms) */
const SEARCH_DEBOUNCE_MS = 250;

/** progress:updated debounce delay (ms) */
const REFRESH_DEBOUNCE_MS = 250;

/** Max cards shown in each preview sub-section (Trending, Beginner, etc.) */
const PREVIEW_LIMIT = 4;

/** Max entries retained in the "recently viewed" log */
const RECENTLY_VIEWED_LIMIT = 5;

/** localStorage keys */
const BOOKMARK_KEY        = 'pyai-projects-bookmarks';
const FAVOURITE_KEY       = 'pyai-projects-favourites';
const RECENTLY_VIEWED_KEY = 'pyai-projects-recently-viewed';

// ---------------------------------------------------------------------------
// Static project catalogue
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string, title: string, description: string,
 *   difficulty: 'beginner'|'intermediate'|'advanced', category: string,
 *   technologies: string[], skills: string[], estimatedHours: number,
 *   xpReward: number, icon: string, accent: string, isFeatured: boolean,
 *   isTrending: boolean, isNew: boolean, tags: string[],
 *   popularityScore: number, path: string, publishedAt: number,
 * }} ProjectMeta
 */

/** @type {ReadonlyArray<ProjectMeta>} */
const PROJECT_CATALOGUE = Object.freeze([
  { id: 'build-image-classifier',   title: 'Build an Image Classifier',        description: 'Train a CNN on a labelled dataset, evaluate it, and deploy behind a REST API.', difficulty: 'advanced',     category: 'computer-vision',  technologies: ['Python','PyTorch','FastAPI'],     skills: ['CNNs','Model Deployment','Evaluation'],       estimatedHours: 8,  xpReward: 200, icon: '🏗️', accent: 'var(--color-danger)',  isFeatured: true,  isTrending: true,  isNew: false, tags: ['cnn','vision','deployment'],    popularityScore: 96, path: '/projects/build-image-classifier',   publishedAt: 1_700_000_000_000 },
  { id: 'sentiment-dashboard',      title: 'Sentiment Analysis Dashboard',      description: 'Classify tweets by sentiment and visualise trends on a live dashboard.',        difficulty: 'intermediate', category: 'nlp',              technologies: ['Python','scikit-learn','Plotly'],  skills: ['Text Classification','Visualisation'],        estimatedHours: 5,  xpReward: 130, icon: '😊', accent: 'var(--color-warning)', isFeatured: false, isTrending: true,  isNew: false, tags: ['nlp','sentiment','dashboard'],  popularityScore: 89, path: '/projects/sentiment-dashboard',      publishedAt: 1_700_100_000_000 },
  { id: 'chatbot-transformer',      title: 'Transformer-Based Chatbot',         description: 'Fine-tune a small transformer model to answer domain-specific questions.',    difficulty: 'advanced',     category: 'nlp',              technologies: ['Python','HuggingFace','PyTorch'],  skills: ['Fine-Tuning','Transformers','APIs'],          estimatedHours: 10, xpReward: 220, icon: '💬', accent: 'var(--color-primary)', isFeatured: false, isTrending: false, isNew: true,  tags: ['nlp','chatbot','transformers'], popularityScore: 91, path: '/projects/chatbot-transformer',      publishedAt: 1_713_000_000_000 },
  { id: 'sales-forecaster',         title: 'Sales Forecasting Tool',           description: 'Predict next quarter sales using classical and ML time-series models.',       difficulty: 'intermediate', category: 'machine-learning', technologies: ['Python','Pandas','Prophet'],       skills: ['Time Series','Forecasting'],                  estimatedHours: 6,  xpReward: 150, icon: '📈', accent: 'var(--color-success)', isFeatured: false, isTrending: false, isNew: false, tags: ['forecasting','time-series'],   popularityScore: 78, path: '/projects/sales-forecaster',         publishedAt: 1_700_200_000_000 },
  { id: 'spam-classifier',          title: 'Email Spam Classifier',            description: 'Build and evaluate a Naive Bayes classifier to detect spam emails.',           difficulty: 'beginner',     category: 'machine-learning', technologies: ['Python','scikit-learn'],           skills: ['Naive Bayes','Text Preprocessing'],           estimatedHours: 3,  xpReward: 90,  icon: '📧', accent: 'var(--color-primary)', isFeatured: false, isTrending: false, isNew: false, tags: ['classification','nlp'],        popularityScore: 84, path: '/projects/spam-classifier',          publishedAt: 1_700_300_000_000 },
  { id: 'handwriting-recognizer',   title: 'Handwritten Digit Recognizer',      description: 'Train a neural network on MNIST and build a drawable web demo.',              difficulty: 'beginner',     category: 'computer-vision',  technologies: ['Python','TensorFlow','Flask'],     skills: ['Neural Networks','Web Demos'],                estimatedHours: 4,  xpReward: 110, icon: '✍️', accent: 'var(--color-accent)',  isFeatured: false, isTrending: true,  isNew: false, tags: ['mnist','vision','demo'],       popularityScore: 88, path: '/projects/handwriting-recognizer',   publishedAt: 1_700_400_000_000 },
  { id: 'recommendation-engine',    title: 'Movie Recommendation Engine',       description: 'Build a collaborative-filtering recommender using the MovieLens dataset.',    difficulty: 'intermediate', category: 'machine-learning', technologies: ['Python','Pandas','NumPy'],         skills: ['Collaborative Filtering','Matrix Factorisation'], estimatedHours: 6, xpReward: 140, icon: '🎬', accent: 'var(--color-warning)', isFeatured: false, isTrending: false, isNew: false, tags: ['recommender','ml'],            popularityScore: 82, path: '/projects/recommendation-engine',    publishedAt: 1_700_500_000_000 },
  { id: 'stock-predictor',          title: 'Stock Price Predictor',             description: 'Use an LSTM to model and forecast historical stock price sequences.',         difficulty: 'advanced',     category: 'deep-learning',    technologies: ['Python','PyTorch','yFinance'],     skills: ['LSTMs','Sequence Modelling'],                 estimatedHours: 9,  xpReward: 210, icon: '📊', accent: 'var(--color-danger)',  isFeatured: false, isTrending: false, isNew: false, tags: ['lstm','finance','deep-learning'], popularityScore: 80, path: '/projects/stock-predictor',        publishedAt: 1_700_600_000_000 },
  { id: 'face-detection-app',       title: 'Real-Time Face Detection App',      description: 'Use OpenCV and a pretrained model to detect faces from a webcam stream.',      difficulty: 'intermediate', category: 'computer-vision',  technologies: ['Python','OpenCV'],                 skills: ['Object Detection','Real-Time Processing'],    estimatedHours: 5,  xpReward: 135, icon: '📷', accent: 'var(--color-success)', isFeatured: false, isTrending: true,  isNew: false, tags: ['opencv','vision','realtime'],  popularityScore: 90, path: '/projects/face-detection-app',       publishedAt: 1_700_700_000_000 },
  { id: 'text-summarizer',          title: 'Automatic Text Summarizer',         description: 'Build an extractive and abstractive summarisation pipeline for articles.',    difficulty: 'advanced',     category: 'nlp',              technologies: ['Python','HuggingFace'],            skills: ['Summarisation','Transformers'],               estimatedHours: 7,  xpReward: 170, icon: '📝', accent: 'var(--color-primary)', isFeatured: false, isTrending: false, isNew: true,  tags: ['nlp','summarisation'],         popularityScore: 77, path: '/projects/text-summarizer',          publishedAt: 1_712_000_000_000 },
  { id: 'weather-classifier',       title: 'Weather Image Classifier',          description: 'Classify weather conditions from photos using transfer learning.',           difficulty: 'beginner',     category: 'computer-vision',  technologies: ['Python','TensorFlow'],             skills: ['Transfer Learning','Image Classification'],   estimatedHours: 4,  xpReward: 100, icon: '⛅', accent: 'var(--color-warning)', isFeatured: false, isTrending: false, isNew: false, tags: ['vision','transfer-learning'],  popularityScore: 73, path: '/projects/weather-classifier',       publishedAt: 1_700_800_000_000 },
  { id: 'reinforcement-game-agent',title: 'Reinforcement Learning Game Agent', description: 'Train an agent to play a classic arcade game using Q-learning.',              difficulty: 'advanced',     category: 'deep-learning',    technologies: ['Python','Gymnasium','PyTorch'],    skills: ['Reinforcement Learning','Q-Learning'],        estimatedHours: 11, xpReward: 230, icon: '🎮', accent: 'var(--color-accent)',  isFeatured: false, isTrending: false, isNew: false, tags: ['rl','games'],                   popularityScore: 75, path: '/projects/reinforcement-game-agent', publishedAt: 1_700_900_000_000 },
]);

/** @type {ReadonlyArray<{ value: string, label: string }>} */
const CATEGORIES = Object.freeze([
  { value: 'all',              label: 'All'              },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'deep-learning',    label: 'Deep Learning'    },
  { value: 'nlp',              label: 'NLP'              },
  { value: 'computer-vision',  label: 'Computer Vision'  },
]);

/** @type {ReadonlyArray<{ value: string, label: string }>} */
const DIFFICULTIES = Object.freeze([
  { value: 'all',          label: 'All Levels'   },
  { value: 'beginner',     label: 'Beginner'     },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced'     },
]);

/** @type {ReadonlyArray<string>} */
const TECHNOLOGIES = Object.freeze([
  'all', 'Python', 'PyTorch', 'TensorFlow', 'scikit-learn', 'OpenCV', 'HuggingFace', 'Pandas', 'NumPy',
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:               'pj-page',
  ROOT_DARK:          'pj-page--dark',
  ROOT_REDUCED:       'pj-page--reduced-motion',
  LIVE:               'pj-page__live',

  HERO:               'pj-hero',
  HERO_TITLE:         'pj-hero__title',
  HERO_SUB:           'pj-hero__sub',
  HERO_COUNT:         'pj-hero__count',

  CONTROLS:           'pj-controls',
  SEARCH_WRAP:        'pj-controls__search-wrap',
  SEARCH_INPUT:       'pj-controls__search-input',
  SEARCH_CLEAR:       'pj-controls__search-clear',

  FILTERS:            'pj-filters',
  FILTER_GROUP:       'pj-filters__group',
  FILTER_LABEL:       'pj-filters__label',
  FILTER_CHIPS:       'pj-filters__chips',
  FILTER_CHIP:        'pj-filters__chip',
  FILTER_CHIP_ACTIVE: 'pj-filters__chip--active',

  ACTIVE_FILTERS:      'pj-active-filters',
  ACTIVE_FILTER_TAG:   'pj-active-filters__tag',
  ACTIVE_FILTER_REMOVE:'pj-active-filters__remove',
  ACTIVE_FILTER_CLEAR: 'pj-active-filters__clear-all',

  SECTION:            'pj-section',
  SECTION_INNER:      'pj-section__inner',
  SECTION_HEADER:     'pj-section__header',
  SECTION_TITLE:      'pj-section__title',

  FEATURED:           'pj-featured',
  FEATURED_ICON:      'pj-featured__icon',
  FEATURED_TITLE:     'pj-featured__title',
  FEATURED_DESC:      'pj-featured__desc',
  FEATURED_META:      'pj-featured__meta',
  FEATURED_CTA:       'pj-featured__cta',

  CONTINUE_CARD:      'pj-continue__card',
  CONTINUE_ICON:      'pj-continue__icon',
  CONTINUE_BODY:      'pj-continue__body',
  CONTINUE_TITLE:     'pj-continue__title',
  CONTINUE_META:      'pj-continue__meta',
  CONTINUE_BAR:       'pj-continue__bar',
  CONTINUE_BAR_FILL:  'pj-continue__bar-fill',

  CATEGORY_NAV:       'pj-category-nav',
  CATEGORY_NAV_ITEM:  'pj-category-nav__item',

  GRID:               'pj-grid',
  CARD:               'pj-card',
  CARD_THUMB:         'pj-card__thumb',
  CARD_BADGE_NEW:     'pj-card__badge--new',
  CARD_BADGE_DIFF:    'pj-card__badge-diff',
  CARD_BADGE_BEG:     'pj-card__badge-diff--beginner',
  CARD_BADGE_INT:     'pj-card__badge-diff--intermediate',
  CARD_BADGE_ADV:     'pj-card__badge-diff--advanced',
  CARD_ACTIONS:       'pj-card__actions',
  CARD_BTN_BOOKMARK:  'pj-card__btn-bookmark',
  CARD_BTN_BOOKMARK_ON: 'pj-card__btn-bookmark--active',
  CARD_BTN_FAV:       'pj-card__btn-fav',
  CARD_BTN_FAV_ON:    'pj-card__btn-fav--active',
  CARD_BTN_SHARE:     'pj-card__btn-share',
  CARD_BODY:          'pj-card__body',
  CARD_TITLE:         'pj-card__title',
  CARD_DESC:          'pj-card__desc',
  CARD_META:          'pj-card__meta',
  CARD_CHIPS:         'pj-card__chips',
  CARD_CHIP:          'pj-card__chip',
  CARD_CHIP_TECH:     'pj-card__chip--tech',
  CARD_BAR:           'pj-card__bar',
  CARD_BAR_FILL:      'pj-card__bar-fill',
  CARD_BAR_LABEL:     'pj-card__bar-label',
  CARD_CTA:           'pj-card__cta',

  SENTINEL:           'pj-sentinel',
  LOAD_MORE:          'pj-load-more',
  EMPTY:              'pj-empty',

  PREVIEW_GRID:       'pj-preview__grid',

  SIDEBAR_LIST:       'pj-sidebar__list',
  SIDEBAR_ITEM:       'pj-sidebar__item',
  SIDEBAR_ICON:       'pj-sidebar__icon',
  SIDEBAR_BODY:       'pj-sidebar__body',
  SIDEBAR_TITLE:      'pj-sidebar__title',
  SIDEBAR_META:       'pj-sidebar__meta',

  FOOTER_CTA:         'pj-footer-cta',
  FOOTER_CTA_INNER:   'pj-footer-cta__inner',
  FOOTER_CTA_BTN:     'pj-footer-cta__btn',
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
 * @returns {{ search: string, category: string, difficulty: string, technology: string, sort: string, bookmarked: boolean }}
 */
function defaultFilter() {
  return { search: '', category: 'all', difficulty: 'all', technology: 'all', sort: 'recommended', bookmarked: false };
}

/**
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
 * @param {string}      key
 * @param {Set<string>} set
 */
function saveIdSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* quota */ }
}

/**
 * @returns {Array<{ id: string, ts: number }>}
 */
function loadRecentlyViewed() {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Record a project view, moving it to the front of the recently-viewed log.
 * @param {string} id
 */
function recordRecentlyViewed(id) {
  try {
    const existing = loadRecentlyViewed().filter((e) => e.id !== id);
    existing.unshift({ id, ts: Date.now() });
    localStorage.setItem(
      RECENTLY_VIEWED_KEY,
      JSON.stringify(existing.slice(0, RECENTLY_VIEWED_LIMIT))
    );
  } catch { /* quota */ }
}

/**
 * @returns {object}
 */
function emptySummary() {
  return { xp: 0, level: 1, projects: { total: 0, completed: 0, pct: 0, records: {} } };
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
 * Sort a ProjectMeta array according to the sort option.
 * @param {ProjectMeta[]} list
 * @param {string}        sort
 * @returns {ProjectMeta[]}
 */
function sortProjects(list, sort) {
  const copy = [...list];
  switch (sort) {
    case 'newest':        return copy.sort((a, b) => b.publishedAt - a.publishedAt);
    case 'popular':        return copy.sort((a, b) => b.popularityScore - a.popularityScore);
    case 'duration-asc':   return copy.sort((a, b) => a.estimatedHours - b.estimatedHours);
    case 'duration-desc':  return copy.sort((a, b) => b.estimatedHours - a.estimatedHours);
    case 'alpha':          return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'recommended':
    default:               return copy.sort((a, b) => b.popularityScore - a.popularityScore);
  }
}

// ---------------------------------------------------------------------------
// ProjectsPage — primary class
// ---------------------------------------------------------------------------

/**
 * Projects Center page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve theme, parse URL filters, fetch summary
 *   3. mount()               — render, attach events, start scroll observer
 *   4. refresh()             — re-fetch tracker data, patch dynamic regions
 *   5. destroy()             — teardown listeners, observers, DOM
 */
export default class ProjectsPage {

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

  /** @type {{ search: string, category: string, difficulty: string, technology: string, sort: string, bookmarked: boolean }} */
  #filter = defaultFilter();

  /** @type {ProjectMeta[]} — result of applying #filter to PROJECT_CATALOGUE */
  #filtered = [...PROJECT_CATALOGUE];

  /** @type {Set<string>} */ #bookmarks  = loadIdSet(BOOKMARK_KEY);
  /** @type {Set<string>} */ #favourites = loadIdSet(FAVOURITE_KEY);

  /** @type {number} */ #loadedPages = 1;

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
    const instance = new ProjectsPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker ?? null,
      router:      ctx?.meta?.router  ?? null,
      store:       ctx?.meta?.store   ?? null,
    });
    outlet.__projectsPage = instance;
    instance.#root         = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__projectsPage?.destroy();
    delete outlet.__projectsPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve theme, parse URL filter params, fetch the initial summary.
   *
   * @returns {ProjectsPage} this
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
   * @returns {ProjectsPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[ProjectsPage] Container #${this.#config.containerId} not found.`);
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

    this.#dispatch(PROJECTS_EVENTS.MOUNTED, { pathname: '/projects' });
    this.#announce('Projects Center loaded.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {ProjectsPage} this
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
    this.#root.setAttribute('aria-label', 'Projects Center');

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
      <div id="pj-active-filters-region">${this.#renderActiveFilters()}</div>

      ${this.#renderFeaturedProject()}
      <div id="pj-recommend-region">${this.#renderRecommendedProjects(s)}</div>
      <div id="pj-continue-region">${this.#renderContinueProject(s)}</div>
      ${this.#renderCategoryNav()}

      <div id="pj-grid-region">${this.#renderProjectGrid(s)}</div>

      <div id="pj-trending-region">${this.#renderTrendingProjects(s)}</div>
      <div id="pj-beginner-region">${this.#renderDifficultyPreview(s, 'beginner', 'Beginner Projects', 'beginner-heading')}</div>
      <div id="pj-intermediate-region">${this.#renderDifficultyPreview(s, 'intermediate', 'Intermediate Projects', 'intermediate-heading')}</div>
      <div id="pj-advanced-region">${this.#renderDifficultyPreview(s, 'advanced', 'Advanced Projects', 'advanced-heading')}</div>

      <div id="pj-recently-viewed-region">${this.#renderRecentlyViewed(s)}</div>
      <div id="pj-recently-completed-region">${this.#renderRecentlyCompleted(s)}</div>
      <div id="pj-saved-region">${this.#renderSavedProjects(s)}</div>

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
   * @returns {ProjectsPage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    this.#summary = getSummary(this.#config.tracker);
    const s = this.#summary;

    this.#replaceRegion('pj-recommend-region',           this.#renderRecommendedProjects(s));
    this.#replaceRegion('pj-continue-region',            this.#renderContinueProject(s));
    this.#replaceRegion('pj-grid-region',                this.#renderProjectGrid(s));
    this.#replaceRegion('pj-trending-region',            this.#renderTrendingProjects(s));
    this.#replaceRegion('pj-beginner-region',            this.#renderDifficultyPreview(s, 'beginner', 'Beginner Projects', 'beginner-heading'));
    this.#replaceRegion('pj-intermediate-region',        this.#renderDifficultyPreview(s, 'intermediate', 'Intermediate Projects', 'intermediate-heading'));
    this.#replaceRegion('pj-advanced-region',            this.#renderDifficultyPreview(s, 'advanced', 'Advanced Projects', 'advanced-heading'));
    this.#replaceRegion('pj-recently-viewed-region',     this.#renderRecentlyViewed(s));
    this.#replaceRegion('pj-recently-completed-region',  this.#renderRecentlyCompleted(s));
    this.#replaceRegion('pj-saved-region',               this.#renderSavedProjects(s));

    this.#dispatch(PROJECTS_EVENTS.UPDATED, { timestamp: Date.now() });
    return this;
  }

  /**
   * Tear down all listeners, observers, and DOM.
   *
   * @returns {ProjectsPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedSearch.cancel();
    this.#debouncedRefresh.cancel();

    this.#scrollObserver?.disconnect();
    this.#scrollObserver = null;

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

    this.#dispatch(PROJECTS_EVENTS.DESTROYED, { pathname: '/projects' });
    return this;
  }

  // ---- Private: rendering — hero / controls / filters -----------------------

  /**
   * @returns {string}
   */
  #renderHero() {
    const total    = PROJECT_CATALOGUE.length;
    const filtered = this.#filtered.length;
    const hasFilter = this.#hasActiveFilter();

    return `
      <header class="${CSS.HERO}">
        <h1 tabindex="-1">Projects Center</h1>
        <p class="${CSS.HERO_SUB}">
          Build real AI applications, earn XP, and grow a portfolio you can show off.
        </p>
        <span class="${CSS.HERO_COUNT}" id="pj-count-label" aria-live="polite">
          ${hasFilter ? `${filtered} of ${total}` : total} projects
        </span>
      </header>
    `;
  }

  /**
   * @returns {string}
   */
  #renderControlsBar() {
    const sortOptions = [
      { value: 'recommended',  label: 'Recommended'    },
      { value: 'newest',       label: 'Newest'         },
      { value: 'popular',      label: 'Most Popular'   },
      { value: 'duration-asc', label: 'Shortest First' },
      { value: 'duration-desc',label: 'Longest First'  },
      { value: 'alpha',        label: 'A → Z'          },
    ].map((o) => `
      <option value="${escapeAttr(o.value)}" ${this.#filter.sort === o.value ? 'selected' : ''}>
        ${escapeHtml(o.label)}
      </option>
    `).join('');

    return `
      <div class="${CSS.CONTROLS}" role="search" aria-label="Project search and sort">
        <div class="${CSS.SEARCH_WRAP}">
          <span aria-hidden="true">🔍</span>
          <input class="${CSS.SEARCH_INPUT}"
                 id="pj-search"
                 type="search"
                 placeholder="Search projects, skills, or technologies…"
                 autocomplete="off"
                 spellcheck="false"
                 aria-label="Search projects"
                 aria-controls="pj-grid-region"
                 value="${escapeAttr(this.#filter.search)}">
          ${this.#filter.search ? `
            <button class="${CSS.SEARCH_CLEAR}" type="button" data-action="clear-search"
                    aria-label="Clear search">✕</button>
          ` : ''}
        </div>
        <label for="pj-sort" class="sr-only">Sort projects</label>
        <select id="pj-sort" aria-label="Sort projects" data-action="sort">
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
              type="button" data-action="filter-category" data-value="${escapeAttr(c.value)}"
              aria-pressed="${this.#filter.category === c.value}"
              aria-label="Category: ${escapeAttr(c.label)}">
        ${escapeHtml(c.label)}
      </button>
    `).join('');

    const diffChips = DIFFICULTIES.map((d) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.difficulty === d.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button" data-action="filter-difficulty" data-value="${escapeAttr(d.value)}"
              aria-pressed="${this.#filter.difficulty === d.value}"
              aria-label="Difficulty: ${escapeAttr(d.label)}">
        ${escapeHtml(d.label)}
      </button>
    `).join('');

    const techChips = TECHNOLOGIES.map((t) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.technology === t ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button" data-action="filter-technology" data-value="${escapeAttr(t)}"
              aria-pressed="${this.#filter.technology === t}"
              aria-label="Technology: ${escapeAttr(t === 'all' ? 'All' : t)}">
        ${escapeHtml(t === 'all' ? 'All' : t)}
      </button>
    `).join('');

    return `
      <div class="${CSS.FILTERS}" aria-label="Project filters">
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="pj-cat-label">Category</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="pj-cat-label">${catChips}</div>
        </div>
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="pj-diff-label">Difficulty</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="pj-diff-label">${diffChips}</div>
        </div>
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="pj-tech-label">Technology</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="pj-tech-label">${techChips}</div>
        </div>
        <div class="${CSS.FILTER_GROUP}">
          <span class="${CSS.FILTER_LABEL}" id="pj-saved-filter-label">Show</span>
          <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="pj-saved-filter-label">
            <button class="${CSS.FILTER_CHIP} ${this.#filter.bookmarked ? CSS.FILTER_CHIP_ACTIVE : ''}"
                    type="button" data-action="filter-bookmarked"
                    aria-pressed="${this.#filter.bookmarked}"
                    aria-label="Show only saved projects">
              🔖 Saved Only
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderActiveFilters() {
    const tags = [];
    if (this.#filter.search)               tags.push({ label: `"${this.#filter.search}"`, action: 'remove-search'     });
    if (this.#filter.category !== 'all')   tags.push({ label: this.#filter.category,        action: 'remove-category'   });
    if (this.#filter.difficulty !== 'all') tags.push({ label: this.#filter.difficulty,       action: 'remove-difficulty' });
    if (this.#filter.technology !== 'all') tags.push({ label: this.#filter.technology,       action: 'remove-technology' });
    if (this.#filter.bookmarked)           tags.push({ label: 'Saved',                       action: 'remove-bookmarked' });

    if (tags.length === 0) return '';

    const tagHtml = tags.map((t) => `
      <span class="${CSS.ACTIVE_FILTER_TAG}">
        ${escapeHtml(t.label)}
        <button class="${CSS.ACTIVE_FILTER_REMOVE}" type="button" data-action="${escapeAttr(t.action)}"
                aria-label="Remove filter: ${escapeAttr(t.label)}">✕</button>
      </span>
    `).join('');

    return `
      <div class="${CSS.ACTIVE_FILTERS}" aria-label="Active filters" aria-live="polite">
        ${tagHtml}
        <button class="${CSS.ACTIVE_FILTER_CLEAR}" type="button" data-action="clear-all-filters"
                aria-label="Clear all filters">Clear all</button>
      </div>
    `;
  }

  // ---- Private: rendering — featured / recommended / continue ---------------

  /**
   * @returns {string}
   */
  #renderFeaturedProject() {
    const p = PROJECT_CATALOGUE.find((x) => x.isFeatured) ?? PROJECT_CATALOGUE[0];
    if (!p) return '';

    return `
      <section class="${CSS.SECTION} ${CSS.FEATURED}" aria-labelledby="featured-heading">
        <span class="${CSS.FEATURED_ICON}" aria-hidden="true" style="color:${p.accent}">${escapeHtml(p.icon)}</span>
        <h2 class="${CSS.FEATURED_TITLE}" id="featured-heading">${escapeHtml(p.title)}</h2>
        <p class="${CSS.FEATURED_DESC}">${escapeHtml(p.description)}</p>
        <p class="${CSS.FEATURED_META}">${p.estimatedHours}h · +${p.xpReward} XP · ${escapeHtml(p.difficulty)}</p>
        <button class="${CSS.FEATURED_CTA}" type="button" data-action="start-project" data-id="${escapeAttr(p.id)}"
                aria-label="Start featured project: ${escapeAttr(p.title)}">
          Start Featured Project
        </button>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecommendedProjects(s) {
    const completedIds = new Set(
      Object.entries(s.projects.records).filter(([, r]) => r.state === 'completed').map(([id]) => id)
    );

    const lastId = Object.entries(s.projects.records)
      .filter(([, r]) => r.completedAt)
      .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]?.[0];
    const lastCategory = PROJECT_CATALOGUE.find((p) => p.id === lastId)?.category;

    const recommended = PROJECT_CATALOGUE
      .filter((p) => !completedIds.has(p.id) && (!lastCategory || p.category === lastCategory))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, PREVIEW_LIMIT);

    const finalList = recommended.length > 0
      ? recommended
      : PROJECT_CATALOGUE.filter((p) => !completedIds.has(p.id)).slice(0, PREVIEW_LIMIT);

    if (finalList.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="recommend-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recommend-heading">Recommended Projects</h2></div>
          <p class="${CSS.EMPTY}">You've completed every project — incredible work!</p>
        </section>
      `;
    }

    return `
      <section class="${CSS.SECTION}" aria-labelledby="recommend-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="recommend-heading">Recommended Projects</h2></div>
        <div class="${CSS.PREVIEW_GRID}" role="list" aria-label="Recommended projects">
          ${finalList.map((p) => this.#renderCard(p, s)).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderContinueProject(s) {
    const inProgress = Object.entries(s.projects.records)
      .filter(([, r]) => r.state === 'in-progress')
      .sort(([, a], [, b]) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgress.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="continue-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Project</h2></div>
          <p class="${CSS.EMPTY}">Start a project to see it here next time.</p>
        </section>
      `;
    }

    const [id, record] = inProgress[0];
    const meta = PROJECT_CATALOGUE.find((p) => p.id === id);
    const pct  = record.stepsTotal ? Math.round(((record.stepsCompleted ?? 0) / record.stepsTotal) * 100) : 0;

    return `
      <section class="${CSS.SECTION}" aria-labelledby="continue-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Project</h2></div>
        <button class="${CSS.CONTINUE_CARD}" type="button" data-action="continue-project" data-id="${escapeAttr(id)}"
                aria-label="Continue ${escapeAttr(meta?.title ?? id)}, ${pct}% complete">
          <span class="${CSS.CONTINUE_ICON}" aria-hidden="true" style="color:${meta?.accent ?? 'var(--color-primary)'}">
            ${escapeHtml(meta?.icon ?? '🔧')}
          </span>
          <span class="${CSS.CONTINUE_BODY}">
            <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(meta?.title ?? id)}</span>
            <span class="${CSS.CONTINUE_META}">${pct}% · ${relativeTime(record.startedAt)}</span>
            <span class="${CSS.CONTINUE_BAR}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <span class="${CSS.CONTINUE_BAR_FILL}" style="width:${pct}%"></span>
            </span>
          </span>
        </button>
      </section>
    `;
  }

  /**
   * @returns {string}
   */
  #renderCategoryNav() {
    const items = CATEGORIES.filter((c) => c.value !== 'all').map((c) => `
      <button class="${CSS.CATEGORY_NAV_ITEM}" type="button" data-action="filter-category" data-value="${escapeAttr(c.value)}"
              aria-label="Jump to ${escapeAttr(c.label)} projects">
        ${escapeHtml(c.label)}
      </button>
    `).join('');

    return `
      <nav class="${CSS.CATEGORY_NAV}" aria-label="Project categories">
        ${items}
      </nav>
    `;
  }

  // ---- Private: rendering — main grid ----------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderProjectGrid(s) {
    if (this.#filtered.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="grid-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="grid-heading">All Projects</h2></div>
          <div class="${CSS.EMPTY}" role="status">
            <p>No projects match your filters.</p>
            <button type="button" data-action="clear-all-filters" class="btn btn--primary"
                    aria-label="Clear all filters">Clear filters</button>
          </div>
        </section>
      `;
    }

    const visible = this.#filtered.slice(0, this.#loadedPages * PAGE_SIZE);
    const cards   = visible.map((p) => this.#renderCard(p, s)).join('');
    const hasMore = visible.length < this.#filtered.length;

    return `
      <section class="${CSS.SECTION}" aria-labelledby="grid-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="grid-heading">All Projects</h2></div>
        <div class="${CSS.GRID}" id="pj-grid" role="list" aria-label="${this.#filtered.length} projects">
          ${cards}
        </div>
        ${hasMore ? `
          <div class="${CSS.SENTINEL}" id="pj-sentinel" aria-hidden="true" style="height:4px"></div>
          <button class="${CSS.LOAD_MORE}" type="button" data-action="load-more"
                  aria-label="Load more projects">Load more projects</button>
        ` : ''}
      </section>
    `;
  }

  /**
   * Render a single project card. Used across the main grid and every
   * preview sub-section so behaviour is identical everywhere.
   *
   * @param {ProjectMeta} p
   * @param {object}      s
   * @returns {string}
   */
  #renderCard(p, s) {
    const record = s.projects.records[p.id];
    const state   = record?.state ?? null;
    const pct     = state === 'completed'
      ? 100
      : (record?.stepsTotal ? Math.round(((record.stepsCompleted ?? 0) / record.stepsTotal) * 100) : 0);

    const isBookmarked = this.#bookmarks.has(p.id);
    const isFavourite  = this.#favourites.has(p.id);

    const diffLabel = p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1);
    const diffClass = {
      beginner: CSS.CARD_BADGE_BEG, intermediate: CSS.CARD_BADGE_INT, advanced: CSS.CARD_BADGE_ADV,
    }[p.difficulty] ?? '';

    const ctaAction = state === 'completed' ? 'review-project' : state === 'in-progress' ? 'continue-project' : 'start-project';
    const ctaLabel  = state === 'completed' ? 'Review' : state === 'in-progress' ? 'Continue' : 'Start';

    const skillChips = p.skills.slice(0, 3).map((sk) => `<span class="${CSS.CARD_CHIP}">${escapeHtml(sk)}</span>`).join('');
    const techChips  = p.technologies.slice(0, 3).map((t) => `<span class="${CSS.CARD_CHIP} ${CSS.CARD_CHIP_TECH}">${escapeHtml(t)}</span>`).join('');

    return `
      <article class="${CSS.CARD}" role="listitem" data-id="${escapeAttr(p.id)}"
               aria-labelledby="pj-title-${escapeAttr(p.id)}">
        <div class="${CSS.CARD_THUMB}" style="background:${p.accent}20;color:${p.accent}" aria-hidden="true">
          <span style="font-size:2.25rem">${escapeHtml(p.icon)}</span>
          ${p.isNew ? `<span class="${CSS.CARD_BADGE_NEW}" aria-label="New project">New</span>` : ''}
        </div>

        <div class="${CSS.CARD_ACTIONS}">
          <button class="${CSS.CARD_BTN_BOOKMARK} ${isBookmarked ? CSS.CARD_BTN_BOOKMARK_ON : ''}"
                  type="button" data-action="toggle-bookmark" data-id="${escapeAttr(p.id)}"
                  aria-pressed="${isBookmarked}"
                  aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark'} ${escapeAttr(p.title)}">🔖</button>
          <button class="${CSS.CARD_BTN_FAV} ${isFavourite ? CSS.CARD_BTN_FAV_ON : ''}"
                  type="button" data-action="toggle-favourite" data-id="${escapeAttr(p.id)}"
                  aria-pressed="${isFavourite}"
                  aria-label="${isFavourite ? 'Remove from favourites' : 'Favourite'} ${escapeAttr(p.title)}">❤️</button>
          <button class="${CSS.CARD_BTN_SHARE}" type="button" data-action="share-project" data-id="${escapeAttr(p.id)}"
                  aria-label="Share ${escapeAttr(p.title)}">🔗</button>
        </div>

        <div class="${CSS.CARD_BODY}">
          <span class="${CSS.CARD_BADGE_DIFF} ${diffClass}">${escapeHtml(diffLabel)}</span>
          <h3 class="${CSS.CARD_TITLE}" id="pj-title-${escapeAttr(p.id)}">${escapeHtml(p.title)}</h3>
          <p class="${CSS.CARD_DESC}">${escapeHtml(p.description)}</p>
          <p class="${CSS.CARD_META}">🕐 ${p.estimatedHours}h · ⭐ +${p.xpReward} XP</p>

          <div class="${CSS.CARD_CHIPS}" aria-label="Skills learned">${skillChips}</div>
          <div class="${CSS.CARD_CHIPS}" aria-label="Technologies used">${techChips}</div>

          ${pct > 0 ? `
            <div class="${CSS.CARD_BAR}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="${pct}% complete">
              <div class="${CSS.CARD_BAR_FILL}" style="width:${pct}%;background:${p.accent}"></div>
            </div>
            <span class="${CSS.CARD_BAR_LABEL}">${pct}% complete</span>
          ` : ''}

          <button class="${CSS.CARD_CTA}" type="button" data-action="${escapeAttr(ctaAction)}" data-id="${escapeAttr(p.id)}"
                  aria-label="${escapeAttr(ctaLabel)}: ${escapeAttr(p.title)}" style="--cta-accent:${p.accent}">
            ${escapeHtml(ctaLabel)} Project
          </button>
        </div>
      </article>
    `;
  }

  // ---- Private: rendering — trending / difficulty previews ------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderTrendingProjects(s) {
    const trending = PROJECT_CATALOGUE.filter((p) => p.isTrending).slice(0, PREVIEW_LIMIT);
    if (trending.length === 0) return '';

    return `
      <section class="${CSS.SECTION}" aria-labelledby="trending-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="trending-heading">🔥 Trending Projects</h2></div>
        <div class="${CSS.PREVIEW_GRID}" role="list" aria-label="Trending projects">
          ${trending.map((p) => this.#renderCard(p, s)).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @param {string} difficulty
   * @param {string} title
   * @param {string} headingId
   * @returns {string}
   */
  #renderDifficultyPreview(s, difficulty, title, headingId) {
    const list = PROJECT_CATALOGUE
      .filter((p) => p.difficulty === difficulty)
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, PREVIEW_LIMIT);

    if (list.length === 0) return '';

    return `
      <section class="${CSS.SECTION}" aria-labelledby="${escapeAttr(headingId)}">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="${escapeAttr(headingId)}">${escapeHtml(title)}</h2></div>
        <div class="${CSS.PREVIEW_GRID}" role="list" aria-label="${escapeAttr(title)}">
          ${list.map((p) => this.#renderCard(p, s)).join('')}
        </div>
      </section>
    `;
  }

  // ---- Private: rendering — recently viewed / completed / saved -------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecentlyViewed(s) {
    const log = loadRecentlyViewed();
    if (log.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="viewed-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="viewed-heading">Recently Viewed</h2></div>
          <p class="${CSS.EMPTY}">Projects you view will appear here.</p>
        </section>
      `;
    }

    const items = log.map((entry) => {
      const meta = PROJECT_CATALOGUE.find((p) => p.id === entry.id);
      if (!meta) return '';
      return this.#renderSidebarItem(meta, relativeTime(entry.ts));
    }).filter(Boolean).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="viewed-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="viewed-heading">Recently Viewed</h2></div>
        <ul class="${CSS.SIDEBAR_LIST}" role="list" aria-label="Recently viewed projects">${items}</ul>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecentlyCompleted(s) {
    const completed = Object.entries(s.projects.records)
      .filter(([, r]) => r.state === 'completed' && r.completedAt)
      .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, RECENTLY_VIEWED_LIMIT);

    if (completed.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Recently Completed</h2></div>
          <p class="${CSS.EMPTY}">Finished projects will appear here.</p>
        </section>
      `;
    }

    const items = completed.map(([id, r]) => {
      const meta = PROJECT_CATALOGUE.find((p) => p.id === id);
      return meta ? this.#renderSidebarItem(meta, `Completed ${relativeTime(r.completedAt)}`) : '';
    }).filter(Boolean).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Recently Completed</h2></div>
        <ul class="${CSS.SIDEBAR_LIST}" role="list" aria-label="Recently completed projects">${items}</ul>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderSavedProjects(s) {
    const saved = PROJECT_CATALOGUE.filter((p) => this.#bookmarks.has(p.id));

    if (saved.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="saved-heading">
          <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="saved-heading">Saved Projects</h2></div>
          <p class="${CSS.EMPTY}">Bookmark a project to find it here quickly.</p>
        </section>
      `;
    }

    return `
      <section class="${CSS.SECTION}" aria-labelledby="saved-heading">
        <div class="${CSS.SECTION_HEADER}"><h2 class="${CSS.SECTION_TITLE}" id="saved-heading">Saved Projects</h2></div>
        <div class="${CSS.PREVIEW_GRID}" role="list" aria-label="Saved projects">
          ${saved.map((p) => this.#renderCard(p, s)).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectMeta} p
   * @param {string}      metaText
   * @returns {string}
   */
  #renderSidebarItem(p, metaText) {
    return `
      <li class="${CSS.SIDEBAR_ITEM}" role="listitem">
        <button type="button" data-action="continue-project" data-id="${escapeAttr(p.id)}"
                aria-label="Open ${escapeAttr(p.title)}">
          <span class="${CSS.SIDEBAR_ICON}" aria-hidden="true" style="color:${p.accent}">${escapeHtml(p.icon)}</span>
          <span class="${CSS.SIDEBAR_BODY}">
            <span class="${CSS.SIDEBAR_TITLE}">${escapeHtml(p.title)}</span>
            <span class="${CSS.SIDEBAR_META}">${escapeHtml(metaText)}</span>
          </span>
        </button>
      </li>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFooterCTA() {
    return `
      <section class="${CSS.FOOTER_CTA}" aria-labelledby="footer-cta-heading">
        <div class="${CSS.FOOTER_CTA_INNER}">
          <h2 id="footer-cta-heading">Ready to build something real?</h2>
          <button class="${CSS.FOOTER_CTA_BTN}" type="button" data-action="start-project"
                  data-id="${escapeAttr(PROJECT_CATALOGUE[0]?.id ?? '')}"
                  aria-label="Start a project">Start a Project</button>
        </div>
      </section>
    `;
  }

  // ---- Private: filtering -----------------------------------------------------

  /**
   * Apply the current filter, patch the grid, count label, and chips.
   */
  #applyFilters() {
    this.#loadedPages = 1;
    this.#computeFilteredList();
    this.#syncUrlParams();
    this.#replaceRegion('pj-grid-region', this.#renderProjectGrid(this.#summary));
    this.#updateHeaderCount();
    this.#refreshFilterChips();
    this.#refreshActiveFilters();

    const count = this.#filtered.length;
    this.#announce(count === 0 ? 'No projects found.' : `${count} project${count === 1 ? '' : 's'} found.`);
  }

  /**
   * Compute and cache #filtered from PROJECT_CATALOGUE + #filter.
   */
  #computeFilteredList() {
    const f = this.#filter;
    const q = normalise(f.search);

    let result = PROJECT_CATALOGUE.filter((p) => {
      if (f.category   !== 'all' && p.category   !== f.category)   return false;
      if (f.difficulty !== 'all' && p.difficulty !== f.difficulty) return false;
      if (f.technology !== 'all' && !p.technologies.includes(f.technology)) return false;
      if (f.bookmarked && !this.#bookmarks.has(p.id)) return false;

      if (q) {
        const haystack = [p.title, p.description, p.category, ...p.tags, ...p.skills, ...p.technologies]
          .map(normalise).join(' ');
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    this.#filtered = sortProjects(result, f.sort);
  }

  /**
   * @returns {boolean}
   */
  #hasActiveFilter() {
    const f = this.#filter;
    return f.search !== '' || f.category !== 'all' || f.difficulty !== 'all' ||
           f.technology !== 'all' || f.bookmarked;
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
      if (params.get('technology')) this.#filter.technology = params.get('technology');
      if (params.get('sort'))       this.#filter.sort       = params.get('sort');
      if (params.get('saved'))      this.#filter.bookmarked = params.get('saved') === 'true';
    } catch { /* ignore */ }
  }

  /**
   * Write the current filter state to the URL without navigation.
   */
  #syncUrlParams() {
    try {
      const f = this.#filter;
      const params = new URLSearchParams();
      if (f.search)                  params.set('q', f.search);
      if (f.category !== 'all')      params.set('category', f.category);
      if (f.difficulty !== 'all')    params.set('difficulty', f.difficulty);
      if (f.technology !== 'all')    params.set('technology', f.technology);
      if (f.sort !== 'recommended')  params.set('sort', f.sort);
      if (f.bookmarked)              params.set('saved', 'true');
      const qs  = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
  }

  /**
   * Update the count label in the hero without re-rendering it.
   */
  #updateHeaderCount() {
    const el = this.#root?.querySelector('#pj-count-label');
    if (!el) return;
    const total = PROJECT_CATALOGUE.length;
    const filtered = this.#filtered.length;
    el.textContent = `${this.#hasActiveFilter() ? `${filtered} of ${total}` : total} projects`;
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

  /**
   * Re-render the active-filters bar.
   */
  #refreshActiveFilters() {
    this.#replaceRegion('pj-active-filters-region', this.#renderActiveFilters());
  }

  // ---- Private: infinite scroll ------------------------------------------------

  /**
   * Attach an IntersectionObserver to the grid sentinel for infinite scroll.
   */
  #attachScrollObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    this.#scrollObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.#loadMoreProjects();
      }
    }, { rootMargin: '200px' });

    const attachSentinel = () => {
      const sentinel = this.#root?.querySelector('#pj-sentinel');
      if (sentinel) this.#scrollObserver?.observe(sentinel);
    };
    attachSentinel();

    const observer = new MutationObserver(attachSentinel);
    const grid = this.#root?.querySelector('#pj-grid-region');
    if (grid) {
      observer.observe(grid, { childList: true });
      this.#cleanupFns.push(() => observer.disconnect());
    }
  }

  /**
   * Load the next page of project cards.
   */
  #loadMoreProjects() {
    const maxPages = Math.ceil(this.#filtered.length / PAGE_SIZE);
    if (this.#loadedPages >= maxPages) return;
    this.#loadedPages++;
    this.#replaceRegion('pj-grid-region', this.#renderProjectGrid(this.#summary));
  }

  // ---- Private: DOM patching ----------------------------------------------------

  /**
   * @param {string} id
   * @param {string} html
   */
  #replaceRegion(id, html) {
    const el = this.#root?.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  // ---- Private: event listeners --------------------------------------------------

  /**
   * Attach all external event subscriptions and DOM click delegation.
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

    const onProjectCompleted = () => { this.#debouncedRefresh.cancel(); this.refresh(); };
    document.addEventListener('project:completed', onProjectCompleted);
    this.#cleanupFns.push(() => document.removeEventListener('project:completed', onProjectCompleted));

    const onProjectStarted = () => this.#debouncedRefresh();
    document.addEventListener('project:started', onProjectStarted);
    this.#cleanupFns.push(() => document.removeEventListener('project:started', onProjectStarted));

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
      if (e.detail?.pathname === '/projects') {
        this.#parseUrlParams();
        this.#applyFilters();
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener('router:afterNavigate', onRouterNavigate));
  }

  // ---- Private: click handler ------------------------------------------------------

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
      case 'start-project':
      case 'continue-project':
      case 'review-project': {
        const meta = PROJECT_CATALOGUE.find((p) => p.id === id);
        recordRecentlyViewed(id);
        this.#navigate(meta?.path ?? `/projects/${encodeURIComponent(id)}`);
        this.#dispatch(PROJECTS_EVENTS.SELECTED, { id, title: meta?.title ?? id, action });
        break;
      }

      case 'toggle-bookmark': {
        if (this.#bookmarks.has(id)) this.#bookmarks.delete(id); else this.#bookmarks.add(id);
        saveIdSet(BOOKMARK_KEY, this.#bookmarks);
        this.#updateCardToggle(id, 'bookmark', this.#bookmarks.has(id));
        if (this.#filter.bookmarked) this.#applyFilters();
        this.#replaceRegion('pj-saved-region', this.#renderSavedProjects(this.#summary));
        this.#announce(this.#bookmarks.has(id) ? 'Project saved.' : 'Removed from saved.');
        break;
      }

      case 'toggle-favourite': {
        if (this.#favourites.has(id)) this.#favourites.delete(id); else this.#favourites.add(id);
        saveIdSet(FAVOURITE_KEY, this.#favourites);
        this.#updateCardToggle(id, 'favourite', this.#favourites.has(id));
        this.#announce(this.#favourites.has(id) ? 'Added to favourites.' : 'Removed from favourites.');
        break;
      }

      case 'share-project': {
        const meta = PROJECT_CATALOGUE.find((p) => p.id === id);
        this.#shareProject(meta);
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

      case 'filter-technology':
        this.#filter.technology = value;
        this.#applyFilters();
        break;

      case 'filter-bookmarked':
        this.#filter.bookmarked = !this.#filter.bookmarked;
        this.#applyFilters();
        break;

      case 'clear-search':
      case 'remove-search':
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        this.#searchInput?.focus();
        break;

      case 'remove-category':
        this.#filter.category = 'all';
        this.#applyFilters();
        break;

      case 'remove-difficulty':
        this.#filter.difficulty = 'all';
        this.#applyFilters();
        break;

      case 'remove-technology':
        this.#filter.technology = 'all';
        this.#applyFilters();
        break;

      case 'remove-bookmarked':
        this.#filter.bookmarked = false;
        this.#applyFilters();
        break;

      case 'clear-all-filters':
        this.#filter = defaultFilter();
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        break;

      case 'load-more':
        this.#loadMoreProjects();
        break;

      default:
        this.#dispatch('projects:action', { action, id });
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
    const cards = this.#root?.querySelectorAll(`[data-id="${id}"].${CSS.CARD}`);
    cards?.forEach((card) => {
      const btnAction   = type === 'bookmark' ? 'toggle-bookmark' : 'toggle-favourite';
      const btn         = card.querySelector(`[data-action="${btnAction}"]`);
      if (!btn) return;
      const activeClass = type === 'bookmark' ? CSS.CARD_BTN_BOOKMARK_ON : CSS.CARD_BTN_FAV_ON;
      btn.classList.toggle(activeClass, active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /**
   * Share a project via the Web Share API, falling back to clipboard copy.
   *
   * @param {ProjectMeta|undefined} meta
   */
  #shareProject(meta) {
    if (!meta) return;
    const url  = `${window.location.origin}${meta.path}`;
    const text = `Check out "${meta.title}" on Python for AI!`;

    if (navigator.share) {
      navigator.share({ title: meta.title, text, url }).catch(() => { /* user cancelled */ });
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => this.#announce('Project link copied to clipboard.'))
        .catch(() => this.#announce('Could not copy link.'));
    }
  }

  // ---- Private: navigation helper -----------------------------------------------

  /**
   * @param {string} path
   */
  #navigate(path) {
    if (this.#config.router?.navigate) {
      this.#config.router.navigate(path);
    } else {
      window.location.href = path;
    }
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