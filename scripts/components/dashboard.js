/**
 * =============================================================================
 * DASHBOARD COMPONENT
 * scripts/components/dashboard.js
 * -----------------------------------------------------------------------------
 * Central learning hub for the Python for AI educational platform.
 * Displays all user progress, streak, achievements, recent activity,
 * statistics, and quick-action affordances in a single cohesive view.
 *
 * ARCHITECTURE:
 *   Dashboard (default export)
 *     └─ DashboardStore  — localStorage cache with schema versioning
 *                          and graceful in-memory fallback
 *
 * WIDGETS (rendered in order):
 *   1. Welcome Card        — greeting, username, motivational message
 *   2. Learning Progress   — XP, level, circular-progress hook, next level
 *   3. Streak              — current/longest streak, last date, freeze count
 *   4. Continue Learning   — resume last tutorial / quiz / project
 *   5. Statistics          — tutorials, quizzes, projects, time totals
 *   6. Recent Activity     — time-sorted activity feed
 *   7. Achievements        — unlocked badges + locked progress preview
 *   8. Weekly Activity     — 7-day dataset + canvas hook for chart rendering
 *   9. Quick Actions       — shortcut buttons to key platform areas
 *  10. Notifications       — achievement unlocks, milestones, streak warnings
 *
 * DATA SOURCE:
 *   All data flows from progress-tracker.js via getSummary().
 *   The dashboard never writes to progress state — it is read-only.
 *   External callers pass a ProgressTracker instance at construction time.
 *
 * EVENT SUBSCRIPTIONS:
 *   progress:updated          — full refresh of all widgets
 *   progress:achievement:unlocked — toast + notification panel update
 *   progress:level:up         — level-up toast
 *   progress:streak:warning   — streak warning notification
 *   quiz:submitted            — activity feed update
 *   editor:saved              — activity feed update
 *
 * EVENT EMISSIONS:
 *   dashboard:mounted         { containerId }
 *   dashboard:updated         { timestamp }
 *   dashboard:refresh         { source }
 *   dashboard:action          { action, payload }
 *   dashboard:error           { message, error }
 *   dashboard:destroyed       { containerId }
 *
 * STORAGE SCHEMA (localStorage key: DASHBOARD_DEFAULTS.STORAGE_KEY):
 *   {
 *     version:        1,
 *     cachedAt:       number,      — Unix ms timestamp
 *     lastSummary:    object|null, — Last known getSummary() snapshot
 *     notifications:  Notification[],
 *     weeklyActivity: Record<string, number>,
 *   }
 *
 * USAGE (pages/dashboard.js or scripts/pages/dashboard.js):
 *
 *   import Dashboard, { DASHBOARD_EVENTS } from './components/dashboard.js';
 *   import ProgressTracker from './components/progress-tracker.js';
 *
 *   const tracker = new ProgressTracker();
 *   tracker.init();
 *
 *   const dashboard = new Dashboard({
 *     containerId: 'dashboard-root',
 *     tracker,
 *     userName: 'Ada',
 *   });
 *
 *   dashboard.mount();
 *
 *   document.addEventListener(DASHBOARD_EVENTS.ACTION, (e) => {
 *     if (e.detail.action === 'open-playground') {
 *       router.navigate('/playground');
 *     }
 *   });
 *
 * EXPORTS:
 *   Dashboard         — primary class (default export)
 *   DASHBOARD_EVENTS  — event name constants
 *   DASHBOARD_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { PROGRESS_EVENTS } from './progress-tracker.js';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the dashboard.
 * All events bubble on document and are also published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DASHBOARD_EVENTS = Object.freeze({
  MOUNTED:   'dashboard:mounted',
  UPDATED:   'dashboard:updated',
  REFRESH:   'dashboard:refresh',
  ACTION:    'dashboard:action',
  ERROR:     'dashboard:error',
  DESTROYED: 'dashboard:destroyed',
});

/**
 * Default configuration values applied when not specified by the caller.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const DASHBOARD_DEFAULTS = Object.freeze({
  /** ID of the root element the dashboard renders into */
  CONTAINER_ID:        'dashboard-root',

  /** Debounce interval (ms) before a reactive refresh renders */
  REFRESH_DEBOUNCE_MS: 300,

  /** localStorage key for cached dashboard state */
  STORAGE_KEY:         'pyai-dashboard-cache',

  /** Schema version — increment when the cache shape changes */
  STORE_VERSION:       1,

  /** Maximum cache age (seconds) before a full data re-fetch */
  CACHE_MAX_AGE_S:     300,    // 5 minutes

  /** Maximum notifications to retain in the panel */
  MAX_NOTIFICATIONS:   20,

  /** Maximum recent-activity items to display */
  MAX_ACTIVITY_ITEMS:  10,

  /** Maximum locked achievements shown in the preview */
  MAX_LOCKED_PREVIEW:  4,

  /** Daily XP goal for the streak progress bar */
  DAILY_XP_GOAL:       100,
});

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth, zero magic strings
// ---------------------------------------------------------------------------

/**
 * @type {Readonly<Record<string, string>>}
 */
const CSS = Object.freeze({
  // Root
  ROOT:                   'dashboard',
  ROOT_LOADING:           'dashboard--loading',
  ROOT_ERROR:             'dashboard--error',

  // Grid layout
  GRID:                   'dashboard__grid',

  // Generic card shell
  CARD:                   'dashboard__card',
  CARD_HEADER:            'dashboard__card-header',
  CARD_TITLE:             'dashboard__card-title',
  CARD_BODY:              'dashboard__card-body',
  CARD_FOOTER:            'dashboard__card-footer',

  // Welcome card
  WELCOME:                'dashboard__welcome',
  WELCOME_GREETING:       'dashboard__welcome-greeting',
  WELCOME_NAME:           'dashboard__welcome-name',
  WELCOME_MSG:            'dashboard__welcome-msg',
  WELCOME_DATE:           'dashboard__welcome-date',

  // Progress widget
  PROGRESS:               'dashboard__progress',
  PROGRESS_RING:          'dashboard__progress-ring',
  PROGRESS_RING_TRACK:    'dashboard__progress-ring-track',
  PROGRESS_RING_FILL:     'dashboard__progress-ring-fill',
  PROGRESS_RING_LABEL:    'dashboard__progress-ring-label',
  PROGRESS_XP:            'dashboard__progress-xp',
  PROGRESS_LEVEL:         'dashboard__progress-level',
  PROGRESS_LEVEL_BADGE:   'dashboard__progress-level-badge',
  PROGRESS_XP_BAR:        'dashboard__progress-xp-bar',
  PROGRESS_XP_FILL:       'dashboard__progress-xp-fill',
  PROGRESS_NEXT:          'dashboard__progress-next',

  // Streak widget
  STREAK:                 'dashboard__streak',
  STREAK_FLAME:           'dashboard__streak-flame',
  STREAK_VALUE:           'dashboard__streak-value',
  STREAK_LABEL:           'dashboard__streak-label',
  STREAK_GRID:            'dashboard__streak-grid',
  STREAK_STAT:            'dashboard__streak-stat',
  STREAK_STAT_VALUE:      'dashboard__streak-stat-value',
  STREAK_STAT_LABEL:      'dashboard__streak-stat-label',
  STREAK_GOAL:            'dashboard__streak-goal',
  STREAK_GOAL_BAR:        'dashboard__streak-goal-bar',
  STREAK_GOAL_FILL:       'dashboard__streak-goal-fill',
  STREAK_FREEZE:          'dashboard__streak-freeze',

  // Continue learning widget
  CONTINUE:               'dashboard__continue',
  CONTINUE_ITEM:          'dashboard__continue-item',
  CONTINUE_ICON:          'dashboard__continue-icon',
  CONTINUE_TEXT:          'dashboard__continue-text',
  CONTINUE_TITLE:         'dashboard__continue-title',
  CONTINUE_SUB:           'dashboard__continue-sub',
  CONTINUE_ARROW:         'dashboard__continue-arrow',

  // Statistics widget
  STATS:                  'dashboard__stats',
  STATS_GRID:             'dashboard__stats-grid',
  STAT_CARD:              'dashboard__stat-card',
  STAT_ICON:              'dashboard__stat-icon',
  STAT_VALUE:             'dashboard__stat-value',
  STAT_LABEL:             'dashboard__stat-label',
  STAT_DELTA:             'dashboard__stat-delta',

  // Activity feed
  ACTIVITY:               'dashboard__activity',
  ACTIVITY_LIST:          'dashboard__activity-list',
  ACTIVITY_ITEM:          'dashboard__activity-item',
  ACTIVITY_ICON:          'dashboard__activity-icon',
  ACTIVITY_BODY:          'dashboard__activity-body',
  ACTIVITY_TITLE:         'dashboard__activity-title',
  ACTIVITY_TIME:          'dashboard__activity-time',
  ACTIVITY_EMPTY:         'dashboard__activity-empty',

  // Achievements widget
  ACHIEVEMENTS:           'dashboard__achievements',
  ACHIEVEMENT_GRID:       'dashboard__achievement-grid',
  ACHIEVEMENT_BADGE:      'dashboard__achievement-badge',
  ACHIEVEMENT_LOCKED:     'dashboard__achievement-badge--locked',
  ACHIEVEMENT_ICON:       'dashboard__achievement-icon',
  ACHIEVEMENT_TITLE:      'dashboard__achievement-title',
  ACHIEVEMENT_PROGRESS:   'dashboard__achievement-progress',
  ACHIEVEMENT_BAR:        'dashboard__achievement-bar',
  ACHIEVEMENT_BAR_FILL:   'dashboard__achievement-bar-fill',

  // Weekly activity widget
  WEEKLY:                 'dashboard__weekly',
  WEEKLY_BARS:            'dashboard__weekly-bars',
  WEEKLY_BAR_COL:         'dashboard__weekly-bar-col',
  WEEKLY_BAR:             'dashboard__weekly-bar',
  WEEKLY_BAR_FILL:        'dashboard__weekly-bar-fill',
  WEEKLY_BAR_LABEL:       'dashboard__weekly-bar-label',
  WEEKLY_BAR_VALUE:       'dashboard__weekly-bar-value',
  WEEKLY_CANVAS:          'dashboard__weekly-canvas',

  // Quick actions widget
  ACTIONS:                'dashboard__actions',
  ACTIONS_GRID:           'dashboard__actions-grid',
  ACTION_BTN:             'dashboard__action-btn',
  ACTION_ICON:            'dashboard__action-icon',
  ACTION_LABEL:           'dashboard__action-label',

  // Notifications widget
  NOTIFICATIONS:          'dashboard__notifications',
  NOTIFICATION_LIST:      'dashboard__notification-list',
  NOTIFICATION_ITEM:      'dashboard__notification-item',
  NOTIFICATION_ITEM_NEW:  'dashboard__notification-item--new',
  NOTIFICATION_ICON:      'dashboard__notification-icon',
  NOTIFICATION_BODY:      'dashboard__notification-body',
  NOTIFICATION_TITLE:     'dashboard__notification-title',
  NOTIFICATION_TIME:      'dashboard__notification-time',
  NOTIFICATION_DISMISS:   'dashboard__notification-dismiss',
  NOTIFICATION_EMPTY:     'dashboard__notification-empty',
  NOTIFICATION_CLEAR:     'dashboard__notification-clear-btn',

  // Toast
  TOAST_REGION:           'dashboard__toast-region',
  TOAST:                  'dashboard__toast',
  TOAST_VISIBLE:          'dashboard__toast--visible',
  TOAST_SUCCESS:          'dashboard__toast--success',
  TOAST_INFO:             'dashboard__toast--info',
  TOAST_WARNING:          'dashboard__toast--warning',

  // Live region
  LIVE:                   'dashboard__live',

  // Loading skeleton
  SKELETON:               'dashboard__skeleton',
  SKELETON_CARD:          'dashboard__skeleton-card',
});

// ---------------------------------------------------------------------------
// Day / greeting utilities
// ---------------------------------------------------------------------------

/**
 * Return a greeting string appropriate for the current hour of the day.
 *
 * @returns {string}
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5)  return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/**
 * Return a motivational message based on the user's current streak.
 *
 * @param {number} streak
 * @param {number} level
 * @returns {string}
 */
function getMotivation(streak, level) {
  if (streak >= 30)  return 'Incredible consistency. You are building mastery.';
  if (streak >= 14)  return `${streak} days strong. Keep the momentum going!`;
  if (streak >= 7)   return 'A full week of learning — you\'re on fire! 🔥';
  if (streak >= 3)   return 'Great momentum! Consistency beats intensity.';
  if (streak === 0)  return 'Start today — every expert was once a beginner.';
  if (level >= 15)   return 'Elite learner status. The community looks up to you.';
  if (level >= 10)   return 'Double digits! Your AI knowledge is compounding.';
  return 'Every tutorial, every quiz — you\'re building your AI future.';
}

/**
 * Format a Unix ms timestamp as a relative human-readable string.
 * e.g. "just now", "5 minutes ago", "yesterday", "3 days ago"
 *
 * @param {number} ts — Unix ms timestamp
 * @returns {string}
 */
function relativeTime(ts) {
  if (!ts) return 'never';
  const diffMs  = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH   / 24);

  if (diffSec < 60)  return 'just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffH   < 24)  return `${diffH}h ago`;
  if (diffD   === 1) return 'yesterday';
  if (diffD   < 7)   return `${diffD} days ago`;
  if (diffD   < 30)  return `${Math.floor(diffD / 7)}w ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

/**
 * Format seconds into a human-readable duration.
 * e.g. 65 → "1m 5s", 3661 → "1h 1m"
 *
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h === 0)  return `${m}m ${s % 60}s`;
  return `${h}h ${m % 60}m`;
}

/**
 * Return the short weekday name (Mon–Sun) for the given Date.
 *
 * @param {Date} d
 * @returns {string}
 */
function shortDay(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

/**
 * Return a YYYY-MM-DD string for the given Date in local time.
 *
 * @param {Date} d
 * @returns {string}
 */
function dateKey(d) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
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
 * Returns a debounced wrapper around a function.
 *
 * @param {Function} fn
 * @param {number}   ms
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
 * Returns true when the user prefers reduced motion.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Inline SVG icon factory
// ---------------------------------------------------------------------------

/**
 * Returns an inline SVG string for a named icon used in the dashboard.
 * All icons are aria-hidden="true" — adjacent text or aria-label carries meaning.
 *
 * @param {string} name
 * @param {number} [size=20]
 * @returns {string}
 */
function icon(name, size = 20) {
  const s = size;
  const ICONS = {
    flame: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
               aria-hidden="true" focusable="false">
               <path d="M12 2C9 7 5 9 5 13a7 7 0 0 0 14 0c0-4-3-6-4-8-1 3-2 4-3 5z"/>
            </svg>`,

    book: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
           </svg>`,

    code: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
           </svg>`,

    quiz: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
           </svg>`,

    project: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true" focusable="false">
                 <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>`,

    trophy: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true" focusable="false">
                <polyline points="8 21 12 17 16 21"/>
                <path d="M17.657 3H6.343A1 1 0 0 0 5.5 4.5C5.5 8.5 8.5 12 12 12s6.5-3.5 6.5-7.5A1 1 0 0 0 17.657 3z"/>
                <path d="M6 3H4a1 1 0 0 0-1 1v.5C3 7 5 9.5 6.5 10.5"/>
                <path d="M18 3h2a1 1 0 0 1 1 1v.5c0 2.5-2 5-3.5 6"/>
                <line x1="12" y1="17" x2="12" y2="12"/>
             </svg>`,

    star: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02
                               12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
           </svg>`,

    xp: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
         </svg>`,

    clock: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <circle cx="12" cy="12" r="10"/>
               <polyline points="12 6 12 12 16 14"/>
            </svg>`,

    chart: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <line x1="18" y1="20" x2="18" y2="10"/>
               <line x1="12" y1="20" x2="12" y2="4"/>
               <line x1="6"  y1="20" x2="6"  y2="14"/>
            </svg>`,

    play: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="5 3 19 12 5 21 5 3"/>
           </svg>`,

    lock: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
           </svg>`,

    bell: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
           </svg>`,

    check: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <polyline points="20 6 9 17 4 12"/>
            </svg>`,

    close: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <line x1="18" y1="6"  x2="6"  y2="18"/>
               <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>`,

    chevronRight: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true" focusable="false">
                     <polyline points="9 18 15 12 9 6"/>
                   </svg>`,

    freeze: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true" focusable="false">
                <line x1="12" y1="2" x2="12" y2="22"/>
                <path d="M17 5l-5 5-5-5"/>
                <path d="M7 19l5-5 5 5"/>
                <path d="M2 12l5-5 5 5-5 5z"/>
                <path d="M22 12l-5-5-5 5 5 5z"/>
             </svg>`,

    grid: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
           </svg>`,

    target: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="6"/>
                <circle cx="12" cy="12" r="2"/>
             </svg>`,
  };
  return ICONS[name] ?? '';
}

// ---------------------------------------------------------------------------
// DashboardStore — localStorage cache with in-memory fallback
// ---------------------------------------------------------------------------

/**
 * Persistence layer for dashboard cache data.
 * Mirrors the StorageAdapter pattern from progress-tracker.js and
 * EditorStore from code-editor.js.
 */
class DashboardStore {
  /** @type {Map<string, string>|null} */
  #memory = null;

  /** @type {boolean} */
  #available = true;

  constructor() {
    try {
      const probe = '__pyai_dash_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch {
      this.#available = false;
      this.#memory    = new Map();
    }
  }

  /**
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    try {
      return this.#available
        ? localStorage.getItem(key)
        : (this.#memory?.get(key) ?? null);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    try {
      if (this.#available) {
        localStorage.setItem(key, value);
      } else {
        if (!this.#memory) this.#memory = new Map();
        this.#memory.set(key, value);
      }
    } catch {
      this.#available = false;
      if (!this.#memory) this.#memory = new Map();
      this.#memory.set(key, value);
    }
  }

  /**
   * @param {string} key
   */
  remove(key) {
    try {
      if (this.#available) {
        localStorage.removeItem(key);
      } else {
        this.#memory?.delete(key);
      }
    } catch {
      // Swallow
    }
  }

  /** @returns {boolean} */
  get isAvailable() { return this.#available; }
}

// ---------------------------------------------------------------------------
// Dashboard — primary class
// ---------------------------------------------------------------------------

/**
 * Central learning dashboard component.
 *
 * Lifecycle:
 *   1. new Dashboard(config)  — no DOM side-effects
 *   2. .mount()               — renders skeleton, loads data, renders widgets,
 *                              attaches event listeners
 *   3. [reactive updates]     — progress events trigger debounced refresh()
 *   4. .refresh()             — re-fetches summary and re-renders all widgets
 *   5. .reset()               — clears notifications and cached state
 *   6. .destroy()             — removes all listeners, clears timers
 */
export default class Dashboard {

  // ---- Configuration (sealed after construction) ---------------------------

  /**
   * @type {{
   *   containerId:     string,
   *   tracker:         import('./progress-tracker.js').ProgressTracker | null,
   *   userName:        string,
   *   refreshDebounce: number,
   *   storageKey:      string,
   *   dailyXpGoal:     number,
   * }}
   */
  #config;

  // ---- Internal state ------------------------------------------------------

  /**
   * @type {{
   *   summary:         object | null,
   *   notifications:   Array<DashboardNotification>,
   *   weeklyActivity:  Record<string, number>,
   *   mounted:         boolean,
   *   lastRefresh:     number,
   *   toastTimer:      number | null,
   * }}
   */
  #state = {
    summary:        null,
    notifications:  [],
    weeklyActivity: {},
    mounted:        false,
    lastRefresh:    0,
    toastTimer:     null,
  };

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #root        = null;
  /** @type {HTMLElement|null} */ #grid        = null;
  /** @type {HTMLElement|null} */ #liveRegion  = null;
  /** @type {HTMLElement|null} */ #toastRegion = null;

  // ---- Services ------------------------------------------------------------

  /** @type {DashboardStore} */ #store;

  // ---- Timers --------------------------------------------------------------

  /** @type {Function} */ #debouncedRefresh;

  // ---- Cleanup references --------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   containerId?:     string,
   *   tracker?:         import('./progress-tracker.js').ProgressTracker | null,
   *   userName?:        string,
   *   refreshDebounce?: number,
   *   storageKey?:      string,
   *   dailyXpGoal?:     number,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId:     config.containerId     ?? DASHBOARD_DEFAULTS.CONTAINER_ID,
      tracker:         config.tracker         ?? null,
      userName:        config.userName        ?? '',
      refreshDebounce: config.refreshDebounce ?? DASHBOARD_DEFAULTS.REFRESH_DEBOUNCE_MS,
      storageKey:      config.storageKey      ?? DASHBOARD_DEFAULTS.STORAGE_KEY,
      dailyXpGoal:     config.dailyXpGoal     ?? DASHBOARD_DEFAULTS.DAILY_XP_GOAL,
    });

    this.#store = new DashboardStore();

    this.#debouncedRefresh = debounce(
      (source = 'event') => this.refresh(source),
      this.#config.refreshDebounce
    );
  }

  // ---- Public API: lifecycle ------------------------------------------------

  /**
   * Mount the dashboard into the configured container element.
   * Renders the skeleton loading state immediately, loads cached data,
   * fetches the latest summary, then renders all ten widgets.
   *
   * @throws {Error} If the container element is not found
   * @returns {Dashboard} this — for chaining
   */
  mount() {
    if (this.#state.mounted) return this;

    this.#root = document.getElementById(this.#config.containerId);
    if (!this.#root) {
      throw new Error(
        `[Dashboard] Container element #${this.#config.containerId} not found.`
      );
    }

    this.#root.className = CSS.ROOT;
    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', 'Learning dashboard');

    // Render static scaffolding immediately
    this.#renderShell();

    // Load cached state (notifications, weekly activity)
    this.#loadCache();

    // Fetch live summary and render all widgets
    this.#fetchAndRender();

    // Attach all external event subscriptions
    this.#attachEventListeners();

    this.#state.mounted = true;

    this.#dispatch(DASHBOARD_EVENTS.MOUNTED, {
      containerId: this.#config.containerId,
    });

    return this;
  }

  /**
   * Force a full re-render of all widgets from the latest tracker summary.
   * Safe to call at any time after mount().
   *
   * @param {string} [source='manual'] — Identifies what triggered the refresh
   * @returns {Dashboard} this
   */
  refresh(source = 'manual') {
    if (!this.#state.mounted) return this;

    this.#fetchAndRender();

    this.#dispatch(DASHBOARD_EVENTS.REFRESH, { source });
    this.#dispatch(DASHBOARD_EVENTS.UPDATED, { timestamp: Date.now() });

    return this;
  }

  /**
   * Clear all notifications and reset the weekly activity cache.
   * Does NOT clear the progress tracker state.
   *
   * @returns {Dashboard} this
   */
  reset() {
    this.#state.notifications  = [];
    this.#state.weeklyActivity = {};
    this.#saveCache();
    this.#fetchAndRender();

    return this;
  }

  /**
   * Tear down all event listeners, timers, and DOM content.
   *
   * @returns {Dashboard} this
   */
  destroy() {
    if (this.#state.toastTimer !== null) {
      clearTimeout(this.#state.toastTimer);
      this.#state.toastTimer = null;
    }

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    if (this.#root) {
      this.#root.innerHTML = '';
      this.#root.className = '';
      this.#root.removeAttribute('role');
      this.#root.removeAttribute('aria-label');
    }

    this.#state.mounted = false;

    this.#dispatch(DASHBOARD_EVENTS.DESTROYED, {
      containerId: this.#config.containerId,
    });

    return this;
  }

  // ---- Private: data loading -----------------------------------------------

  /**
   * Fetch the latest summary from the tracker (or use cached data if unavailable)
   * then render every widget.
   */
  #fetchAndRender() {
    try {
      if (this.#config.tracker) {
        this.#state.summary = this.#config.tracker.getSummary();
      } else if (!this.#state.summary) {
        this.#state.summary = this.#buildEmptySummary();
      }

      this.#state.lastRefresh = Date.now();
      this.#saveCache();
      this.#renderAllWidgets();
    } catch (err) {
      console.error('[Dashboard] Failed to fetch/render:', err);
      this.#dispatch(DASHBOARD_EVENTS.ERROR, {
        message: 'Dashboard failed to load data.',
        error:   err,
      });
      this.#renderError();
    }
  }

  /**
   * Build a zero-state summary object for when no tracker is connected.
   * Mirrors the exact shape returned by ProgressTracker.getSummary().
   *
   * @returns {object}
   */
  #buildEmptySummary() {
    return {
      xp:           0,
      level:        1,
      xpForLevel:   0,
      xpForNext:    100,
      xpIntoLevel:  0,
      xpNeeded:     100,
      progressPct:  0,
      isMaxLevel:   false,
      streak: {
        current:  0,
        longest:  0,
        lastDate: null,
        freezes:  0,
      },
      tutorials:  { started: 0, completed: 0, pct: 0, records: {} },
      quizzes:    { attempted: 0, passed: 0, accuracy: 0, pct: 0, records: {} },
      projects:   { total: 0, completed: 0, pct: 0, records: {} },
      achievements: {
        unlocked: 0,
        total:    33,
        pct:      0,
        recent:   [],
        all:      [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      storageAvailable: false,
    };
  }

  // ---- Private: cache management -------------------------------------------

  /**
   * Load previously cached state from localStorage.
   * Populates notifications and weeklyActivity.
   */
  #loadCache() {
    const raw = this.#store.get(this.#config.storageKey);
    if (!raw) return;

    try {
      const data = JSON.parse(raw);

      if (data.version !== DASHBOARD_DEFAULTS.STORE_VERSION) return;

      const ageSecs = (Date.now() - (data.cachedAt ?? 0)) / 1000;
      if (ageSecs > DASHBOARD_DEFAULTS.CACHE_MAX_AGE_S) return;

      if (Array.isArray(data.notifications)) {
        this.#state.notifications = data.notifications.slice(
          0, DASHBOARD_DEFAULTS.MAX_NOTIFICATIONS
        );
      }

      if (data.weeklyActivity && typeof data.weeklyActivity === 'object') {
        this.#state.weeklyActivity = data.weeklyActivity;
      }
    } catch {
      // Malformed cache — ignore silently
    }
  }

  /**
   * Persist the current state snapshot to localStorage.
   */
  #saveCache() {
    try {
      const payload = JSON.stringify({
        version:        DASHBOARD_DEFAULTS.STORE_VERSION,
        cachedAt:       Date.now(),
        notifications:  this.#state.notifications.slice(0, DASHBOARD_DEFAULTS.MAX_NOTIFICATIONS),
        weeklyActivity: this.#state.weeklyActivity,
      });
      this.#store.set(this.#config.storageKey, payload);
    } catch {
      // Swallow quota errors
    }
  }

  // ---- Private: shell rendering -------------------------------------------

  /**
   * Render the permanent scaffold: live region, toast region, and the
   * main grid container. Called once during mount().
   */
  #renderShell() {
    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text">
      </div>
      <div class="${CSS.TOAST_REGION}"
           role="alert"
           aria-live="assertive"
           aria-atomic="true">
      </div>
      <div class="${CSS.GRID}" id="${this.#config.containerId}-grid">
      </div>
    `;

    this.#liveRegion  = this.#root.querySelector(`.${CSS.LIVE}`);
    this.#toastRegion = this.#root.querySelector(`.${CSS.TOAST_REGION}`);
    this.#grid        = this.#root.querySelector(`#${this.#config.containerId}-grid`);
  }

  /**
   * Render an error state into the grid.
   */
  #renderError() {
    if (!this.#grid) return;
    this.#root?.classList.add(CSS.ROOT_ERROR);
    this.#grid.innerHTML = `
      <div class="${CSS.CARD}" role="alert" style="grid-column:1/-1">
        <div class="${CSS.CARD_BODY}" style="text-align:center;padding:var(--space-12)">
          <p style="font-size:var(--text-lg);font-weight:var(--font-semibold)">
            Unable to load dashboard data.
          </p>
          <p style="color:var(--color-text-secondary);margin-top:var(--space-2)">
            Please refresh the page or check your connection.
          </p>
          <button type="button"
                  class="btn btn--primary"
                  style="margin-top:var(--space-6)"
                  onclick="location.reload()">
            Refresh page
          </button>
        </div>
      </div>
    `;
  }

  // ---- Private: widget orchestration ---------------------------------------

  /**
   * Render all ten dashboard widgets into the grid.
   * Each widget is rendered independently — a failure in one does not
   * prevent the others from rendering.
   */
  #renderAllWidgets() {
    if (!this.#grid) return;

    const s = this.#state.summary;
    if (!s) return;

    this.#root?.classList.remove(CSS.ROOT_LOADING, CSS.ROOT_ERROR);

    // Render each widget into a named slot for targeted future updates
    const widgets = [
      { id: 'welcome',      html: this.#renderWelcomeCard(s)       },
      { id: 'progress',     html: this.#renderProgressWidget(s)    },
      { id: 'streak',       html: this.#renderStreakWidget(s)       },
      { id: 'continue',     html: this.#renderContinueWidget(s)    },
      { id: 'stats',        html: this.#renderStatsWidget(s)       },
      { id: 'activity',     html: this.#renderActivityWidget(s)    },
      { id: 'achievements', html: this.#renderAchievementsWidget(s)},
      { id: 'weekly',       html: this.#renderWeeklyWidget()       },
      { id: 'actions',      html: this.#renderActionsWidget()      },
      { id: 'notifications',html: this.#renderNotificationsWidget()},
    ];

    // Build all HTML first, then set innerHTML once to minimise reflows
    this.#grid.innerHTML = widgets.map(({ id, html }) =>
      `<div class="dashboard__widget" data-widget="${escapeAttr(id)}">${html}</div>`
    ).join('');

    // Animate XP bar fill after paint
    requestAnimationFrame(() => {
      this.#animateXpBar(s.progressPct);
      this.#animateWeeklyBars();
    });

    // Attach widget-level interactive events
    this.#attachWidgetEvents();
  }

  // ---- Widget 1: Welcome Card ----------------------------------------------

  /**
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderWelcomeCard(s) {
    const greeting = getGreeting();
    const name     = this.#config.userName
      ? `, ${escapeHtml(this.#config.userName)}`
      : '';
    const motivation = getMotivation(s.streak.current, s.level);
    const now        = new Date();
    const dateStr    = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    return `
      <div class="${CSS.CARD} ${CSS.WELCOME}"
           aria-labelledby="dash-welcome-heading">
        <div class="${CSS.CARD_BODY}">
          <h2 class="${CSS.WELCOME_GREETING}" id="dash-welcome-heading">
            ${escapeHtml(greeting)}${name}!
          </h2>
          <p class="${CSS.WELCOME_MSG}">${escapeHtml(motivation)}</p>
          <p class="${CSS.WELCOME_DATE}" aria-label="Today is ${escapeAttr(dateStr)}">
            ${escapeHtml(dateStr)}
          </p>
        </div>
      </div>
    `;
  }

  // ---- Widget 2: Learning Progress -----------------------------------------

  /**
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderProgressWidget(s) {
    const circumference = 2 * Math.PI * 45;    // r = 45 for the SVG circle
    const dashOffset    = circumference * (1 - (s.progressPct / 100));

    const overallPct = Math.round(
      (s.tutorials.completed + s.quizzes.passed + s.projects.completed) /
      Math.max(1, s.tutorials.started + s.quizzes.attempted + s.projects.total) * 100
    );

    return `
      <div class="${CSS.CARD} ${CSS.PROGRESS}"
           aria-labelledby="dash-progress-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-progress-heading">
            Learning Progress
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">

          <!-- Circular progress ring (SVG-based for smooth animation) -->
          <div class="${CSS.PROGRESS_RING}"
               role="img"
               aria-label="${s.progressPct}% progress to next level">
            <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <circle class="${CSS.PROGRESS_RING_TRACK}"
                      cx="50" cy="50" r="45"
                      fill="none"
                      stroke-width="8"/>
              <circle class="${CSS.PROGRESS_RING_FILL}"
                      id="dash-xp-ring"
                      cx="50" cy="50" r="45"
                      fill="none"
                      stroke-width="8"
                      stroke-linecap="round"
                      stroke-dasharray="${circumference.toFixed(2)}"
                      stroke-dashoffset="${circumference.toFixed(2)}"
                      data-target-offset="${dashOffset.toFixed(2)}"
                      style="transform:rotate(-90deg);transform-origin:50% 50%;
                             transition:stroke-dashoffset 0.8s ease-out;"
                      data-circumference="${circumference.toFixed(2)}"/>
            </svg>
            <div class="${CSS.PROGRESS_RING_LABEL}">
              <span class="${CSS.PROGRESS_LEVEL_BADGE}"
                    aria-label="Level ${s.level}">
                Lv ${s.level}
              </span>
            </div>
          </div>

          <!-- XP display -->
          <div class="${CSS.PROGRESS_XP}">
            <p class="${CSS.PROGRESS_LEVEL}"
               aria-label="Level ${s.level}${s.isMaxLevel ? ', maximum level reached' : ''}">
              Level ${s.level}${s.isMaxLevel ? ' <span aria-hidden="true">👑</span>' : ''}
            </p>
            <p class="${CSS.PROGRESS_NEXT}"
               aria-label="${s.xp} total XP, ${s.xpNeeded} XP until level ${s.level + 1}">
              <strong>${s.xp.toLocaleString()} XP</strong>
              ${!s.isMaxLevel
                ? `<span>— ${s.xpNeeded.toLocaleString()} XP to Level ${s.level + 1}</span>`
                : '<span>— Maximum level reached!</span>'}
            </p>
          </div>

          <!-- XP progress bar (horizontal) -->
          <div class="${CSS.PROGRESS_XP_BAR}"
               role="progressbar"
               aria-valuenow="${s.progressPct}"
               aria-valuemin="0"
               aria-valuemax="100"
               aria-label="XP progress to next level: ${s.progressPct}%">
            <div class="${CSS.PROGRESS_XP_FILL}"
                 id="dash-xp-bar"
                 style="width:0%;transition:width 0.8s ease-out;"
                 data-target-pct="${s.progressPct}">
            </div>
          </div>

          <!-- Overall curriculum progress -->
          <p class="dashboard__progress-overall" aria-live="polite">
            Overall curriculum: <strong>${overallPct}%</strong> complete
          </p>

        </div>
      </div>
    `;
  }

  // ---- Widget 3: Learning Streak -------------------------------------------

  /**
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderStreakWidget(s) {
    const { current, longest, lastDate, freezes } = s.streak;

    // Daily goal progress — approximated by XP gained today vs goal
    const todayKey    = dateKey(new Date());
    const todayXp     = this.#state.weeklyActivity[todayKey] ?? 0;
    const goalPct     = Math.min(100, Math.round((todayXp / this.#config.dailyXpGoal) * 100));
    const goalMet     = goalPct >= 100;

    const lastDateStr = lastDate
      ? new Date(lastDate + 'T00:00:00').toLocaleDateString('en-US', {
          month: 'short', day: 'numeric',
        })
      : 'Never';

    return `
      <div class="${CSS.CARD} ${CSS.STREAK}"
           aria-labelledby="dash-streak-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-streak-heading">
            Learning Streak
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">

          <!-- Primary streak count -->
          <div class="dashboard__streak-primary"
               aria-label="${current} day streak">
            <span class="${CSS.STREAK_FLAME}"
                  aria-hidden="true"
                  style="color:${current > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)'}">
              ${icon('flame', 32)}
            </span>
            <div>
              <p class="${CSS.STREAK_VALUE}">${current}</p>
              <p class="${CSS.STREAK_LABEL}">
                ${current === 1 ? 'day streak' : 'day streak'}
              </p>
            </div>
          </div>

          <!-- Stats grid -->
          <div class="${CSS.STREAK_GRID}" role="list">
            <div class="${CSS.STREAK_STAT}" role="listitem">
              <span class="${CSS.STREAK_STAT_VALUE}">${longest}</span>
              <span class="${CSS.STREAK_STAT_LABEL}">Longest</span>
            </div>
            <div class="${CSS.STREAK_STAT}" role="listitem">
              <span class="${CSS.STREAK_STAT_VALUE}">${escapeHtml(lastDateStr)}</span>
              <span class="${CSS.STREAK_STAT_LABEL}">Last activity</span>
            </div>
            <div class="${CSS.STREAK_STAT} ${CSS.STREAK_FREEZE}"
                 role="listitem"
                 aria-label="${freezes} streak freeze${freezes !== 1 ? 's' : ''} available">
              <span class="${CSS.STREAK_STAT_VALUE}">
                ${icon('freeze', 14)}
                ${freezes}
              </span>
              <span class="${CSS.STREAK_STAT_LABEL}">Freezes</span>
            </div>
          </div>

          <!-- Daily goal bar -->
          <div class="${CSS.STREAK_GOAL}">
            <p class="dashboard__streak-goal-label"
               aria-label="Daily goal: ${todayXp} of ${this.#config.dailyXpGoal} XP earned today${goalMet ? ', goal met' : ''}">
              Daily goal: ${todayXp} / ${this.#config.dailyXpGoal} XP
              ${goalMet ? '<span aria-hidden="true">✓</span>' : ''}
            </p>
            <div class="${CSS.STREAK_GOAL_BAR}"
                 role="progressbar"
                 aria-valuenow="${goalPct}"
                 aria-valuemin="0"
                 aria-valuemax="100"
                 aria-label="${goalPct}% of daily XP goal">
              <div class="${CSS.STREAK_GOAL_FILL}"
                   style="width:${goalPct}%;${goalMet ? 'background:var(--color-success);' : ''}">
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  // ---- Widget 4: Continue Learning -----------------------------------------

  /**
   * Finds the most recently interacted tutorial, quiz, and project from
   * the summary records and renders resume cards for each.
   *
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderContinueWidget(s) {
    const continueItems = [];

    // Most recent in-progress tutorial
    const inProgressTutorials = Object.values(s.tutorials.records)
      .filter((t) => t.startedAt && !t.completedAt)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressTutorials.length > 0) {
      const t = inProgressTutorials[0];
      continueItems.push({
        type:    'tutorial',
        iconName:'book',
        title:   t.title ?? t.id ?? 'Tutorial',
        sub:     `Section ${(t.lastSection ?? 0) + 1} · ${relativeTime(t.startedAt)}`,
        action:  'resume-tutorial',
        payload: { id: t.id },
      });
    }

    // Most recent quiz attempt (in-progress quizzes)
    const recentQuizzes = Object.values(s.quizzes.records)
      .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));

    if (recentQuizzes.length > 0) {
      const q = recentQuizzes[0];
      continueItems.push({
        type:    'quiz',
        iconName:'quiz',
        title:   q.title ?? q.id ?? 'Quiz',
        sub:     `${q.attempts ?? 0} attempt${q.attempts !== 1 ? 's' : ''} · Best: ${
          q.totalQuestions > 0
            ? Math.round((q.bestScore / q.totalQuestions) * 100) + '%'
            : 'N/A'
        }`,
        action:  'resume-quiz',
        payload: { id: q.id },
      });
    }

    // Most recent in-progress project
    const inProgressProjects = Object.values(s.projects.records)
      .filter((p) => p.state === 'in-progress' || p.state === 'available')
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    if (inProgressProjects.length > 0) {
      const p = inProgressProjects[0];
      continueItems.push({
        type:    'project',
        iconName:'project',
        title:   p.title ?? p.id ?? 'Project',
        sub:     `${p.state === 'in-progress' ? 'In progress' : 'Not started'} · ${relativeTime(p.startedAt)}`,
        action:  'resume-project',
        payload: { id: p.id },
      });
    }

    if (continueItems.length === 0) {
      return `
        <div class="${CSS.CARD} ${CSS.CONTINUE}"
             aria-labelledby="dash-continue-heading">
          <div class="${CSS.CARD_HEADER}">
            <h2 class="${CSS.CARD_TITLE}" id="dash-continue-heading">
              Continue Learning
            </h2>
          </div>
          <div class="${CSS.CARD_BODY}">
            <p style="color:var(--color-text-secondary);text-align:center;padding:var(--space-8) 0">
              Start a tutorial to see your progress here.
            </p>
            <div style="text-align:center">
              <button class="btn btn--primary dashboard__action-btn"
                      type="button"
                      data-action="browse-tutorials"
                      data-payload='{}'>
                Browse Tutorials
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const items = continueItems.map((item) => `
      <button class="${CSS.CONTINUE_ITEM}"
              type="button"
              data-action="${escapeAttr(item.action)}"
              data-payload='${escapeAttr(JSON.stringify(item.payload))}'
              aria-label="Resume: ${escapeAttr(item.title)}">
        <span class="${CSS.CONTINUE_ICON}" aria-hidden="true">
          ${icon(item.iconName, 20)}
        </span>
        <span class="${CSS.CONTINUE_TEXT}">
          <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.CONTINUE_SUB}">${escapeHtml(item.sub)}</span>
        </span>
        <span class="${CSS.CONTINUE_ARROW}" aria-hidden="true">
          ${icon('chevronRight', 16)}
        </span>
      </button>
    `).join('');

    return `
      <div class="${CSS.CARD} ${CSS.CONTINUE}"
           aria-labelledby="dash-continue-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-continue-heading">
            Continue Learning
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">
          ${items}
        </div>
      </div>
    `;
  }

  // ---- Widget 5: Statistics ------------------------------------------------

  /**
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderStatsWidget(s) {
    // Compute total time from quiz history and tutorial time-on-page
    const totalTutorialSecs = Object.values(s.tutorials.records)
      .reduce((sum, t) => sum + (t.timeOnPage ?? 0), 0);

    const totalQuizMs = Object.values(s.quizzes.records)
      .flatMap((q) => q.history ?? [])
      .reduce((sum, h) => sum + (h.timeMs ?? 0), 0);

    const totalLearningSecs = totalTutorialSecs + Math.floor(totalQuizMs / 1000);

    const stats = [
      {
        icon:    'book',
        value:   s.tutorials.completed,
        label:   'Tutorials completed',
        accent:  'var(--color-primary)',
      },
      {
        icon:    'quiz',
        value:   `${s.quizzes.passed}/${s.quizzes.attempted}`,
        label:   'Quizzes passed',
        accent:  'var(--color-success)',
      },
      {
        icon:    'project',
        value:   s.projects.completed,
        label:   'Projects completed',
        accent:  'var(--color-accent)',
      },
      {
        icon:    'chart',
        value:   `${s.quizzes.accuracy}%`,
        label:   'Quiz accuracy',
        accent:  'var(--color-warning)',
      },
      {
        icon:    'clock',
        value:   formatDuration(totalTutorialSecs),
        label:   'Tutorial time',
        accent:  'var(--color-code)',
      },
      {
        icon:    'clock',
        value:   formatDuration(totalLearningSecs),
        label:   'Total learning time',
        accent:  'var(--color-primary)',
      },
    ];

    const cards = stats.map((stat) => `
      <div class="${CSS.STAT_CARD}"
           role="listitem"
           aria-label="${escapeAttr(String(stat.value))} ${escapeAttr(stat.label)}">
        <span class="${CSS.STAT_ICON}"
              aria-hidden="true"
              style="color:${stat.accent}">
          ${icon(stat.icon, 20)}
        </span>
        <span class="${CSS.STAT_VALUE}">${escapeHtml(String(stat.value))}</span>
        <span class="${CSS.STAT_LABEL}">${escapeHtml(stat.label)}</span>
      </div>
    `).join('');

    return `
      <div class="${CSS.CARD} ${CSS.STATS}"
           aria-labelledby="dash-stats-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-stats-heading">
            Statistics
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">
          <div class="${CSS.STATS_GRID}" role="list" aria-label="Learning statistics">
            ${cards}
          </div>
        </div>
      </div>
    `;
  }

  // ---- Widget 6: Recent Activity -------------------------------------------

  /**
   * Assembles a time-sorted activity feed from tutorials, quizzes, and projects.
   *
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderActivityWidget(s) {
    const items = [];

    // Completed tutorials
    Object.values(s.tutorials.records)
      .filter((t) => t.completedAt)
      .forEach((t) => {
        items.push({
          ts:      t.completedAt,
          icon:    'book',
          title:   `Completed tutorial: ${t.title ?? t.id ?? 'Tutorial'}`,
          accent:  'var(--color-primary)',
        });
      });

    // Quiz attempts
    Object.values(s.quizzes.records)
      .filter((q) => q.lastAttemptAt)
      .forEach((q) => {
        items.push({
          ts:      q.lastAttemptAt,
          icon:    'quiz',
          title:   `Quiz: ${q.title ?? q.id ?? 'Quiz'} — best ${
            q.totalQuestions > 0
              ? Math.round((q.bestScore / q.totalQuestions) * 100) + '%'
              : 'N/A'
          }`,
          accent:  'var(--color-success)',
        });
      });

    // Completed projects
    Object.values(s.projects.records)
      .filter((p) => p.completedAt)
      .forEach((p) => {
        items.push({
          ts:      p.completedAt,
          icon:    'project',
          title:   `Completed project: ${p.title ?? p.id ?? 'Project'}`,
          accent:  'var(--color-accent)',
        });
      });

    // Recent achievements
    s.achievements.recent.slice(0, 3).forEach((a) => {
      if (a.unlockedAt) {
        items.push({
          ts:      a.unlockedAt,
          icon:    'trophy',
          title:   `Achievement unlocked: ${a.title ?? a.id ?? 'Achievement'}`,
          accent:  'var(--color-warning)',
        });
      }
    });

    // Sort descending by timestamp and cap
    items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const visible = items.slice(0, DASHBOARD_DEFAULTS.MAX_ACTIVITY_ITEMS);

    if (visible.length === 0) {
      return `
        <div class="${CSS.CARD} ${CSS.ACTIVITY}"
             aria-labelledby="dash-activity-heading">
          <div class="${CSS.CARD_HEADER}">
            <h2 class="${CSS.CARD_TITLE}" id="dash-activity-heading">
              Recent Activity
            </h2>
          </div>
          <div class="${CSS.CARD_BODY}">
            <p class="${CSS.ACTIVITY_EMPTY}">
              No activity yet. Complete your first tutorial to get started!
            </p>
          </div>
        </div>
      `;
    }

    const rows = visible.map((item) => `
      <li class="${CSS.ACTIVITY_ITEM}" role="listitem">
        <span class="${CSS.ACTIVITY_ICON}"
              aria-hidden="true"
              style="color:${item.accent}">
          ${icon(item.icon, 16)}
        </span>
        <div class="${CSS.ACTIVITY_BODY}">
          <span class="${CSS.ACTIVITY_TITLE}">${escapeHtml(item.title)}</span>
          <span class="${CSS.ACTIVITY_TIME}"
                aria-label="${relativeTime(item.ts)}">
            ${relativeTime(item.ts)}
          </span>
        </div>
      </li>
    `).join('');

    return `
      <div class="${CSS.CARD} ${CSS.ACTIVITY}"
           aria-labelledby="dash-activity-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-activity-heading">
            Recent Activity
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">
          <ul class="${CSS.ACTIVITY_LIST}" role="list" aria-label="Recent learning activity">
            ${rows}
          </ul>
        </div>
      </div>
    `;
  }

  // ---- Widget 7: Achievements ----------------------------------------------

  /**
   * @param {object} s — progress summary
   * @returns {string}
   */
  #renderAchievementsWidget(s) {
    const unlocked = s.achievements.all.filter((a) => a.unlocked);
    const locked   = s.achievements.all
      .filter((a) => !a.unlocked)
      .slice(0, DASHBOARD_DEFAULTS.MAX_LOCKED_PREVIEW);

    const unlockedBadges = unlocked.map((a) => `
      <div class="${CSS.ACHIEVEMENT_BADGE}"
           role="listitem"
           aria-label="${escapeAttr(a.title)}: ${escapeAttr(a.description)}">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">
          ${escapeHtml(a.icon ?? '🏅')}
        </span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">${escapeHtml(a.title)}</span>
      </div>
    `).join('');

    const lockedBadges = locked.map((a) => `
      <div class="${CSS.ACHIEVEMENT_BADGE} ${CSS.ACHIEVEMENT_LOCKED}"
           role="listitem"
           aria-label="${a.hidden ? 'Hidden achievement' : escapeAttr(a.title)} — locked">
        <span class="${CSS.ACHIEVEMENT_ICON}" aria-hidden="true">
          ${a.hidden ? icon('lock', 20) : escapeHtml(a.icon ?? '🔒')}
        </span>
        <span class="${CSS.ACHIEVEMENT_TITLE}">
          ${a.hidden ? '???' : escapeHtml(a.title)}
        </span>
      </div>
    `).join('');

    const pct = s.achievements.pct;

    return `
      <div class="${CSS.CARD} ${CSS.ACHIEVEMENTS}"
           aria-labelledby="dash-achievements-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-achievements-heading">
            Achievements
          </h2>
          <span aria-label="${s.achievements.unlocked} of ${s.achievements.total} achievements unlocked">
            ${s.achievements.unlocked} / ${s.achievements.total}
          </span>
        </div>
        <div class="${CSS.CARD_BODY}">
          <!-- Overall achievement progress bar -->
          <div role="progressbar"
               aria-valuenow="${pct}"
               aria-valuemin="0"
               aria-valuemax="100"
               aria-label="Achievement progress: ${pct}%"
               style="margin-bottom:var(--space-4)">
            <div class="${CSS.ACHIEVEMENT_BAR}">
              <div class="${CSS.ACHIEVEMENT_BAR_FILL}"
                   style="width:${pct}%">
              </div>
            </div>
          </div>

          <!-- Unlocked badges -->
          ${unlocked.length > 0 ? `
            <h3 class="dashboard__achievements-sub">Unlocked</h3>
            <div class="${CSS.ACHIEVEMENT_GRID}" role="list" aria-label="Unlocked achievements">
              ${unlockedBadges}
            </div>
          ` : `
            <p style="color:var(--color-text-secondary);margin-bottom:var(--space-4)">
              Complete tutorials and quizzes to unlock achievements!
            </p>
          `}

          <!-- Locked preview -->
          ${locked.length > 0 ? `
            <h3 class="dashboard__achievements-sub" style="margin-top:var(--space-4)">
              Up next
            </h3>
            <div class="${CSS.ACHIEVEMENT_GRID}" role="list" aria-label="Locked achievements preview">
              ${lockedBadges}
            </div>
          ` : ''}

        </div>
      </div>
    `;
  }

  // ---- Widget 8: Weekly Activity -------------------------------------------

  /**
   * Renders a 7-day bar chart using pure CSS bars with data-target attributes
   * for animation. Also prepares a <canvas> element as a hook for future
   * Chart.js / D3 rendering by external callers.
   *
   * @returns {string}
   */
  #renderWeeklyWidget() {
    const bars = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const d    = new Date(today);
      d.setDate(today.getDate() - i);
      const key  = dateKey(d);
      const val  = this.#state.weeklyActivity[key] ?? 0;
      bars.push({ label: shortDay(d), key, value: val });
    }

    const maxVal = Math.max(...bars.map((b) => b.value), 1);

    const barHtml = bars.map((b) => {
      const heightPct = Math.round((b.value / maxVal) * 100);
      const isToday   = b.key === dateKey(today);
      return `
        <div class="${CSS.WEEKLY_BAR_COL}">
          <span class="${CSS.WEEKLY_BAR_VALUE}" aria-hidden="true">
            ${b.value > 0 ? b.value : ''}
          </span>
          <div class="${CSS.WEEKLY_BAR}"
               aria-label="${escapeAttr(b.label)}: ${b.value} XP earned">
            <div class="${CSS.WEEKLY_BAR_FILL}"
                 data-target-height="${heightPct}"
                 style="height:0%;${isToday ? 'background:var(--color-primary);' : ''}
                        transition:height 0.6s ease-out;">
            </div>
          </div>
          <span class="${CSS.WEEKLY_BAR_LABEL}"
                ${isToday ? 'style="font-weight:var(--font-semibold);color:var(--color-primary)"' : ''}>
            ${escapeHtml(b.label)}
          </span>
        </div>
      `;
    }).join('');

    const totalWeekXp = bars.reduce((sum, b) => sum + b.value, 0);

    return `
      <div class="${CSS.CARD} ${CSS.WEEKLY}"
           aria-labelledby="dash-weekly-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-weekly-heading">
            Weekly Activity
          </h2>
          <span aria-label="${totalWeekXp} XP earned this week">
            ${totalWeekXp} XP this week
          </span>
        </div>
        <div class="${CSS.CARD_BODY}">

          <!-- CSS bar chart -->
          <div class="${CSS.WEEKLY_BARS}"
               role="img"
               aria-label="Bar chart showing XP earned each day this week">
            ${barHtml}
          </div>

          <!-- Canvas hook — wire in Chart.js or D3 externally by querying this element -->
          <canvas class="${CSS.WEEKLY_CANVAS}"
                  id="dash-weekly-canvas"
                  aria-hidden="true"
                  style="display:none"
                  data-labels='${escapeAttr(JSON.stringify(bars.map((b) => b.label)))}'
                  data-values='${escapeAttr(JSON.stringify(bars.map((b) => b.value)))}'>
          </canvas>

        </div>
      </div>
    `;
  }

  // ---- Widget 9: Quick Actions ---------------------------------------------

  /**
   * @returns {string}
   */
  #renderActionsWidget() {
    const actions = [
      {
        action:  'continue-learning',
        icon:    'play',
        label:   'Continue Learning',
        accent:  'var(--color-primary)',
        payload: {},
      },
      {
        action:  'start-quiz',
        icon:    'quiz',
        label:   'Start a Quiz',
        accent:  'var(--color-success)',
        payload: {},
      },
      {
        action:  'open-playground',
        icon:    'code',
        label:   'Open Playground',
        accent:  'var(--color-accent)',
        payload: {},
      },
      {
        action:  'browse-tutorials',
        icon:    'book',
        label:   'Browse Tutorials',
        accent:  'var(--color-code)',
        payload: {},
      },
      {
        action:  'view-projects',
        icon:    'project',
        label:   'View Projects',
        accent:  'var(--color-warning)',
        payload: {},
      },
      {
        action:  'view-achievements',
        icon:    'trophy',
        label:   'Achievements',
        accent:  'var(--color-primary)',
        payload: {},
      },
    ];

    const btns = actions.map((a) => `
      <button class="${CSS.ACTION_BTN}"
              type="button"
              data-action="${escapeAttr(a.action)}"
              data-payload='${escapeAttr(JSON.stringify(a.payload))}'
              aria-label="${escapeAttr(a.label)}">
        <span class="${CSS.ACTION_ICON}"
              aria-hidden="true"
              style="color:${a.accent}">
          ${icon(a.icon, 22)}
        </span>
        <span class="${CSS.ACTION_LABEL}">${escapeHtml(a.label)}</span>
      </button>
    `).join('');

    return `
      <div class="${CSS.CARD} ${CSS.ACTIONS}"
           aria-labelledby="dash-actions-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-actions-heading">
            Quick Actions
          </h2>
        </div>
        <div class="${CSS.CARD_BODY}">
          <div class="${CSS.ACTIONS_GRID}" role="list" aria-label="Quick action shortcuts">
            ${btns}
          </div>
        </div>
      </div>
    `;
  }

  // ---- Widget 10: Notifications --------------------------------------------

  /**
   * @returns {string}
   */
  #renderNotificationsWidget() {
    const notifications = this.#state.notifications;

    if (notifications.length === 0) {
      return `
        <div class="${CSS.CARD} ${CSS.NOTIFICATIONS}"
             aria-labelledby="dash-notif-heading">
          <div class="${CSS.CARD_HEADER}">
            <h2 class="${CSS.CARD_TITLE}" id="dash-notif-heading">
              ${icon('bell', 16)} Notifications
            </h2>
          </div>
          <div class="${CSS.CARD_BODY}">
            <p class="${CSS.NOTIFICATION_EMPTY}">
              You're all caught up! Keep learning to see updates here.
            </p>
          </div>
        </div>
      `;
    }

    const items = notifications.map((n) => `
      <li class="${CSS.NOTIFICATION_ITEM} ${n.isNew ? CSS.NOTIFICATION_ITEM_NEW : ''}"
          role="listitem"
          data-notif-id="${escapeAttr(n.id)}">
        <span class="${CSS.NOTIFICATION_ICON}"
              aria-hidden="true"
              style="color:${n.accent ?? 'var(--color-primary)'}">
          ${icon(n.iconName ?? 'bell', 16)}
        </span>
        <div class="${CSS.NOTIFICATION_BODY}">
          <span class="${CSS.NOTIFICATION_TITLE}">${escapeHtml(n.title)}</span>
          <span class="${CSS.NOTIFICATION_TIME}">${relativeTime(n.ts)}</span>
        </div>
        <button class="${CSS.NOTIFICATION_DISMISS}"
                type="button"
                data-action="dismiss-notification"
                data-notif-id="${escapeAttr(n.id)}"
                aria-label="Dismiss: ${escapeAttr(n.title)}">
          ${icon('close', 14)}
        </button>
      </li>
    `).join('');

    return `
      <div class="${CSS.CARD} ${CSS.NOTIFICATIONS}"
           aria-labelledby="dash-notif-heading">
        <div class="${CSS.CARD_HEADER}">
          <h2 class="${CSS.CARD_TITLE}" id="dash-notif-heading">
            ${icon('bell', 16)} Notifications
          </h2>
          <button class="${CSS.NOTIFICATION_CLEAR}"
                  type="button"
                  data-action="clear-notifications"
                  aria-label="Clear all notifications">
            Clear all
          </button>
        </div>
        <div class="${CSS.CARD_BODY}">
          <ul class="${CSS.NOTIFICATION_LIST}"
              role="list"
              aria-label="Notifications"
              aria-live="polite">
            ${items}
          </ul>
        </div>
      </div>
    `;
  }

  // ---- Private: animations -------------------------------------------------

  /**
   * Animate the XP progress bar fill after the DOM has painted.
   *
   * @param {number} targetPct — 0–100
   */
  #animateXpBar(targetPct) {
    if (prefersReducedMotion()) {
      const bar  = this.#grid?.querySelector(`#dash-xp-bar`);
      const ring = this.#grid?.querySelector(`#dash-xp-ring`);
      if (bar)  bar.style.width = `${targetPct}%`;
      if (ring) {
        const offset = Number(ring.dataset.targetOffset ?? 0);
        ring.setAttribute('stroke-dashoffset', String(offset));
      }
      return;
    }

    // Bar
    const bar = this.#grid?.querySelector(`#dash-xp-bar`);
    if (bar) {
      const target = bar.dataset.targetPct ?? '0';
      requestAnimationFrame(() => {
        bar.style.width = `${target}%`;
      });
    }

    // SVG ring
    const ring = this.#grid?.querySelector(`#dash-xp-ring`);
    if (ring) {
      const offset = ring.dataset.targetOffset ?? '0';
      requestAnimationFrame(() => {
        ring.setAttribute('stroke-dashoffset', offset);
      });
    }
  }

  /**
   * Animate the weekly activity bar heights after the DOM has painted.
   */
  #animateWeeklyBars() {
    const fills = this.#grid?.querySelectorAll(`.${CSS.WEEKLY_BAR_FILL}`);
    if (!fills) return;

    fills.forEach((fill) => {
      const target = fill.dataset.targetHeight ?? '0';
      if (prefersReducedMotion()) {
        fill.style.height = `${target}%`;
      } else {
        requestAnimationFrame(() => {
          fill.style.height = `${target}%`;
        });
      }
    });
  }

  // ---- Private: widget-level events ----------------------------------------

  /**
   * Attach click event listeners for all interactive elements within
   * the rendered widgets. Uses event delegation on the grid for efficiency.
   * All previous listeners are cleaned up before re-attaching.
   */
  #attachWidgetEvents() {
    if (!this.#grid) return;

    // Remove any previous delegated listener
    if (this._widgetClickHandler) {
      this.#grid.removeEventListener('click', this._widgetClickHandler);
    }

    this._widgetClickHandler = (e) => this.#handleWidgetClick(e);
    this.#grid.addEventListener('click', this._widgetClickHandler);

    this.#cleanupFns = this.#cleanupFns.filter((fn) => {
      // Keep non-grid cleanup functions intact
      return true;
    });

    this.#cleanupFns.push(() => {
      this.#grid?.removeEventListener('click', this._widgetClickHandler);
    });
  }

  /**
   * Handle all click events bubbled from within the widget grid.
   *
   * @param {MouseEvent} e
   */
  #handleWidgetClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    let payload  = {};

    try {
      if (actionEl.dataset.payload) {
        payload = JSON.parse(actionEl.dataset.payload);
      }
    } catch {
      // Malformed payload — proceed with empty object
    }

    switch (action) {
      case 'dismiss-notification': {
        const notifId = actionEl.dataset.notifId;
        if (notifId) {
          this.#dismissNotification(notifId);
        }
        break;
      }

      case 'clear-notifications': {
        this.#clearNotifications();
        break;
      }

      default: {
        // All other actions (resume-tutorial, start-quiz, open-playground…)
        // are forwarded to page scripts via the event bus
        this.#dispatch(DASHBOARD_EVENTS.ACTION, { action, payload });
        break;
      }
    }
  }

  // ---- Private: notification management ------------------------------------

  /**
   * Add a notification to the internal queue and update the widget.
   *
   * @param {{
   *   id:        string,
   *   title:     string,
   *   iconName?: string,
   *   accent?:   string,
   *   ts?:       number,
   * }} notification
   */
  #addNotification(notification) {
    // Prevent exact duplicates
    const alreadyExists = this.#state.notifications.some((n) => n.id === notification.id);
    if (alreadyExists) return;

    const notif = {
      id:       notification.id,
      title:    notification.title,
      iconName: notification.iconName ?? 'bell',
      accent:   notification.accent   ?? 'var(--color-primary)',
      ts:       notification.ts       ?? Date.now(),
      isNew:    true,
    };

    this.#state.notifications.unshift(notif);

    // Cap the list
    if (this.#state.notifications.length > DASHBOARD_DEFAULTS.MAX_NOTIFICATIONS) {
      this.#state.notifications = this.#state.notifications.slice(
        0, DASHBOARD_DEFAULTS.MAX_NOTIFICATIONS
      );
    }

    this.#saveCache();

    // Re-render just the notifications widget
    this.#updateWidget('notifications', this.#renderNotificationsWidget());
  }

  /**
   * Dismiss a single notification by ID.
   *
   * @param {string} notifId
   */
  #dismissNotification(notifId) {
    this.#state.notifications = this.#state.notifications.filter((n) => n.id !== notifId);
    this.#saveCache();
    this.#updateWidget('notifications', this.#renderNotificationsWidget());
    this.#announce('Notification dismissed.');
  }

  /**
   * Clear all notifications.
   */
  #clearNotifications() {
    this.#state.notifications = [];
    this.#saveCache();
    this.#updateWidget('notifications', this.#renderNotificationsWidget());
    this.#announce('All notifications cleared.');
  }

  // ---- Private: targeted widget update ------------------------------------

  /**
   * Replace the inner HTML of a single named widget without re-rendering
   * the entire grid. This is the efficient update path for reactive events.
   *
   * @param {string} widgetId — Matches the data-widget attribute
   * @param {string} html     — New inner HTML for the widget wrapper
   */
  #updateWidget(widgetId, html) {
    const el = this.#grid?.querySelector(`[data-widget="${widgetId}"]`);
    if (!el) return;
    el.innerHTML = html;
  }

  // ---- Private: event subscriptions ----------------------------------------

  /**
   * Subscribe to all external events that the dashboard reacts to.
   * Every listener is stored in #cleanupFns for teardown.
   */
  #attachEventListeners() {
    // ── progress:updated ────────────────────────────────────────────────────
    const onProgressUpdated = () => {
      this.#debouncedRefresh('progress:updated');
    };
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated)
    );

    // ── progress:achievement:unlocked ───────────────────────────────────────
    const onAchievement = (e) => {
      const achievement = e.detail?.achievement;
      if (!achievement) return;

      this.#addNotification({
        id:       `achievement-${achievement.id}-${Date.now()}`,
        title:    `Achievement unlocked: ${achievement.title ?? achievement.id}`,
        iconName: 'trophy',
        accent:   'var(--color-warning)',
      });

      this.#showToast(
        `🏆 Achievement unlocked: ${achievement.title ?? achievement.id}`,
        'success'
      );

      this.#announce(`Achievement unlocked: ${achievement.title ?? achievement.id}`);

      // Track XP in the weekly activity map
      if (achievement.xp) {
        this.#addToWeeklyActivity(achievement.xp);
      }
    };
    document.addEventListener(PROGRESS_EVENTS.ACHIEVEMENT_UNLOCKED, onAchievement);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.ACHIEVEMENT_UNLOCKED, onAchievement)
    );

    // ── progress:level:up ───────────────────────────────────────────────────
    const onLevelUp = (e) => {
      const { level } = e.detail ?? {};
      if (!level) return;

      this.#showToast(`⬆️ You reached Level ${level}!`, 'success');

      this.#addNotification({
        id:       `level-up-${level}-${Date.now()}`,
        title:    `You reached Level ${level}!`,
        iconName: 'xp',
        accent:   'var(--color-primary)',
      });

      this.#announce(`Level up! You are now Level ${level}.`);
    };
    document.addEventListener(PROGRESS_EVENTS.LEVEL_UP, onLevelUp);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.LEVEL_UP, onLevelUp)
    );

    // ── progress:streak:warning ─────────────────────────────────────────────
    const onStreakWarning = (e) => {
      const { current } = e.detail ?? {};
      this.#showToast(
        `⚠️ Your ${current}-day streak expires soon! Keep it alive.`,
        'warning'
      );

      this.#addNotification({
        id:       `streak-warning-${Date.now()}`,
        title:    `Your ${current}-day streak expires soon!`,
        iconName: 'flame',
        accent:   'var(--color-warning)',
      });
    };
    document.addEventListener(PROGRESS_EVENTS.STREAK_WARNING, onStreakWarning);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.STREAK_WARNING, onStreakWarning)
    );

    // ── progress:xp:gained ──────────────────────────────────────────────────
    const onXpGained = (e) => {
      const { amount } = e.detail ?? {};
      if (amount) this.#addToWeeklyActivity(amount);
    };
    document.addEventListener(PROGRESS_EVENTS.XP_GAINED, onXpGained);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.XP_GAINED, onXpGained)
    );

    // ── quiz:submitted ──────────────────────────────────────────────────────
    const onQuizSubmitted = (e) => {
      const { quizId, passed, grade, xp } = e.detail ?? {};
      if (!quizId) return;

      this.#addNotification({
        id:       `quiz-${quizId}-${Date.now()}`,
        title:    `Quiz completed — Grade: ${grade ?? 'N/A'} ${passed ? '✓' : ''}`,
        iconName: 'quiz',
        accent:   passed ? 'var(--color-success)' : 'var(--color-danger)',
      });

      if (xp) this.#addToWeeklyActivity(xp);
      this.#debouncedRefresh('quiz:submitted');
    };
    document.addEventListener('quiz:submitted', onQuizSubmitted);
    this.#cleanupFns.push(() =>
      document.removeEventListener('quiz:submitted', onQuizSubmitted)
    );

    // ── editor:saved ────────────────────────────────────────────────────────
    const onEditorSaved = () => {
      // Bump today's activity count as a small engagement signal (5 XP equivalent)
      this.#addToWeeklyActivity(5);
    };
    document.addEventListener('editor:saved', onEditorSaved);
    this.#cleanupFns.push(() =>
      document.removeEventListener('editor:saved', onEditorSaved)
    );
  }

  // ---- Private: weekly activity tracking -----------------------------------

  /**
   * Add an XP amount to today's bucket in the weekly activity map.
   *
   * @param {number} xp
   */
  #addToWeeklyActivity(xp) {
    if (!Number.isFinite(xp) || xp <= 0) return;

    const key = dateKey(new Date());
    this.#state.weeklyActivity[key] = (this.#state.weeklyActivity[key] ?? 0) + xp;

    // Trim entries older than 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffKey = dateKey(cutoff);

    for (const k of Object.keys(this.#state.weeklyActivity)) {
      if (k < cutoffKey) {
        delete this.#state.weeklyActivity[k];
      }
    }

    this.#saveCache();
  }

  // ---- Private: toast notifications ----------------------------------------

  /**
   * Show a temporary toast notification at the top of the dashboard.
   * Auto-dismisses after 4 seconds. Respects prefers-reduced-motion.
   *
   * @param {string} message
   * @param {'success'|'info'|'warning'} [type='info']
   */
  #showToast(message, type = 'info') {
    if (!this.#toastRegion) return;

    if (this.#state.toastTimer !== null) {
      clearTimeout(this.#state.toastTimer);
      this.#state.toastTimer = null;
    }

    const typeClass = {
      success: CSS.TOAST_SUCCESS,
      info:    CSS.TOAST_INFO,
      warning: CSS.TOAST_WARNING,
    }[type] ?? CSS.TOAST_INFO;

    this.#toastRegion.innerHTML = `
      <div class="${CSS.TOAST} ${typeClass}"
           role="status"
           aria-live="polite">
        ${escapeHtml(message)}
      </div>
    `;

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      const toast = this.#toastRegion?.querySelector(`.${CSS.TOAST}`);
      if (!toast) return;

      if (!prefersReducedMotion()) {
        toast.classList.add(CSS.TOAST_VISIBLE);
      }
    });

    this.#state.toastTimer = setTimeout(() => {
      this.#toastRegion.innerHTML = '';
      this.#state.toastTimer = null;
    }, 4000);
  }

  // ---- Private: accessibility ----------------------------------------------

  /**
   * Write a message to the ARIA live region for screen reader announcement.
   * Clears first to ensure re-announcements of identical strings still trigger AT.
   *
   * @param {string} message
   */
  #announce(message) {
    if (!this.#liveRegion) return;
    this.#liveRegion.textContent = '';
    requestAnimationFrame(() => {
      if (this.#liveRegion) {
        this.#liveRegion.textContent = message;
      }
    });
  }

  // ---- Private: event bus --------------------------------------------------

  /**
   * Publish an event to the project event bus and as a native CustomEvent.
   * Consistent pattern with navigation.js, header.js, footer.js, quiz.js, code-editor.js.
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