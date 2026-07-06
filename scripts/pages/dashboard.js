/**
 * =============================================================================
 * DASHBOARD PAGE MODULE
 * scripts/pages/dashboard.js
 * -----------------------------------------------------------------------------
 * The learner's central hub for the Python for AI educational platform.
 * Aggregates progress data, gamification state, curriculum position, and
 * recommendations into a single reactive overview page.
 *
 * ARCHITECTURE:
 *   DashboardPage (default export)
 *     └─ Self-contained: reads all dynamic data from the injected
 *        ProgressTracker instance via getSummary(). No sub-components are
 *        imported. Static seed data (course metadata, curriculum order,
 *        recommendation pools, leaderboard preview) lives in module-level
 *        frozen constants, following the same pattern as tutorials.js and
 *        lesson-player.js.
 *
 * SECTIONS (rendered in document order):
 *   1.  Welcome Header          — time-aware greeting, user name, date
 *   2.  Profile Summary         — avatar initial, level, member-since
 *   3.  Continue Learning       — most recent in-progress tutorial/quiz/project
 *   4.  Daily Goal              — today's completion count vs. daily target
 *   5.  XP & Level              — animated ring, XP total, XP to next level
 *   6.  Learning Streak         — current/longest streak, freeze count
 *   7.  Weekly Progress Chart   — CSS bar chart of last 7 days' activity
 *   8.  Monthly Progress Chart  — CSS bar chart of last 5 weeks' activity
 *   9.  Course Progress Cards   — completion % for a curated course set
 *  10.  Recent Activity         — mixed timeline (tutorials/quizzes/achievements)
 *  11.  Recently Completed      — card grid of the last 5 finished lessons
 *  12.  Upcoming Lessons        — next lessons in curriculum order
 *  13.  Achievement Gallery     — unlocked + locked-preview badges
 *  14.  Leaderboard Preview     — mock top learners + the current user's row
 *  15.  Recommended Tutorials   — category-aware suggestions
 *  16.  Recommended Projects    — uncompleted project ideas
 *  17.  Quick Actions           — 6 shortcut buttons to platform areas
 *  18.  Notifications           — dashboard notification feed (from state.js)
 *  19.  Footer Integration      — lightweight CTA bridging into the global footer
 *
 * REACTIVE UPDATES:
 *   • state:updated         → refresh welcome header (name) and theme class
 *   • progress:updated      → full data refresh (debounced), re-renders all
 *                             tracker-dependent regions
 *   • lesson:completed      → immediate refresh (bypasses debounce)
 *   • quiz:completed        → immediate refresh (bypasses debounce)
 *   • playground:run        → refresh weekly/monthly chart only (activity signal)
 *   • theme:changed         → toggle dark-mode root class
 *   • router:afterNavigate  → no-op while mounted (router handles teardown)
 *
 * EVENT EMISSIONS:
 *   dashboard:mounted    { pathname }
 *   dashboard:updated    { section, timestamp }
 *   dashboard:refreshed  { timestamp }
 *   dashboard:destroyed  { pathname }
 *
 * LOADING / EMPTY / ERROR STATES:
 *   • Loading: a skeleton grid is painted synchronously in mount() and is
 *     replaced by the real content on the next animation frame, giving the
 *     browser a paint opportunity even when the tracker resolves instantly.
 *   • Empty: sections that depend on activity (Continue Learning, Recent
 *     Activity, Recently Completed, Achievements) render a friendly
 *     first-time-user message instead of an empty list.
 *   • Error: if the container is missing or the tracker throws unrecoverably,
 *     an error banner with a retry button (calls refresh()) is shown.
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces refresh completion and milestone changes
 *   • Every stat tile, chart, and card carries an aria-label summarising its value
 *   • Landmark roles: main, region, list, listitem, img (for charts/rings)
 *   • Reduced motion: XP ring animation and bar chart entrance are instant
 *   • Focus is moved to the page H1 on mount
 *
 * PERFORMANCE:
 *   • progress:updated is debounced at 250 ms to coalesce rapid XP bursts
 *   • lesson:completed / quiz:completed bypass the debounce for instant feedback
 *   • All chart and card regions are patched via targeted innerHTML replacement,
 *     never a full page re-render after the initial mount
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/dashboard',
 *     title:     'Dashboard',
 *     component: () => import('./pages/dashboard.js'),
 *   }
 *
 * EXPORTS:
 *   DashboardPage        — primary class (default export)
 *   DASHBOARD_PAGE_EVENTS — event name constants
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
 * Event names emitted by the dashboard page.
 * Named DASHBOARD_PAGE_EVENTS (rather than DASHBOARD_EVENTS) to avoid any
 * ambiguity with the reusable Dashboard widget component's own event map.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DASHBOARD_PAGE_EVENTS = Object.freeze({
  MOUNTED:    'dashboard:mounted',
  UPDATED:    'dashboard:updated',
  REFRESHED:  'dashboard:refreshed',
  DESTROYED:  'dashboard:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of completed activities required to satisfy the daily goal */
const DAILY_GOAL_COUNT = 1;

/** Debounce delay for progress:updated driven refreshes (ms) */
const REFRESH_DEBOUNCE_MS = 250;

/** Number of days shown in the weekly chart */
const WEEKLY_CHART_DAYS = 7;

/** Number of weeks shown in the monthly chart */
const MONTHLY_CHART_WEEKS = 5;

// ---------------------------------------------------------------------------
// Static seed data
// ---------------------------------------------------------------------------

/**
 * Curated course set for the "Course Progress Cards" section.
 * IDs match the tutorial IDs used throughout tutorials.js / lesson-player.js
 * so real completion records line up correctly.
 *
 * @type {ReadonlyArray<{ id: string, title: string, icon: string, accent: string, lessonCount: number, path: string }>}
 */
const COURSE_PROGRESS_SEED = Object.freeze([
  { id: 'python-basics',        title: 'Python Basics',              icon: '🐍', accent: 'var(--color-success)', lessonCount: 14, path: '/tutorials/python-basics'        },
  { id: 'numpy-fundamentals',   title: 'NumPy Fundamentals',         icon: '🔢', accent: 'var(--color-primary)', lessonCount: 13, path: '/tutorials/numpy-fundamentals'   },
  { id: 'pandas-data-analysis', title: 'Data Analysis with Pandas',  icon: '📊', accent: 'var(--color-warning)', lessonCount: 22, path: '/tutorials/pandas-data-analysis' },
  { id: 'ml-regression',        title: 'Linear & Logistic Regression', icon: '📉', accent: 'var(--color-accent)', lessonCount: 18, path: '/tutorials/ml-regression'      },
  { id: 'neural-networks-intro',title: 'Intro to Neural Networks',   icon: '🧠', accent: 'var(--color-danger)',  lessonCount: 25, path: '/tutorials/neural-networks-intro' },
]);

/**
 * Ordered curriculum used to derive "Upcoming Lessons".
 * The first N tutorials not yet completed (in this order) are shown.
 *
 * @type {ReadonlyArray<{ id: string, title: string, duration: string, icon: string, accent: string, path: string }>}
 */
const ORDERED_CURRICULUM = Object.freeze([
  { id: 'python-variables',      title: 'Variables and Data Types',      duration: '20 min', icon: '📦', accent: 'var(--color-success)', path: '/tutorials/python-variables'      },
  { id: 'python-functions',      title: 'Functions & Scope',             duration: '25 min', icon: '⚙️', accent: 'var(--color-primary)', path: '/tutorials/python-functions'      },
  { id: 'python-oop',            title: 'Object-Oriented Python',        duration: '3h 00m', icon: '🏛️', accent: 'var(--color-accent)',  path: '/tutorials/python-oop'             },
  { id: 'numpy-fundamentals',    title: 'NumPy Fundamentals',            duration: '2h 15m', icon: '🔢', accent: 'var(--color-primary)', path: '/tutorials/numpy-fundamentals'    },
  { id: 'pandas-data-analysis',  title: 'Data Analysis with Pandas',     duration: '4h 00m', icon: '📊', accent: 'var(--color-warning)', path: '/tutorials/pandas-data-analysis'  },
  { id: 'data-visualisation',    title: 'Data Visualisation',            duration: '2h 30m', icon: '📈', accent: 'var(--color-success)', path: '/tutorials/data-visualisation'    },
  { id: 'ml-regression',         title: 'Linear & Logistic Regression',  duration: '3h 30m', icon: '📉', accent: 'var(--color-accent)',  path: '/tutorials/ml-regression'         },
  { id: 'neural-networks-intro', title: 'Intro to Neural Networks',      duration: '5h 00m', icon: '🧠', accent: 'var(--color-danger)',  path: '/tutorials/neural-networks-intro' },
]);

/**
 * Recommendation pool for the "Recommended Tutorials" section.
 *
 * @type {ReadonlyArray<object>}
 */
const RECOMMENDATION_POOL = Object.freeze([
  { id: 'ml-classification',            title: 'Classification Algorithms',       category: 'machine-learning', icon: '🌳', accent: 'var(--color-success)', duration: '4h 00m',  popularityScore: 88, path: '/tutorials/ml-classification'            },
  { id: 'feature-engineering',          title: 'Feature Engineering',             category: 'machine-learning', icon: '⚗️', accent: 'var(--color-warning)', duration: '3h 00m',  popularityScore: 76, path: '/tutorials/feature-engineering'           },
  { id: 'convolutional-neural-networks',title: 'Convolutional Neural Networks',   category: 'deep-learning',    icon: '🖼️', accent: 'var(--color-accent)',  duration: '6h 30m',  popularityScore: 89, path: '/tutorials/convolutional-neural-networks' },
  { id: 'transformers-attention',       title: 'Attention & Transformers',        category: 'nlp',              icon: '🔄', accent: 'var(--color-primary)', duration: '7h 00m',  popularityScore: 97, path: '/tutorials/transformers-attention'        },
  { id: 'sentiment-analysis',           title: 'Sentiment Analysis Pipeline',      category: 'nlp',              icon: '😊', accent: 'var(--color-warning)', duration: '3h 45m',  popularityScore: 85, path: '/tutorials/sentiment-analysis'            },
  { id: 'time-series-forecasting',      title: 'Time Series Forecasting',         category: 'machine-learning', icon: '⏱️', accent: 'var(--color-primary)', duration: '5h 15m',  popularityScore: 79, path: '/tutorials/time-series-forecasting'       },
]);

/**
 * Project idea pool for the "Recommended Projects" section.
 *
 * @type {ReadonlyArray<object>}
 */
const RECOMMENDED_PROJECTS_SEED = Object.freeze([
  { id: 'build-image-classifier', title: 'Build an Image Classifier',   difficulty: 'advanced',     icon: '🏗️', accent: 'var(--color-danger)',  desc: 'Train a CNN and deploy it behind a simple REST API.',        path: '/projects/build-image-classifier' },
  { id: 'sentiment-dashboard',    title: 'Sentiment Analysis Dashboard',difficulty: 'intermediate', icon: '😊', accent: 'var(--color-warning)', desc: 'Classify tweets and visualise sentiment trends over time.', path: '/projects/sentiment-dashboard'    },
  { id: 'chatbot-transformer',    title: 'Transformer-Based Chatbot',   difficulty: 'advanced',     icon: '💬', accent: 'var(--color-primary)', desc: 'Fine-tune a small transformer model for Q&A.',              path: '/projects/chatbot-transformer'    },
  { id: 'sales-forecaster',       title: 'Sales Forecasting Tool',      difficulty: 'intermediate', icon: '📈', accent: 'var(--color-success)', desc: 'Predict next quarter sales using time-series models.',      path: '/projects/sales-forecaster'       },
]);

/**
 * Static leaderboard preview data. Clearly presented in the UI as a preview
 * of an upcoming feature — not a claim of real, live rankings.
 *
 * @type {ReadonlyArray<{ name: string, xp: number, initials: string }>}
 */
const LEADERBOARD_SEED = Object.freeze([
  { name: 'Grace H.',  xp: 4820, initials: 'GH' },
  { name: 'Alan T.',   xp: 4390, initials: 'AT' },
  { name: 'Margaret W.', xp: 3950, initials: 'MW' },
  { name: 'Linus B.',  xp: 3610, initials: 'LB' },
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:                 'db-page',
  ROOT_DARK:             'db-page--dark',
  ROOT_REDUCED:          'db-page--reduced-motion',
  LIVE:                  'db-page__live',

  GRID:                  'db-grid',

  // Welcome header
  WELCOME:               'db-welcome',
  WELCOME_GREETING:      'db-welcome__greeting',
  WELCOME_DATE:          'db-welcome__date',

  // Profile summary
  PROFILE:               'db-profile',
  PROFILE_AVATAR:        'db-profile__avatar',
  PROFILE_BODY:          'db-profile__body',
  PROFILE_NAME:          'db-profile__name',
  PROFILE_META:          'db-profile__meta',

  // Section scaffold
  SECTION:               'db-section',
  SECTION_INNER:         'db-section__inner',
  SECTION_HEADER:        'db-section__header',
  SECTION_TITLE:         'db-section__title',
  SECTION_LINK:          'db-section__link',
  CARD:                  'db-card',

  // Continue learning
  CONTINUE_GRID:         'db-continue__grid',
  CONTINUE_CARD:         'db-continue__card',
  CONTINUE_ICON:         'db-continue__icon',
  CONTINUE_BODY:         'db-continue__body',
  CONTINUE_TITLE:        'db-continue__title',
  CONTINUE_META:         'db-continue__meta',
  CONTINUE_BAR:          'db-continue__bar',
  CONTINUE_BAR_FILL:     'db-continue__bar-fill',

  // Daily goal
  GOAL:                  'db-goal',
  GOAL_RING:             'db-goal__ring',
  GOAL_LABEL:            'db-goal__label',
  GOAL_SUB:              'db-goal__sub',
  GOAL_DONE:             'db-goal--done',

  // XP / level
  XP_CARD:               'db-xp',
  XP_RING_WRAP:          'db-xp__ring-wrap',
  XP_RING_SVG:           'db-xp__ring-svg',
  XP_RING_TRACK:         'db-xp__ring-track',
  XP_RING_FILL:          'db-xp__ring-fill',
  XP_LEVEL:              'db-xp__level',
  XP_TOTAL:              'db-xp__total',
  XP_NEXT:               'db-xp__next',

  // Streak
  STREAK:                'db-streak',
  STREAK_FLAME:          'db-streak__flame',
  STREAK_VALUE:          'db-streak__value',
  STREAK_LABEL:          'db-streak__label',
  STREAK_META:           'db-streak__meta',

  // Charts
  CHART:                 'db-chart',
  CHART_BARS:            'db-chart__bars',
  CHART_BAR_COL:         'db-chart__bar-col',
  CHART_BAR:             'db-chart__bar',
  CHART_BAR_LABEL:       'db-chart__bar-label',
  CHART_BAR_VALUE:       'db-chart__bar-value',

  // Course progress
  COURSE_GRID:           'db-courses__grid',
  COURSE_CARD:           'db-courses__card',
  COURSE_ICON:           'db-courses__icon',
  COURSE_TITLE:          'db-courses__title',
  COURSE_BAR:            'db-courses__bar',
  COURSE_BAR_FILL:       'db-courses__bar-fill',
  COURSE_PCT:            'db-courses__pct',

  // Activity timeline
  ACTIVITY_LIST:         'db-activity__list',
  ACTIVITY_ITEM:         'db-activity__item',
  ACTIVITY_ICON:         'db-activity__icon',
  ACTIVITY_BODY:         'db-activity__body',
  ACTIVITY_TITLE:        'db-activity__title',
  ACTIVITY_TIME:         'db-activity__time',
  ACTIVITY_EMPTY:        'db-activity__empty',

  // Completed lessons
  COMPLETED_GRID:        'db-completed__grid',
  COMPLETED_CARD:        'db-completed__card',
  COMPLETED_ICON:        'db-completed__icon',
  COMPLETED_TITLE:       'db-completed__title',
  COMPLETED_META:        'db-completed__meta',

  // Upcoming lessons
  UPCOMING_LIST:         'db-upcoming__list',
  UPCOMING_ITEM:         'db-upcoming__item',
  UPCOMING_ICON:         'db-upcoming__icon',
  UPCOMING_BODY:         'db-upcoming__body',
  UPCOMING_TITLE:        'db-upcoming__title',
  UPCOMING_META:         'db-upcoming__meta',

  // Achievements
  ACHIEVEMENT_GRID:      'db-achievements__grid',
  ACHIEVEMENT_BADGE:     'db-achievements__badge',
  ACHIEVEMENT_LOCKED:    'db-achievements__badge--locked',
  ACHIEVEMENT_ICON:      'db-achievements__icon',
  ACHIEVEMENT_TITLE:     'db-achievements__title',

  // Leaderboard
  LEADERBOARD_LIST:      'db-leaderboard__list',
  LEADERBOARD_ITEM:      'db-leaderboard__item',
  LEADERBOARD_ITEM_ME:   'db-leaderboard__item--me',
  LEADERBOARD_RANK:      'db-leaderboard__rank',
  LEADERBOARD_AVATAR:    'db-leaderboard__avatar',
  LEADERBOARD_NAME:      'db-leaderboard__name',
  LEADERBOARD_XP:        'db-leaderboard__xp',
  LEADERBOARD_NOTE:      'db-leaderboard__note',

  // Recommended tutorials / projects
  RECOMMEND_GRID:        'db-recommend__grid',
  RECOMMEND_CARD:        'db-recommend__card',
  RECOMMEND_ICON:        'db-recommend__icon',
  RECOMMEND_TITLE:       'db-recommend__title',
  RECOMMEND_META:        'db-recommend__meta',
  RECOMMEND_CTA:         'db-recommend__cta',
  PROJECT_GRID:          'db-projects__grid',
  PROJECT_CARD:          'db-projects__card',
  PROJECT_BADGE:         'db-projects__badge',
  PROJECT_TITLE:         'db-projects__title',
  PROJECT_DESC:          'db-projects__desc',
  PROJECT_CTA:           'db-projects__cta',

  // Quick actions
  ACTIONS_GRID:          'db-actions__grid',
  ACTION_CARD:           'db-actions__card',
  ACTION_ICON:           'db-actions__icon',
  ACTION_LABEL:          'db-actions__label',

  // Notifications
  NOTIF_LIST:            'db-notifications__list',
  NOTIF_ITEM:            'db-notifications__item',
  NOTIF_ITEM_NEW:        'db-notifications__item--new',
  NOTIF_ICON:            'db-notifications__icon',
  NOTIF_BODY:            'db-notifications__body',
  NOTIF_TITLE:           'db-notifications__title',
  NOTIF_TIME:            'db-notifications__time',
  NOTIF_EMPTY:           'db-notifications__empty',

  // Footer CTA
  FOOTER_CTA:            'db-footer-cta',
  FOOTER_CTA_INNER:      'db-footer-cta__inner',
  FOOTER_CTA_BTN:        'db-footer-cta__btn',

  // States
  SKELETON:              'db-skeleton',
  SKELETON_CARD:         'db-skeleton__card',
  EMPTY:                 'db-empty',
  ERROR_STATE:           'db-error',
  ERROR_BTN:             'db-error__btn',
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
 * Return the "YYYY-MM-DD" key for a timestamp in local time.
 * @param {number} ts
 * @returns {string}
 */
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Return a zero-state summary matching ProgressTracker.getSummary()'s shape.
 * Used whenever no tracker is available or the tracker throws.
 *
 * @returns {object}
 */
function emptySummary() {
  return {
    xp: 0, level: 1, progressPct: 0, xpForNext: 100, xpNeeded: 100, isMaxLevel: false,
    streak:       { current: 0, longest: 0, lastDate: null, freezes: 0 },
    tutorials:    { started: 0, completed: 0, pct: 0, records: {} },
    quizzes:      { attempted: 0, passed: 0, accuracy: 0, pct: 0, records: {} },
    projects:     { total: 0, completed: 0, pct: 0, records: {} },
    achievements: { unlocked: 0, total: 33, pct: 0, recent: [], all: [] },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/**
 * Safely fetch a summary from the tracker, falling back to a zero-state.
 *
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
 * Collect every timestamped activity event from a summary: tutorial
 * completions, quiz attempts, and project completions.
 *
 * @param {object} summary
 * @returns {number[]} Array of Unix ms timestamps
 */
function collectActivityTimestamps(summary) {
  const timestamps = [];

  for (const t of Object.values(summary.tutorials?.records ?? {})) {
    if (t.completedAt) timestamps.push(t.completedAt);
  }
  for (const q of Object.values(summary.quizzes?.records ?? {})) {
    if (q.lastAttemptAt) timestamps.push(q.lastAttemptAt);
  }
  for (const p of Object.values(summary.projects?.records ?? {})) {
    if (p.completedAt) timestamps.push(p.completedAt);
  }

  return timestamps;
}

/**
 * Bucket activity timestamps into the last N days.
 *
 * @param {number[]} timestamps
 * @param {number}   days
 * @returns {Array<{ label: string, count: number, isToday: boolean }>}
 */
function bucketByDay(timestamps, days) {
  const today   = new Date();
  const buckets = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });
    const count = timestamps.filter((ts) => dateKey(ts) === key).length;
    buckets.push({ label, count, isToday: i === 0 });
  }

  return buckets;
}

/**
 * Bucket activity timestamps into the last N weeks.
 *
 * @param {number[]} timestamps
 * @param {number}   weeks
 * @returns {Array<{ label: string, count: number, isCurrent: boolean }>}
 */
function bucketByWeek(timestamps, weeks) {
  const now     = Date.now();
  const buckets = [];
  const msWeek  = 7 * 86_400_000;

  for (let i = weeks - 1; i >= 0; i--) {
    const end   = now - i * msWeek;
    const start = end - msWeek;
    const count = timestamps.filter((ts) => ts > start && ts <= end).length;
    const label = new Date(start + msWeek).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    buckets.push({ label, count, isCurrent: i === 0 });
  }

  return buckets;
}

/**
 * Compute today's completed-activity count for the daily goal indicator.
 *
 * @param {object} summary
 * @returns {number}
 */
function computeTodayCount(summary) {
  const todayKey = dateKey(Date.now());
  return collectActivityTimestamps(summary).filter((ts) => dateKey(ts) === todayKey).length;
}

// ---------------------------------------------------------------------------
// DashboardPage — primary class
// ---------------------------------------------------------------------------

/**
 * Learning dashboard page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve theme, fetch initial summary
 *   3. mount()               — render skeleton, then real content, attach events
 *   4. refresh()             — re-fetch tracker data, patch dynamic regions
 *   5. destroy()             — teardown all listeners and DOM
 */
export default class DashboardPage {

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
  /** @type {boolean} */ #hasError  = false;

  /** @type {object} — latest progress summary */
  #summary = emptySummary();

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #root       = null;
  /** @type {HTMLElement|null} */ #liveRegion = null;

  // ---- Debounced handlers ---------------------------------------------------

  /** @type {Function & { cancel: () => void, flush: () => void }} */
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

    this.#debouncedRefresh = debounce(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new DashboardPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker ?? null,
      router:      ctx?.meta?.router  ?? null,
      store:       ctx?.meta?.store   ?? null,
    });
    outlet.__dashboardPage = instance;
    instance.#root         = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__dashboardPage?.destroy();
    delete outlet.__dashboardPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve theme and fetch the initial progress summary.
   *
   * @returns {DashboardPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    this.#summary = getSummary(this.#config.tracker);

    return this;
  }

  /**
   * Render a skeleton immediately, then swap in real content and attach
   * all event listeners.
   *
   * @returns {DashboardPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[DashboardPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', 'Learning Dashboard');
    this.#root.className = CSS.ROOT;
    this.#root.innerHTML = this.#renderSkeleton();

    requestAnimationFrame(() => {
      if (this.#destroyed) return;
      this.render();
      this.#attachEventListeners();
      this.#mounted = true;

      requestAnimationFrame(() => {
        this.#root?.querySelector('h1')?.focus({ preventScroll: true });
      });

      this.#dispatch(DASHBOARD_PAGE_EVENTS.MOUNTED, { pathname: '/dashboard' });
      this.#announce('Dashboard loaded.');
    });

    return this;
  }

  /**
   * Generate and inject the complete dashboard HTML from the current summary.
   *
   * @returns {DashboardPage} this
   */
  render() {
    if (!this.#root) return this;

    if (this.#hasError) {
      this.#root.innerHTML = this.#renderErrorState('Something went wrong loading your dashboard.');
      return this;
    }

    const s       = this.#summary;
    const isDark  = this.#theme === 'dark';
    const reduced = prefersReducedMotion();

    this.#root.className = [
      CSS.ROOT,
      isDark  ? CSS.ROOT_DARK    : '',
      reduced ? CSS.ROOT_REDUCED : '',
    ].filter(Boolean).join(' ');

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      <h1 tabindex="-1" class="sr-only">Learning Dashboard</h1>

      <div class="${CSS.GRID}">
        <div id="db-welcome-region">${this.#renderWelcomeHeader(s)}</div>
        <div id="db-profile-region">${this.#renderProfileSummary(s)}</div>
        <div id="db-continue-region">${this.#renderContinueLearning(s)}</div>
        <div id="db-goal-region">${this.#renderDailyGoal(s)}</div>
        <div id="db-xp-region">${this.#renderXpLevelCard(s)}</div>
        <div id="db-streak-region">${this.#renderStreak(s)}</div>
        <div id="db-weekly-region">${this.#renderWeeklyChart(s)}</div>
        <div id="db-monthly-region">${this.#renderMonthlyChart(s)}</div>
        <div id="db-courses-region">${this.#renderCourseProgress(s)}</div>
        <div id="db-activity-region">${this.#renderRecentActivity(s)}</div>
        <div id="db-completed-region">${this.#renderCompletedLessons(s)}</div>
        <div id="db-upcoming-region">${this.#renderUpcomingLessons(s)}</div>
        <div id="db-achievements-region">${this.#renderAchievements(s)}</div>
        <div id="db-leaderboard-region">${this.#renderLeaderboard(s)}</div>
        <div id="db-recommend-tutorials-region">${this.#renderRecommendedTutorials(s)}</div>
        <div id="db-recommend-projects-region">${this.#renderRecommendedProjects(s)}</div>
        <div id="db-actions-region">${this.#renderQuickActions()}</div>
        <div id="db-notifications-region">${this.#renderNotifications()}</div>
      </div>

      ${this.#renderFooterCTA()}
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);

    requestAnimationFrame(() => this.#animateXpRing(s));

    return this;
  }

  /**
   * Re-fetch tracker data and patch every dynamic region.
   *
   * @returns {DashboardPage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    this.#summary = getSummary(this.#config.tracker);
    const s = this.#summary;

    this.#replaceRegion('db-continue-region',            this.#renderContinueLearning(s));
    this.#replaceRegion('db-goal-region',                 this.#renderDailyGoal(s));
    this.#replaceRegion('db-xp-region',                   this.#renderXpLevelCard(s));
    this.#replaceRegion('db-streak-region',               this.#renderStreak(s));
    this.#replaceRegion('db-weekly-region',               this.#renderWeeklyChart(s));
    this.#replaceRegion('db-monthly-region',              this.#renderMonthlyChart(s));
    this.#replaceRegion('db-courses-region',              this.#renderCourseProgress(s));
    this.#replaceRegion('db-activity-region',             this.#renderRecentActivity(s));
    this.#replaceRegion('db-completed-region',            this.#renderCompletedLessons(s));
    this.#replaceRegion('db-upcoming-region',              this.#renderUpcomingLessons(s));
    this.#replaceRegion('db-achievements-region',         this.#renderAchievements(s));
    this.#replaceRegion('db-leaderboard-region',          this.#renderLeaderboard(s));
    this.#replaceRegion('db-recommend-tutorials-region',  this.#renderRecommendedTutorials(s));
    this.#replaceRegion('db-recommend-projects-region',   this.#renderRecommendedProjects(s));

    requestAnimationFrame(() => this.#animateXpRing(s));

    this.#dispatch(DASHBOARD_PAGE_EVENTS.UPDATED,   { section: 'all', timestamp: Date.now() });
    this.#dispatch(DASHBOARD_PAGE_EVENTS.REFRESHED, { timestamp: Date.now() });

    return this;
  }

  /**
   * Tear down all listeners and clear the DOM.
   *
   * @returns {DashboardPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedRefresh.cancel();

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

    this.#dispatch(DASHBOARD_PAGE_EVENTS.DESTROYED, { pathname: '/dashboard' });
    return this;
  }

  // ---- Private: skeleton / error states -------------------------------------

  /**
   * @returns {string}
   */
  #renderSkeleton() {
    const cards = Array.from({ length: 8 })
      .map(() => `<div class="${CSS.SKELETON_CARD}" aria-hidden="true"></div>`)
      .join('');

    return `
      <div class="${CSS.SKELETON}" role="status" aria-label="Loading your dashboard">
        ${cards}
      </div>
    `;
  }

  /**
   * @param {string} message
   * @returns {string}
   */
  #renderErrorState(message) {
    return `
      <div class="${CSS.ERROR_STATE}" role="alert">
        <p>${escapeHtml(message)}</p>
        <button class="${CSS.ERROR_BTN}"
                type="button"
                data-action="retry"
                aria-label="Retry loading the dashboard">
          Try Again
        </button>
      </div>
    `;
  }

  // ---- Private: 1. Welcome header --------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderWelcomeHeader(s) {
    let name = '';
    if (this.#config.store) {
      try { name = this.#config.store.getUser()?.name ?? ''; } catch { /* ignore */ }
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    return `
      <section class="${CSS.SECTION} ${CSS.WELCOME}" aria-labelledby="welcome-heading">
        <h2 class="${CSS.WELCOME_GREETING}" id="welcome-heading">
          ${escapeHtml(greeting())}${name ? `, ${escapeHtml(name)}` : ''}!
        </h2>
        <p class="${CSS.WELCOME_DATE}">${escapeHtml(today)}</p>
      </section>
    `;
  }

  // ---- Private: 2. Profile summary --------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderProfileSummary(s) {
    let name  = 'Learner';
    let email = '';
    if (this.#config.store) {
      try {
        const user = this.#config.store.getUser();
        name  = user?.name  || 'Learner';
        email = user?.email || '';
      } catch { /* ignore */ }
    }

    const initial = name.trim().charAt(0).toUpperCase() || 'L';
    const memberSince = s.createdAt
      ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'recently';

    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.PROFILE}" aria-labelledby="profile-heading">
        <h2 class="sr-only" id="profile-heading">Profile Summary</h2>
        <div class="${CSS.PROFILE_AVATAR}" aria-hidden="true">${escapeHtml(initial)}</div>
        <div class="${CSS.PROFILE_BODY}">
          <span class="${CSS.PROFILE_NAME}">${escapeHtml(name)}</span>
          <span class="${CSS.PROFILE_META}">
            Level ${s.level} · Member since ${escapeHtml(memberSince)}
          </span>
          ${email ? `<span class="${CSS.PROFILE_META}">${escapeHtml(email)}</span>` : ''}
        </div>
      </section>
    `;
  }

  // ---- Private: 3. Continue learning ------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderContinueLearning(s) {
    const items = [];

    const inProgressTutorials = Object.entries(s.tutorials.records)
      .filter(([, t]) => t.startedAt && !t.completedAt)
      .sort(([, a], [, b]) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressTutorials.length > 0) {
      const [id, t] = inProgressTutorials[0];
      const meta = ORDERED_CURRICULUM.find((c) => c.id === id);
      items.push({
        icon:   meta?.icon ?? '📖',
        title:  t.title ?? meta?.title ?? id,
        meta:   `${relativeTime(t.startedAt)}`,
        accent: meta?.accent ?? 'var(--color-primary)',
        path:   meta?.path ?? `/tutorials/${id}`,
      });
    }

    const inProgressProjects = Object.entries(s.projects.records)
      .filter(([, p]) => p.state === 'in-progress')
      .sort(([, a], [, b]) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressProjects.length > 0) {
      const [id, p] = inProgressProjects[0];
      items.push({
        icon:   '🔧',
        title:  p.title ?? id,
        meta:   `In progress · ${relativeTime(p.startedAt)}`,
        accent: 'var(--color-accent)',
        path:   `/projects/${id}`,
      });
    }

    if (items.length === 0) {
      return `
        <section class="${CSS.SECTION} ${CSS.CARD}" aria-labelledby="continue-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Learning</h2>
          </div>
          <p class="${CSS.EMPTY}">
            You haven't started a tutorial yet — jump in and pick one up!
          </p>
          <button class="btn btn--primary"
                  type="button"
                  data-action="browse-tutorials"
                  aria-label="Browse tutorials">
            Browse Tutorials
          </button>
        </section>
      `;
    }

    const cards = items.map((item) => `
      <button class="${CSS.CONTINUE_CARD}"
              type="button"
              data-action="navigate"
              data-path="${escapeAttr(item.path)}"
              aria-label="Continue: ${escapeAttr(item.title)}">
        <span class="${CSS.CONTINUE_ICON}" aria-hidden="true"
              style="color:${item.accent}">${escapeHtml(item.icon)}</span>
        <span class="${CSS.CONTINUE_BODY}">
          <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.CONTINUE_META}">${escapeHtml(item.meta)}</span>
        </span>
      </button>
    `).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.CARD}" aria-labelledby="continue-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Learning</h2>
        </div>
        <div class="${CSS.CONTINUE_GRID}">${cards}</div>
      </section>
    `;
  }

  // ---- Private: 4. Daily goal --------------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderDailyGoal(s) {
    const todayCount = computeTodayCount(s);
    const pct        = Math.min(100, Math.round((todayCount / DAILY_GOAL_COUNT) * 100));
    const done        = todayCount >= DAILY_GOAL_COUNT;
    const circumference = 2 * Math.PI * 40;
    const offset         = circumference * (1 - pct / 100);

    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.GOAL} ${done ? CSS.GOAL_DONE : ''}"
               aria-labelledby="goal-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="goal-heading">Daily Goal</h2>
        <svg class="${CSS.GOAL_RING}"
             viewBox="0 0 96 96"
             role="img"
             aria-label="Daily goal: ${todayCount} of ${DAILY_GOAL_COUNT} activities complete">
          <circle cx="48" cy="48" r="40" fill="none" stroke-width="8"
                  style="stroke:var(--color-border)"/>
          <circle cx="48" cy="48" r="40" fill="none" stroke-width="8"
                  stroke-linecap="round"
                  stroke-dasharray="${circumference.toFixed(2)}"
                  stroke-dashoffset="${offset.toFixed(2)}"
                  style="stroke:var(--color-success);transform:rotate(-90deg);transform-origin:50% 50%"/>
        </svg>
        <span class="${CSS.GOAL_LABEL}">
          ${done ? '✅ Goal complete!' : `${todayCount} / ${DAILY_GOAL_COUNT} today`}
        </span>
        <span class="${CSS.GOAL_SUB}">
          ${done ? 'Great work — see you tomorrow!' : 'Complete one lesson or quiz to hit your goal.'}
        </span>
      </section>
    `;
  }

  // ---- Private: 5. XP & level --------------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderXpLevelCard(s) {
    const circumference = 2 * Math.PI * 52;
    const offset         = circumference * (1 - (s.progressPct ?? 0) / 100);

    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.XP_CARD}" aria-labelledby="xp-heading">
        <h2 class="sr-only" id="xp-heading">XP and Level</h2>
        <div class="${CSS.XP_RING_WRAP}"
             role="img"
             aria-label="Level ${s.level}, ${s.progressPct ?? 0}% to next level">
          <svg class="${CSS.XP_RING_SVG}" viewBox="0 0 120 120" aria-hidden="true">
            <circle class="${CSS.XP_RING_TRACK}" cx="60" cy="60" r="52" fill="none" stroke-width="9"/>
            <circle class="${CSS.XP_RING_FILL}"
                    id="db-xp-ring"
                    cx="60" cy="60" r="52" fill="none" stroke-width="9"
                    stroke-linecap="round"
                    stroke-dasharray="${circumference.toFixed(2)}"
                    stroke-dashoffset="${circumference.toFixed(2)}"
                    data-target="${offset.toFixed(2)}"
                    style="transform:rotate(-90deg);transform-origin:50% 50%"/>
          </svg>
          <span class="${CSS.XP_LEVEL}">Lv ${s.level}</span>
        </div>
        <span class="${CSS.XP_TOTAL}">${s.xp.toLocaleString()} XP</span>
        <span class="${CSS.XP_NEXT}">
          ${s.isMaxLevel ? 'Max level reached!' : `${s.xpForNext ?? 0} XP to next level`}
        </span>
      </section>
    `;
  }

  /**
   * Animate the XP ring from 0 to its computed offset.
   * @param {object} s
   */
  #animateXpRing(s) {
    const ring = this.#root?.querySelector('#db-xp-ring');
    if (!ring) return;
    const target = ring.dataset.target ?? '0';
    if (prefersReducedMotion()) {
      ring.setAttribute('stroke-dashoffset', target);
      return;
    }
    ring.style.transition = 'stroke-dashoffset 1s ease-out';
    requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', target));
  }

  // ---- Private: 6. Streak --------------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderStreak(s) {
    const { current, longest, freezes } = s.streak;
    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.STREAK}" aria-labelledby="streak-heading">
        <h2 class="sr-only" id="streak-heading">Learning Streak</h2>
        <span class="${CSS.STREAK_FLAME}" aria-hidden="true"
              style="color:${current > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)'}">🔥</span>
        <span class="${CSS.STREAK_VALUE}" aria-label="${current} day streak">${current}</span>
        <span class="${CSS.STREAK_LABEL}">Day Streak</span>
        <span class="${CSS.STREAK_META}">
          Longest: ${longest} · Freezes: ${freezes}
        </span>
      </section>
    `;
  }

  // ---- Private: 7 & 8. Charts --------------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderWeeklyChart(s) {
    const timestamps = collectActivityTimestamps(s);
    const buckets    = bucketByDay(timestamps, WEEKLY_CHART_DAYS);
    const maxCount   = Math.max(1, ...buckets.map((b) => b.count));

    const bars = buckets.map((b) => `
      <div class="${CSS.CHART_BAR_COL}">
        <span class="${CSS.CHART_BAR_VALUE}">${b.count > 0 ? b.count : ''}</span>
        <div class="${CSS.CHART_BAR}"
             style="height:${Math.max(4, (b.count / maxCount) * 100)}%;
                    background:${b.isToday ? 'var(--color-primary)' : 'var(--color-border)'}"
             role="img"
             aria-label="${escapeAttr(b.label)}: ${b.count} activities"></div>
        <span class="${CSS.CHART_BAR_LABEL}">${escapeHtml(b.label)}</span>
      </div>
    `).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.CHART}" aria-labelledby="weekly-chart-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="weekly-chart-heading">Weekly Progress</h2>
        <div class="${CSS.CHART_BARS}" role="list" aria-label="Activity over the last 7 days">
          ${bars}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderMonthlyChart(s) {
    const timestamps = collectActivityTimestamps(s);
    const buckets     = bucketByWeek(timestamps, MONTHLY_CHART_WEEKS);
    const maxCount    = Math.max(1, ...buckets.map((b) => b.count));

    const bars = buckets.map((b) => `
      <div class="${CSS.CHART_BAR_COL}">
        <span class="${CSS.CHART_BAR_VALUE}">${b.count > 0 ? b.count : ''}</span>
        <div class="${CSS.CHART_BAR}"
             style="height:${Math.max(4, (b.count / maxCount) * 100)}%;
                    background:${b.isCurrent ? 'var(--color-accent)' : 'var(--color-border)'}"
             role="img"
             aria-label="Week of ${escapeAttr(b.label)}: ${b.count} activities"></div>
        <span class="${CSS.CHART_BAR_LABEL}">${escapeHtml(b.label)}</span>
      </div>
    `).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.CARD} ${CSS.CHART}" aria-labelledby="monthly-chart-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="monthly-chart-heading">Monthly Progress</h2>
        <div class="${CSS.CHART_BARS}" role="list" aria-label="Activity over the last 5 weeks">
          ${bars}
        </div>
      </section>
    `;
  }

  // ---- Private: 9. Course progress cards ----------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderCourseProgress(s) {
    const cards = COURSE_PROGRESS_SEED.map((course) => {
      const record = s.tutorials.records[course.id];
      const pct    = record?.completedAt
        ? 100
        : (record?.lastSection && record?.totalSections
          ? Math.round((record.lastSection / record.totalSections) * 100)
          : 0);

      return `
        <button class="${CSS.COURSE_CARD}"
                type="button"
                data-action="navigate"
                data-path="${escapeAttr(course.path)}"
                aria-label="${escapeAttr(course.title)}: ${pct}% complete">
          <span class="${CSS.COURSE_ICON}" aria-hidden="true"
                style="color:${course.accent}">${escapeHtml(course.icon)}</span>
          <span class="${CSS.COURSE_TITLE}">${escapeHtml(course.title)}</span>
          <span class="${CSS.COURSE_BAR}"
                role="progressbar"
                aria-valuenow="${pct}"
                aria-valuemin="0"
                aria-valuemax="100">
            <span class="${CSS.COURSE_BAR_FILL}" style="width:${pct}%;background:${course.accent}"></span>
          </span>
          <span class="${CSS.COURSE_PCT}">${pct}%</span>
        </button>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="courses-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="courses-heading">Course Progress</h2>
        </div>
        <div class="${CSS.COURSE_GRID}" role="list" aria-label="Course completion progress">
          ${cards}
        </div>
      </section>
    `;
  }

  // ---- Private: 10. Recent activity ----------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecentActivity(s) {
    const items = [];

    Object.values(s.tutorials.records)
      .filter((t) => t.completedAt)
      .forEach((t) => items.push({ ts: t.completedAt, icon: '📖', title: `Completed: ${t.title ?? 'Tutorial'}`, accent: 'var(--color-primary)' }));

    Object.values(s.quizzes.records)
      .filter((q) => q.lastAttemptAt)
      .forEach((q) => items.push({
        ts: q.lastAttemptAt, icon: '✏️',
        title: `Quiz: ${q.title ?? 'Quiz'} — ${q.totalQuestions ? Math.round((q.bestScore / q.totalQuestions) * 100) : 0}%`,
        accent: 'var(--color-success)',
      }));

    Object.values(s.projects.records)
      .filter((p) => p.completedAt)
      .forEach((p) => items.push({ ts: p.completedAt, icon: '🔧', title: `Completed project: ${p.title ?? 'Project'}`, accent: 'var(--color-accent)' }));

    s.achievements.recent.slice(0, 3).forEach((a) => {
      if (a.unlockedAt) items.push({ ts: a.unlockedAt, icon: '🏆', title: `Achievement: ${a.title ?? a.id}`, accent: 'var(--color-warning)' });
    });

    items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const visible = items.slice(0, 8);

    if (visible.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="activity-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="activity-heading">Recent Activity</h2>
          </div>
          <p class="${CSS.ACTIVITY_EMPTY}">No activity yet. Complete a lesson to see it here.</p>
        </section>
      `;
    }

    const rows = visible.map((item) => `
      <li class="${CSS.ACTIVITY_ITEM}">
        <span class="${CSS.ACTIVITY_ICON}" aria-hidden="true" style="color:${item.accent}">${escapeHtml(item.icon)}</span>
        <span class="${CSS.ACTIVITY_BODY}">
          <span class="${CSS.ACTIVITY_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.ACTIVITY_TIME}">${relativeTime(item.ts)}</span>
        </span>
      </li>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="activity-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="activity-heading">Recent Activity</h2>
        </div>
        <ul class="${CSS.ACTIVITY_LIST}" role="list" aria-label="Recent learning activity">
          ${rows}
        </ul>
      </section>
    `;
  }

  // ---- Private: 11. Recently completed lessons ----------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderCompletedLessons(s) {
    const completed = Object.entries(s.tutorials.records)
      .filter(([, t]) => t.completedAt)
      .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 5);

    if (completed.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Recently Completed</h2>
          </div>
          <p class="${CSS.EMPTY}">Finished lessons will appear here.</p>
        </section>
      `;
    }

    const cards = completed.map(([id, t]) => {
      const meta = COURSE_PROGRESS_SEED.find((c) => c.id === id) ?? ORDERED_CURRICULUM.find((c) => c.id === id);
      return `
        <button class="${CSS.COMPLETED_CARD}"
                type="button"
                data-action="navigate"
                data-path="${escapeAttr(meta?.path ?? `/tutorials/${id}`)}"
                aria-label="Review ${escapeAttr(t.title ?? meta?.title ?? id)}">
          <span class="${CSS.COMPLETED_ICON}" aria-hidden="true">${escapeHtml(meta?.icon ?? '✅')}</span>
          <span class="${CSS.COMPLETED_TITLE}">${escapeHtml(t.title ?? meta?.title ?? id)}</span>
          <span class="${CSS.COMPLETED_META}">Completed ${relativeTime(t.completedAt)}</span>
        </button>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="completed-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="completed-heading">Recently Completed</h2>
        </div>
        <div class="${CSS.COMPLETED_GRID}" role="list" aria-label="Recently completed lessons">
          ${cards}
        </div>
      </section>
    `;
  }

  // ---- Private: 12. Upcoming lessons ---------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderUpcomingLessons(s) {
    const upcoming = ORDERED_CURRICULUM
      .filter((c) => !s.tutorials.records[c.id]?.completedAt)
      .slice(0, 4);

    if (upcoming.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="upcoming-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="upcoming-heading">Upcoming Lessons</h2>
          </div>
          <p class="${CSS.EMPTY}">You've completed every lesson in this path — amazing work!</p>
        </section>
      `;
    }

    const items = upcoming.map((c) => `
      <li class="${CSS.UPCOMING_ITEM}">
        <button type="button"
                data-action="navigate"
                data-path="${escapeAttr(c.path)}"
                aria-label="Start ${escapeAttr(c.title)}">
          <span class="${CSS.UPCOMING_ICON}" aria-hidden="true" style="color:${c.accent}">${escapeHtml(c.icon)}</span>
          <span class="${CSS.UPCOMING_BODY}">
            <span class="${CSS.UPCOMING_TITLE}">${escapeHtml(c.title)}</span>
            <span class="${CSS.UPCOMING_META}">${escapeHtml(c.duration)}</span>
          </span>
        </button>
      </li>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="upcoming-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="upcoming-heading">Upcoming Lessons</h2>
        </div>
        <ul class="${CSS.UPCOMING_LIST}" role="list" aria-label="Upcoming lessons">
          ${items}
        </ul>
      </section>
    `;
  }

  // ---- Private: 13. Achievement gallery -------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderAchievements(s) {
    const unlocked = s.achievements.all.filter((a) => a.unlocked).slice(0, 8);
    const locked   = s.achievements.all.filter((a) => !a.unlocked).slice(0, 4);

    if (unlocked.length === 0 && locked.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="achievements-heading">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="achievements-heading">Achievements</h2>
          </div>
          <p class="${CSS.EMPTY}">Complete tutorials and quizzes to unlock your first badge!</p>
        </section>
      `;
    }

    const unlockedHtml = unlocked.map((a) => `
      <div class="${CSS.ACHIEVEMENT_BADGE}" role="listitem"
           aria-label="${escapeAttr(a.title)}: ${escapeAttr(a.description ?? '')}">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">${escapeHtml(a.icon ?? '🏅')}</span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">${escapeHtml(a.title)}</span>
      </div>
    `).join('');

    const lockedHtml = locked.map(() => `
      <div class="${CSS.ACHIEVEMENT_BADGE} ${CSS.ACHIEVEMENT_LOCKED}" role="listitem" aria-label="Locked achievement">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">🔒</span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">Locked</span>
      </div>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="achievements-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="achievements-heading">Achievements</h2>
          <span>${s.achievements.unlocked} / ${s.achievements.total} unlocked</span>
        </div>
        <div class="${CSS.ACHIEVEMENT_GRID}" role="list" aria-label="Achievements">
          ${unlockedHtml}${lockedHtml}
        </div>
      </section>
    `;
  }

  // ---- Private: 14. Leaderboard preview -------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderLeaderboard(s) {
    let name = 'You';
    if (this.#config.store) {
      try { name = this.#config.store.getUser()?.name || 'You'; } catch { /* ignore */ }
    }

    const rows = [
      ...LEADERBOARD_SEED.map((r) => ({ ...r, isMe: false })),
      { name, xp: s.xp, initials: name.charAt(0).toUpperCase() || 'Y', isMe: true },
    ].sort((a, b) => b.xp - a.xp);

    const items = rows.map((r, i) => `
      <li class="${CSS.LEADERBOARD_ITEM} ${r.isMe ? CSS.LEADERBOARD_ITEM_ME : ''}"
          aria-current="${r.isMe ? 'true' : 'false'}">
        <span class="${CSS.LEADERBOARD_RANK}">#${i + 1}</span>
        <span class="${CSS.LEADERBOARD_AVATAR}" aria-hidden="true">${escapeHtml(r.initials)}</span>
        <span class="${CSS.LEADERBOARD_NAME}">${escapeHtml(r.name)}${r.isMe ? ' (You)' : ''}</span>
        <span class="${CSS.LEADERBOARD_XP}">${r.xp.toLocaleString()} XP</span>
      </li>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="leaderboard-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="leaderboard-heading">Leaderboard</h2>
        </div>
        <ol class="${CSS.LEADERBOARD_LIST}" aria-label="This week's top learners">
          ${items}
        </ol>
        <p class="${CSS.LEADERBOARD_NOTE}">
          Preview — full live leaderboards are coming soon.
        </p>
      </section>
    `;
  }

  // ---- Private: 15 & 16. Recommendations -------------------------------------------

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecommendedTutorials(s) {
    const completedIds = new Set(
      Object.entries(s.tutorials.records).filter(([, t]) => t.completedAt).map(([id]) => id)
    );

    const lastCompletedId = Object.entries(s.tutorials.records)
      .filter(([, t]) => t.completedAt)
      .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]?.[0];

    const lastCategory = COURSE_PROGRESS_SEED.find((c) => c.id === lastCompletedId)
      ?? RECOMMENDATION_POOL.find((r) => r.id === lastCompletedId);

    const recommended = RECOMMENDATION_POOL
      .filter((r) => !completedIds.has(r.id) && (!lastCategory?.category || r.category === lastCategory.category))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, 4);

    const finalList = recommended.length > 0
      ? recommended
      : RECOMMENDATION_POOL.filter((r) => !completedIds.has(r.id)).slice(0, 4);

    const cards = finalList.map((t) => `
      <article class="${CSS.RECOMMEND_CARD}" aria-labelledby="rec-tut-${escapeAttr(t.id)}">
        <span class="${CSS.RECOMMEND_ICON}" aria-hidden="true" style="color:${t.accent}">${escapeHtml(t.icon)}</span>
        <h3 class="${CSS.RECOMMEND_TITLE}" id="rec-tut-${escapeAttr(t.id)}">${escapeHtml(t.title)}</h3>
        <p class="${CSS.RECOMMEND_META}">${escapeHtml(t.duration)}</p>
        <button class="${CSS.RECOMMEND_CTA}"
                type="button"
                data-action="navigate"
                data-path="${escapeAttr(t.path)}"
                aria-label="Start ${escapeAttr(t.title)}"
                style="--cta-accent:${t.accent}">
          Start
        </button>
      </article>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="rec-tutorials-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="rec-tutorials-heading">Recommended Tutorials</h2>
        </div>
        <div class="${CSS.RECOMMEND_GRID}" role="list" aria-label="Recommended tutorials">
          ${cards}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} s
   * @returns {string}
   */
  #renderRecommendedProjects(s) {
    const completedIds = new Set(
      Object.entries(s.projects.records).filter(([, p]) => p.state === 'completed').map(([id]) => id)
    );

    const projects = RECOMMENDED_PROJECTS_SEED.filter((p) => !completedIds.has(p.id)).slice(0, 3);

    const diffLabel = (d) => d.charAt(0).toUpperCase() + d.slice(1);

    const cards = projects.map((p) => `
      <article class="${CSS.PROJECT_CARD}" aria-labelledby="rec-proj-${escapeAttr(p.id)}">
        <span class="${CSS.PROJECT_BADGE}">${escapeHtml(diffLabel(p.difficulty))}</span>
        <span aria-hidden="true" style="font-size:1.75rem;color:${p.accent}">${escapeHtml(p.icon)}</span>
        <h3 class="${CSS.PROJECT_TITLE}" id="rec-proj-${escapeAttr(p.id)}">${escapeHtml(p.title)}</h3>
        <p class="${CSS.PROJECT_DESC}">${escapeHtml(p.desc)}</p>
        <button class="${CSS.PROJECT_CTA}"
                type="button"
                data-action="navigate"
                data-path="${escapeAttr(p.path)}"
                aria-label="View project: ${escapeAttr(p.title)}"
                style="--cta-accent:${p.accent}">
          View Project
        </button>
      </article>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="rec-projects-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="rec-projects-heading">Recommended Projects</h2>
        </div>
        <div class="${CSS.PROJECT_GRID}" role="list" aria-label="Recommended projects">
          ${cards || `<p class="${CSS.EMPTY}">You've explored every featured project — great job!</p>`}
        </div>
      </section>
    `;
  }

  // ---- Private: 17. Quick actions --------------------------------------------------

  /**
   * @returns {string}
   */
  #renderQuickActions() {
    const actions = [
      { path: '/tutorials',  icon: '▶',  label: 'Continue Learning', accent: 'var(--color-primary)' },
      { path: '/quizzes',    icon: '✏️', label: 'Take a Quiz',       accent: 'var(--color-success)' },
      { path: '/playground', icon: '⌨️', label: 'Open Playground',  accent: 'var(--color-accent)'  },
      { path: '/tutorials',  icon: '📚', label: 'Browse Tutorials',  accent: 'var(--color-warning)' },
      { path: '/projects',   icon: '🔧', label: 'View Projects',     accent: 'var(--color-code)'    },
      { path: '/dashboard',  icon: '🏆', label: 'View Achievements', accent: 'var(--color-primary)' },
    ];

    const cards = actions.map((a) => `
      <button class="${CSS.ACTION_CARD}"
              type="button"
              data-action="navigate"
              data-path="${escapeAttr(a.path)}"
              aria-label="${escapeAttr(a.label)}">
        <span class="${CSS.ACTION_ICON}" aria-hidden="true" style="color:${a.accent}">${escapeHtml(a.icon)}</span>
        <span class="${CSS.ACTION_LABEL}">${escapeHtml(a.label)}</span>
      </button>
    `).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="actions-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="actions-heading">Quick Actions</h2>
        </div>
        <div class="${CSS.ACTIONS_GRID}">${cards}</div>
      </section>
    `;
  }

  // ---- Private: 18. Notifications --------------------------------------------------

  /**
   * @returns {string}
   */
  #renderNotifications() {
    return `
      <section class="${CSS.SECTION}" id="db-notif-inner" aria-labelledby="notif-heading">
        <div class="${CSS.SECTION_HEADER}">
          <h2 class="${CSS.SECTION_TITLE}" id="notif-heading">Notifications</h2>
        </div>
        ${this.#renderNotificationsInner()}
      </section>
    `;
  }

  /**
   * @returns {string}
   */
  #renderNotificationsInner() {
    let notifications = [];
    if (this.#config.store) {
      try { notifications = this.#config.store.getDashboard()?.notifications ?? []; } catch { /* ignore */ }
    }

    if (notifications.length === 0) {
      return `<p class="${CSS.NOTIF_EMPTY}">You're all caught up!</p>`;
    }

    const items = notifications.slice(0, 6).map((n) => `
      <li class="${CSS.NOTIF_ITEM} ${n.isNew ? CSS.NOTIF_ITEM_NEW : ''}">
        <span class="${CSS.NOTIF_ICON}" aria-hidden="true">
          ${n.type === 'achievement' ? '🏆' : '🔔'}
        </span>
        <span class="${CSS.NOTIF_BODY}">
          <span class="${CSS.NOTIF_TITLE}">${escapeHtml(n.title ?? '')}</span>
          <span class="${CSS.NOTIF_TIME}">${relativeTime(n.ts)}</span>
        </span>
      </li>
    `).join('');

    return `<ul class="${CSS.NOTIF_LIST}" role="list" aria-label="Notifications">${items}</ul>`;
  }

  // ---- Private: 19. Footer CTA --------------------------------------------------

  /**
   * @returns {string}
   */
  #renderFooterCTA() {
    return `
      <section class="${CSS.FOOTER_CTA}" aria-labelledby="footer-cta-heading">
        <div class="${CSS.FOOTER_CTA_INNER}">
          <h2 id="footer-cta-heading">Keep the momentum going.</h2>
          <button class="${CSS.FOOTER_CTA_BTN}"
                  type="button"
                  data-action="navigate"
                  data-path="/tutorials"
                  aria-label="Browse more tutorials">
            Browse Tutorials
          </button>
          <button class="${CSS.FOOTER_CTA_BTN}"
                  type="button"
                  data-action="navigate"
                  data-path="/playground"
                  aria-label="Open the playground">
            Open Playground
          </button>
        </div>
      </section>
    `;
  }

  // ---- Private: DOM patching -------------------------------------------------------

  /**
   * @param {string} id
   * @param {string} html
   */
  #replaceRegion(id, html) {
    const el = this.#root?.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  // ---- Private: event listeners -------------------------------------------------

  /**
   * Attach all external event subscriptions and DOM click delegation.
   */
  #attachEventListeners() {
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    const onProgressUpdated = () => this.#debouncedRefresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() => document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated));

    const onLessonCompleted = () => { this.#debouncedRefresh.cancel(); this.refresh(); };
    document.addEventListener('lesson:completed', onLessonCompleted);
    this.#cleanupFns.push(() => document.removeEventListener('lesson:completed', onLessonCompleted));

    const onQuizCompleted = () => { this.#debouncedRefresh.cancel(); this.refresh(); };
    document.addEventListener('quiz:completed', onQuizCompleted);
    this.#cleanupFns.push(() => document.removeEventListener('quiz:completed', onQuizCompleted));

    const onPlaygroundRun = () => {
      this.#replaceRegion('db-weekly-region', this.#renderWeeklyChart(this.#summary));
      this.#replaceRegion('db-monthly-region', this.#renderMonthlyChart(this.#summary));
    };
    document.addEventListener('playground:run', onPlaygroundRun);
    this.#cleanupFns.push(() => document.removeEventListener('playground:run', onPlaygroundRun));

    const onStateUpdated = (e) => {
      const path = e.detail?.path;
      if (path === 'user' || path === null) {
        this.#replaceRegion('db-welcome-region', this.#renderWelcomeHeader(this.#summary));
        this.#replaceRegion('db-profile-region', this.#renderProfileSummary(this.#summary));
      }
      if (path === 'theme') {
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

    // router:afterNavigate — dashboard has nothing to re-parse from the URL,
    // but we still listen so the debounced refresh is cancelled cleanly on
    // any navigation away that fires before unmount() runs.
    const onRouterNavigate = (e) => {
      if (e.detail?.pathname && e.detail.pathname !== '/dashboard') {
        this.#debouncedRefresh.cancel();
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener('router:afterNavigate', onRouterNavigate));
  }

  // ---- Private: click handler -------------------------------------------------

  /**
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'navigate': {
        const path = actionEl.dataset.path;
        if (path) this.#navigate(path);
        break;
      }
      case 'browse-tutorials':
        this.#navigate('/tutorials');
        break;
      case 'retry':
        this.#hasError = false;
        this.refresh();
        break;
      default:
        this.#dispatch('dashboard:action', { action });
        break;
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