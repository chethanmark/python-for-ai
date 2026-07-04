/**
 * =============================================================================
 * QUIZ ENGINE COMPONENT
 * scripts/components/quiz.js
 * -----------------------------------------------------------------------------
 * Full-featured quiz system for the Python for AI educational platform.
 * Manages the complete lifecycle of a quiz session: loading, rendering,
 * answering, timing, submitting, scoring, reviewing, and persisting progress.
 *
 * ARCHITECTURE OVERVIEW:
 *   The QuizEngine orchestrates three subordinate classes and exposes a single
 *   clean public API to page scripts (quizzes.js, tutorial-detail.js):
 *
 *   QuizEngine              ← primary class, default export
 *     ├─ QuizTimer          ← countdown timer, pause/resume, auto-submit
 *     ├─ QuizScorer         ← score, grade, XP, pass/fail computation
 *     └─ QuizStore          ← localStorage persistence with schema versioning
 *
 * QUESTION TYPES SUPPORTED:
 *   • multiple-choice   — one correct answer from 2–6 options
 *   • multiple-select   — one or more correct answers (checkboxes)
 *   • fill-in-the-blank — free-text answer compared against accepted values
 *
 * DATA CONTRACT (quiz JSON loaded by quizzes.js or tutorial-detail.js):
 *   {
 *     id:          string,                 — unique slug, e.g. "python-basics-quiz"
 *     title:       string,
 *     description: string,
 *     passMark:    number,                 — 0–100 percentage (default: 70)
 *     timeLimit:   number | null,          — seconds; null = untimed
 *     randomize:   boolean,
 *     questions: [{
 *       id:          string,
 *       type:        'multiple-choice' | 'multiple-select' | 'fill-in-the-blank',
 *       text:        string,
 *       code?:       string,              — optional code block shown with question
 *       options?:    string[],            — required for multiple-choice / multiple-select
 *       correct:     number | number[] | string[],
 *                                         — index(es) for MC/MS; accepted strings for FITB
 *       explanation: string,
 *       hint?:       string,
 *       points?:     number,              — default: 1
 *     }]
 *   }
 *
 * SESSION STATE MACHINE:
 *   idle → loading → active → paused → submitting → complete → review
 *                       ↑______________|  (resume from paused)
 *
 * STORAGE SCHEMA (localStorage key: "pyai-quiz-session-{quizId}"):
 *   {
 *     version:     1,
 *     quizId:      string,
 *     startedAt:   number,
 *     answers:     Record<string, UserAnswer>,
 *     bookmarks:   string[],
 *     flags:       string[],
 *     currentIdx:  number,
 *     elapsed:     number,     — elapsed seconds at time of save
 *     questionOrder: string[], — shuffled question ID order
 *   }
 *
 * DEPENDENCIES:
 *   - scripts/components/progress-tracker.js  — XP and attempt recording
 *   - scripts/core/events.js                  — global event bus
 *   - variables.css design tokens             — all styling via CSS classes
 *
 * EVENT EMISSIONS (via CustomEvent + window.__pyaiEvents):
 *   quiz:started          { quizId, total, timeLimit }
 *   quiz:question:changed { quizId, index, total, questionId }
 *   quiz:answered         { quizId, questionId, answer, bookmarked, flagged }
 *   quiz:bookmarked       { quizId, questionId, bookmarked }
 *   quiz:flagged          { quizId, questionId, flagged }
 *   quiz:skipped          { quizId, questionId, index }
 *   quiz:timer:tick       { quizId, remaining, elapsed, total }
 *   quiz:timer:warning    { quizId, remaining }
 *   quiz:timer:expired    { quizId }
 *   quiz:paused           { quizId, elapsed }
 *   quiz:resumed          { quizId, remaining }
 *   quiz:submitted        { quizId, score, total, pct, passed, grade, xp, timeMs }
 *   quiz:review:changed   { quizId, index, total }
 *   quiz:reset            { quizId }
 *
 * USAGE (quizzes.js or tutorial-detail.js):
 *
 *   import QuizEngine, { QUIZ_EVENTS, QUIZ_STATUS } from './components/quiz.js';
 *   import ProgressTracker from './components/progress-tracker.js';
 *
 *   const tracker = new ProgressTracker();
 *   tracker.init();
 *
 *   const quiz = new QuizEngine({
 *     containerId:     'quiz-container',
 *     tracker,
 *     passMark:        70,
 *     randomize:       true,
 *     timeLimit:       600,
 *     timeBonusMax:    50,
 *     showHints:       true,
 *   });
 *
 *   const quizData = await fetch('/data/quizzes/python-basics/quiz.json')
 *     .then(r => r.json());
 *
 *   quiz.load(quizData);
 *   quiz.start();
 *
 *   document.addEventListener(QUIZ_EVENTS.SUBMITTED, (e) => {
 *     console.log('Quiz submitted:', e.detail);
 *   });
 *
 * EXPORTS:
 *   QuizEngine    — primary class (default export)
 *   QUIZ_EVENTS   — event name constants
 *   QUIZ_STATUS   — session status constants
 *   QUIZ_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ProgressTracker, PROGRESS_EVENTS } from './progress-tracker.js';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the quiz engine.
 * All events bubble on document and are also published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const QUIZ_EVENTS = Object.freeze({
  STARTED:          'quiz:started',
  QUESTION_CHANGED: 'quiz:question:changed',
  ANSWERED:         'quiz:answered',
  BOOKMARKED:       'quiz:bookmarked',
  FLAGGED:          'quiz:flagged',
  SKIPPED:          'quiz:skipped',
  TIMER_TICK:       'quiz:timer:tick',
  TIMER_WARNING:    'quiz:timer:warning',
  TIMER_EXPIRED:    'quiz:timer:expired',
  PAUSED:           'quiz:paused',
  RESUMED:          'quiz:resumed',
  SUBMITTED:        'quiz:submitted',
  REVIEW_CHANGED:   'quiz:review:changed',
  RESET:            'quiz:reset',
});

/**
 * Session status values for the quiz state machine.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const QUIZ_STATUS = Object.freeze({
  IDLE:        'idle',
  LOADING:     'loading',
  ACTIVE:      'active',
  PAUSED:      'paused',
  SUBMITTING:  'submitting',
  COMPLETE:    'complete',
  REVIEW:      'review',
});

/**
 * Default configuration values applied when not specified by the caller.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const QUIZ_DEFAULTS = Object.freeze({
  /** Minimum percentage score required to pass (0–100) */
  PASS_MARK:          70,

  /** Seconds before timer fires a low-time warning event */
  TIMER_WARNING_SECS: 60,

  /** Maximum bonus XP awarded for completing with full time remaining */
  TIME_BONUS_MAX:     50,

  /** Maximum extra XP awarded for a perfect score (on top of base XP) */
  PERFECT_BONUS:      75,

  /** Whether to shuffle questions on each new session */
  RANDOMIZE:          true,

  /** Whether to show hint buttons (exposes question.hint if present) */
  SHOW_HINTS:         true,

  /** Whether to show the question count in the progress bar */
  SHOW_PROGRESS:      true,

  /** localStorage storage schema version */
  STORE_VERSION:      1,

  /** Seconds of inactivity after which a paused session is abandoned */
  ABANDON_TIMEOUT_S:  86_400,   // 24 hours
});

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth, zero magic strings
// ---------------------------------------------------------------------------

/**
 * BEM class names for every element the quiz engine renders.
 * Follow the same pattern as navigation.js, footer.js, and header.js.
 *
 * @type {Record<string, string>}
 */
const CSS = {
  // Root
  ROOT:                'quiz',
  ROOT_ACTIVE:         'quiz--active',
  ROOT_REVIEW:         'quiz--review',
  ROOT_COMPLETE:       'quiz--complete',
  ROOT_PAUSED:         'quiz--paused',
  ROOT_LOADING:        'quiz--loading',

  // Header bar
  HEADER:              'quiz__header',
  TITLE:               'quiz__title',
  TIMER:               'quiz__timer',
  TIMER_INNER:         'quiz__timer-inner',
  TIMER_ICON:          'quiz__timer-icon',
  TIMER_DISPLAY:       'quiz__timer-display',
  TIMER_WARNING:       'quiz__timer--warning',
  TIMER_CRITICAL:      'quiz__timer--critical',
  PROGRESS_BAR:        'quiz__progress-bar',
  PROGRESS_FILL:       'quiz__progress-fill',
  PROGRESS_LABEL:      'quiz__progress-label',

  // Question panel
  QUESTION_PANEL:      'quiz__question-panel',
  QUESTION_META:       'quiz__question-meta',
  QUESTION_NUMBER:     'quiz__question-number',
  QUESTION_TYPE:       'quiz__question-type',
  QUESTION_ACTIONS:    'quiz__question-actions',
  BOOKMARK_BTN:        'quiz__bookmark-btn',
  BOOKMARK_ACTIVE:     'quiz__bookmark-btn--active',
  FLAG_BTN:            'quiz__flag-btn',
  FLAG_ACTIVE:         'quiz__flag-btn--active',
  QUESTION_TEXT:       'quiz__question-text',
  QUESTION_CODE:       'quiz__question-code',
  HINT_WRAPPER:        'quiz__hint-wrapper',
  HINT_BTN:            'quiz__hint-btn',
  HINT_TEXT:           'quiz__hint-text',
  HINT_VISIBLE:        'quiz__hint-wrapper--visible',

  // Options (multiple-choice / multiple-select)
  OPTIONS:             'quiz__options',
  OPTION:              'quiz__option',
  OPTION_INPUT:        'quiz__option-input',
  OPTION_LABEL:        'quiz__option-label',
  OPTION_SELECTED:     'quiz__option--selected',
  OPTION_CORRECT:      'quiz__option--correct',
  OPTION_INCORRECT:    'quiz__option--incorrect',
  OPTION_MISSED:       'quiz__option--missed',

  // Fill-in-the-blank
  FITB_WRAPPER:        'quiz__fitb-wrapper',
  FITB_INPUT:          'quiz__fitb-input',
  FITB_CORRECT:        'quiz__fitb-input--correct',
  FITB_INCORRECT:      'quiz__fitb-input--incorrect',

  // Review explanation panel
  EXPLANATION:         'quiz__explanation',
  EXPLANATION_VISIBLE: 'quiz__explanation--visible',
  EXPLANATION_LABEL:   'quiz__explanation-label',
  EXPLANATION_TEXT:    'quiz__explanation-text',
  CORRECT_ANSWER:      'quiz__correct-answer',

  // Navigation controls
  CONTROLS:            'quiz__controls',
  BTN_PREV:            'quiz__btn-prev',
  BTN_NEXT:            'quiz__btn-next',
  BTN_SKIP:            'quiz__btn-skip',
  BTN_SUBMIT:          'quiz__btn-submit',
  BTN_PAUSE:           'quiz__btn-pause',
  BTN_RESUME:          'quiz__btn-resume',

  // Question map (thumbnail navigation)
  MAP:                 'quiz__map',
  MAP_HEADING:         'quiz__map-heading',
  MAP_GRID:            'quiz__map-grid',
  MAP_BTN:             'quiz__map-btn',
  MAP_BTN_ANSWERED:    'quiz__map-btn--answered',
  MAP_BTN_FLAGGED:     'quiz__map-btn--flagged',
  MAP_BTN_BOOKMARKED:  'quiz__map-btn--bookmarked',
  MAP_BTN_CURRENT:     'quiz__map-btn--current',

  // Results / score screen
  RESULTS:             'quiz__results',
  RESULTS_ICON:        'quiz__results-icon',
  RESULTS_TITLE:       'quiz__results-title',
  RESULTS_GRADE:       'quiz__results-grade',
  RESULTS_SCORE:       'quiz__results-score',
  RESULTS_DETAIL:      'quiz__results-detail',
  RESULTS_STAT:        'quiz__results-stat',
  RESULTS_STAT_VALUE:  'quiz__results-stat-value',
  RESULTS_STAT_LABEL:  'quiz__results-stat-label',
  RESULTS_XP:          'quiz__results-xp',
  RESULTS_ACTIONS:     'quiz__results-actions',
  BTN_REVIEW:          'quiz__btn-review',
  BTN_RETAKE:          'quiz__btn-retake',
  BTN_CONTINUE:        'quiz__btn-continue',

  // Paused screen
  PAUSED_SCREEN:       'quiz__paused-screen',
  PAUSED_TITLE:        'quiz__paused-title',
  PAUSED_ACTIONS:      'quiz__paused-actions',

  // Live region for screen reader announcements
  LIVE:                'quiz__live',
};

// ---------------------------------------------------------------------------
// Grade table
// ---------------------------------------------------------------------------

/**
 * Letter grade boundaries (percentage-based).
 * Each entry: { min, label, cssClass }.
 *
 * @type {ReadonlyArray<{min: number, label: string, cssClass: string}>}
 */
const GRADE_TABLE = Object.freeze([
  { min: 90, label: 'A+', cssClass: 'grade--a-plus'  },
  { min: 85, label: 'A',  cssClass: 'grade--a'       },
  { min: 80, label: 'A−', cssClass: 'grade--a-minus' },
  { min: 75, label: 'B+', cssClass: 'grade--b-plus'  },
  { min: 70, label: 'B',  cssClass: 'grade--b'       },
  { min: 65, label: 'B−', cssClass: 'grade--b-minus' },
  { min: 60, label: 'C+', cssClass: 'grade--c-plus'  },
  { min: 55, label: 'C',  cssClass: 'grade--c'       },
  { min: 50, label: 'C−', cssClass: 'grade--c-minus' },
  { min: 45, label: 'D',  cssClass: 'grade--d'       },
  { min: 0,  label: 'F',  cssClass: 'grade--f'       },
]);

// ---------------------------------------------------------------------------
// Inline SVG icon factory
// ---------------------------------------------------------------------------

/**
 * Returns an inline SVG for a named icon used in the quiz UI.
 * All icons are aria-hidden — surrounding text or aria-label carries meaning.
 *
 * @param {string} name
 * @param {number} [size=20]
 * @returns {string}
 */
function icon(name, size = 20) {
  const s = size;
  const ICONS = {
    clock: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <circle cx="12" cy="12" r="10"/>
               <polyline points="12 6 12 12 16 14"/>
             </svg>`,

    bookmark: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"
                  aria-hidden="true" focusable="false">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
               </svg>`,

    bookmarkFilled: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
                       stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round"
                       aria-hidden="true" focusable="false">
                       <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                     </svg>`,

    flag: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
           </svg>`,

    flagFilled: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
                   stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true" focusable="false">
                   <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                   <line x1="4" y1="22" x2="4" y2="15"/>
                 </svg>`,

    hint: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
           </svg>`,

    chevronLeft: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true" focusable="false">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>`,

    chevronRight: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true" focusable="false">
                     <polyline points="9 18 15 12 9 6"/>
                   </svg>`,

    pause: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
               aria-hidden="true" focusable="false">
               <rect x="6"  y="4" width="4" height="16"/>
               <rect x="14" y="4" width="4" height="16"/>
            </svg>`,

    play: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="5 3 19 12 5 21 5 3"/>
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

    star: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02
                               12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
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

    xp: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true" focusable="false">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02
                             12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
         </svg>`,
  };
  return ICONS[name] ?? '';
}

// ---------------------------------------------------------------------------
// Pure utility functions (module-private)
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters to prevent XSS when rendering
 * data-driven strings into innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Escapes a string for safe use inside an HTML attribute value.
 *
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
 * Formats a duration in seconds to MM:SS display string.
 *
 * @param {number} totalSeconds
 * @returns {string}  e.g. "09:45"
 */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Shuffles an array using the Fisher-Yates algorithm.
 * Returns a new array; the original is not mutated.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Derives the letter grade and CSS class from a percentage score.
 *
 * @param {number} pct  — 0–100
 * @returns {{ label: string, cssClass: string }}
 */
function getGrade(pct) {
  return GRADE_TABLE.find((g) => pct >= g.min) ?? GRADE_TABLE.at(-1);
}

/**
 * Returns true when the user prefers reduced motion.
 * Checked fresh each call — OS settings can change mid-session.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns a debounced version of the given function.
 *
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
 * Normalises a fill-in-the-blank answer for comparison.
 * Lowercases, trims, and collapses interior whitespace.
 *
 * @param {string} str
 * @returns {string}
 */
function normaliseFitb(str) {
  return String(str).toLowerCase().trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// QuizStore — localStorage persistence
// ---------------------------------------------------------------------------

/**
 * Manages save/restore of an in-progress quiz session.
 * Schema-versioned for future-safe migrations.
 * Falls back gracefully if localStorage is unavailable.
 */
class QuizStore {
  /** @type {string} */ #keyPrefix = 'pyai-quiz-session-';

  /**
   * Build the storage key for a given quiz ID.
   * @param {string} quizId
   * @returns {string}
   */
  #key(quizId) {
    return `${this.#keyPrefix}${quizId}`;
  }

  /**
   * Save the current quiz session state.
   *
   * @param {string} quizId
   * @param {{
   *   answers:       Record<string, UserAnswer>,
   *   bookmarks:     string[],
   *   flags:         string[],
   *   currentIdx:    number,
   *   elapsed:       number,
   *   questionOrder: string[],
   *   startedAt:     number,
   * }} session
   */
  save(quizId, session) {
    try {
      const payload = JSON.stringify({
        version:       QUIZ_DEFAULTS.STORE_VERSION,
        quizId,
        savedAt:       Date.now(),
        ...session,
      });
      localStorage.setItem(this.#key(quizId), payload);
    } catch {
      // Quota exceeded or storage blocked — silently continue
    }
  }

  /**
   * Load a previously saved session for the given quiz.
   * Returns null if not found, expired, or malformed.
   *
   * @param {string} quizId
   * @returns {object|null}
   */
  load(quizId) {
    try {
      const raw = localStorage.getItem(this.#key(quizId));
      if (!raw) return null;

      const data = JSON.parse(raw);

      // Version check
      if (data.version !== QUIZ_DEFAULTS.STORE_VERSION) return null;

      // Abandon sessions older than ABANDON_TIMEOUT_S
      const ageSecs = (Date.now() - (data.savedAt ?? 0)) / 1000;
      if (ageSecs > QUIZ_DEFAULTS.ABANDON_TIMEOUT_S) {
        this.clear(quizId);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Remove the saved session for a quiz.
   * Called after successful submission or deliberate reset.
   *
   * @param {string} quizId
   */
  clear(quizId) {
    try {
      localStorage.removeItem(this.#key(quizId));
    } catch {
      // Swallow
    }
  }

  /**
   * Check whether a saved session exists for the given quiz.
   *
   * @param {string} quizId
   * @returns {boolean}
   */
  has(quizId) {
    return this.load(quizId) !== null;
  }
}

// ---------------------------------------------------------------------------
// QuizTimer — countdown, pause, resume, auto-submit
// ---------------------------------------------------------------------------

/**
 * Countdown timer for timed quiz sessions.
 * Fires callbacks on tick, warning threshold, and expiry.
 * All interval management is internal; the caller calls start/pause/resume/stop.
 */
class QuizTimer {
  /** @type {number}         */ #totalSecs;
  /** @type {number}         */ #remaining;
  /** @type {number|null}    */ #intervalId = null;
  /** @type {boolean}        */ #running    = false;
  /** @type {number}         */ #warnSecs;
  /** @type {boolean}        */ #warnFired  = false;

  /** @type {(remaining: number, elapsed: number, total: number) => void} */
  #onTick;

  /** @type {(remaining: number) => void} */
  #onWarning;

  /** @type {() => void} */
  #onExpire;

  /**
   * @param {{
   *   totalSecs:  number,
   *   warnSecs?:  number,
   *   onTick:     (remaining: number, elapsed: number, total: number) => void,
   *   onWarning:  (remaining: number) => void,
   *   onExpire:   () => void,
   * }} options
   */
  constructor({ totalSecs, warnSecs, onTick, onWarning, onExpire }) {
    this.#totalSecs = totalSecs;
    this.#remaining = totalSecs;
    this.#warnSecs  = warnSecs ?? QUIZ_DEFAULTS.TIMER_WARNING_SECS;
    this.#onTick    = onTick;
    this.#onWarning = onWarning;
    this.#onExpire  = onExpire;
  }

  /** @returns {number} Seconds remaining */
  get remaining() { return this.#remaining; }

  /** @returns {number} Seconds elapsed */
  get elapsed() { return this.#totalSecs - this.#remaining; }

  /** @returns {number} Total seconds configured */
  get total() { return this.#totalSecs; }

  /** @returns {boolean} */
  get isRunning() { return this.#running; }

  /**
   * Start counting down.
   * Safe to call after pause — resumes from where it stopped.
   */
  start() {
    if (this.#running) return;
    this.#running = true;

    this.#intervalId = setInterval(() => {
      if (!this.#running) return;

      this.#remaining = Math.max(0, this.#remaining - 1);
      this.#onTick(this.#remaining, this.elapsed, this.#totalSecs);

      // Warning threshold
      if (!this.#warnFired && this.#remaining <= this.#warnSecs && this.#remaining > 0) {
        this.#warnFired = true;
        this.#onWarning(this.#remaining);
      }

      // Expiry
      if (this.#remaining === 0) {
        this.stop();
        this.#onExpire();
      }
    }, 1000);
  }

  /**
   * Pause the countdown. The elapsed time is preserved.
   */
  pause() {
    if (!this.#running) return;
    this.#running = false;
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  /**
   * Stop and clear the timer completely.
   */
  stop() {
    this.pause();
  }

  /**
   * Restore the remaining time from a saved session.
   * Must be called before start() when resuming.
   *
   * @param {number} remainingSecs
   */
  restore(remainingSecs) {
    this.#remaining = Math.max(0, Math.min(this.#totalSecs, remainingSecs));
  }
}

// ---------------------------------------------------------------------------
// QuizScorer — score calculation, XP, pass/fail, grade
// ---------------------------------------------------------------------------

/**
 * Pure scoring engine — no DOM, no side effects, no async.
 * Receives question definitions and user answers, returns a complete result.
 */
class QuizScorer {
  /** @type {number} */ #passMark;
  /** @type {number} */ #timeBonusMax;
  /** @type {number} */ #perfectBonus;

  /**
   * @param {{
   *   passMark?:     number,
   *   timeBonusMax?: number,
   *   perfectBonus?: number,
   * }} [options]
   */
  constructor({ passMark, timeBonusMax, perfectBonus } = {}) {
    this.#passMark     = passMark     ?? QUIZ_DEFAULTS.PASS_MARK;
    this.#timeBonusMax = timeBonusMax ?? QUIZ_DEFAULTS.TIME_BONUS_MAX;
    this.#perfectBonus = perfectBonus ?? QUIZ_DEFAULTS.PERFECT_BONUS;
  }

  /**
   * Calculate the full result for a completed quiz session.
   *
   * @param {{
   *   questions:     QuizQuestion[],
   *   answers:       Record<string, UserAnswer>,
   *   elapsedSecs:   number,
   *   timeLimitSecs: number | null,
   *   baseXp?:       number,
   * }} params
   *
   * @returns {{
   *   score:       number,    — correct point count
   *   maxScore:    number,    — total possible points
   *   pct:         number,    — 0–100
   *   passed:      boolean,
   *   grade:       { label: string, cssClass: string },
   *   xpEarned:    number,
   *   timeBonus:   number,
   *   isPerfect:   boolean,
   *   perQuestion: QuestionResult[],
   * }}
   */
  score({ questions, answers, elapsedSecs, timeLimitSecs, baseXp = 30 }) {
    const perQuestion = questions.map((q) => {
      const answer  = answers[q.id];
      const points  = q.points ?? 1;
      const correct = this.#isCorrect(q, answer);
      return {
        questionId: q.id,
        correct,
        points:     correct ? points : 0,
        maxPoints:  points,
        userAnswer: answer ?? null,
      };
    });

    const score    = perQuestion.reduce((sum, r) => sum + r.points, 0);
    const maxScore = perQuestion.reduce((sum, r) => sum + r.maxPoints, 0);
    const pct      = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const passed   = pct >= this.#passMark;
    const grade    = getGrade(pct);
    const isPerfect = score === maxScore && maxScore > 0;

    // XP calculation
    let xpEarned = baseXp;
    if (passed)    xpEarned += 30;
    if (isPerfect) xpEarned += this.#perfectBonus;

    // Time bonus: proportional to time remaining when timed
    let timeBonus = 0;
    if (timeLimitSecs && timeLimitSecs > 0 && passed) {
      const remainingSecs = Math.max(0, timeLimitSecs - elapsedSecs);
      const ratio = remainingSecs / timeLimitSecs;
      timeBonus = Math.round(this.#timeBonusMax * ratio);
      xpEarned += timeBonus;
    }

    return { score, maxScore, pct, passed, grade, xpEarned, timeBonus, isPerfect, perQuestion };
  }

  /**
   * Determine whether a single question was answered correctly.
   *
   * @param {QuizQuestion} question
   * @param {UserAnswer|undefined} answer
   * @returns {boolean}
   */
  #isCorrect(question, answer) {
    if (answer === undefined || answer === null) return false;

    switch (question.type) {
      case 'multiple-choice': {
        const correctIdx = Array.isArray(question.correct)
          ? question.correct[0]
          : question.correct;
        return answer.selectedIndex === correctIdx;
      }

      case 'multiple-select': {
        if (!Array.isArray(answer.selectedIndices) || !Array.isArray(question.correct)) {
          return false;
        }
        const required = [...question.correct].sort((a, b) => a - b);
        const given    = [...answer.selectedIndices].sort((a, b) => a - b);
        return JSON.stringify(required) === JSON.stringify(given);
      }

      case 'fill-in-the-blank': {
        if (typeof answer.text !== 'string') return false;
        const normUser = normaliseFitb(answer.text);
        const accepted = Array.isArray(question.correct)
          ? question.correct
          : [question.correct];
        return accepted.some((a) => normaliseFitb(String(a)) === normUser);
      }

      default:
        return false;
    }
  }
}

// ---------------------------------------------------------------------------
// QuizEngine — primary class
// ---------------------------------------------------------------------------

/**
 * Full-featured quiz session manager.
 *
 * Lifecycle:
 *   1. new QuizEngine(config)  — no DOM side-effects
 *   2. .load(quizData)         — validates data, builds question order
 *   3. .start()                — mounts UI, starts timer, optionally resumes
 *   4. [user interacts]        — answer, navigate, bookmark, flag, pause
 *   5. .submit()               — scores, records with ProgressTracker, shows results
 *   6. .review()               — enters review mode
 *   7. .reset()                — clears and returns to idle
 *   8. .destroy()              — tears down all listeners, timers, DOM
 */
export class QuizEngine {

  // ---- Configuration (immutable after construction) -----------------------

  /**
   * @type {{
   *   containerId:    string,
   *   tracker:        ProgressTracker | null,
   *   passMark:       number,
   *   randomize:      boolean,
   *   timeLimit:      number | null,
   *   timeBonusMax:   number,
   *   perfectBonus:   number,
   *   showHints:      boolean,
   *   showProgress:   boolean,
   * }}
   */
  #config;

  // ---- Quiz data (set by load()) ------------------------------------------

  /** @type {object|null}       */ #quizData      = null;
  /** @type {QuizQuestion[]}    */ #questions      = [];
  /** @type {string[]}          */ #questionOrder  = [];

  // ---- Session state -------------------------------------------------------

  /** @type {string}                       */ #status      = QUIZ_STATUS.IDLE;
  /** @type {number}                       */ #currentIdx  = 0;
  /** @type {Record<string, UserAnswer>}   */ #answers     = {};
  /** @type {Set<string>}                  */ #bookmarks   = new Set();
  /** @type {Set<string>}                  */ #flags       = new Set();
  /** @type {number}                       */ #startedAt   = 0;

  // ---- Review state --------------------------------------------------------

  /** @type {number}            */ #reviewIdx    = 0;
  /** @type {object|null}       */ #lastResult   = null;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}       */ #container  = null;
  /** @type {HTMLElement|null}       */ #liveRegion = null;

  // ---- Subordinate services ------------------------------------------------

  /** @type {QuizTimer|null}    */ #timer  = null;
  /** @type {QuizScorer}        */ #scorer;
  /** @type {QuizStore}         */ #store;

  // ---- Cleanup references --------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   containerId?:  string,        — ID of the element to render into
   *   tracker?:      ProgressTracker | null,
   *   passMark?:     number,
   *   randomize?:    boolean,
   *   timeLimit?:    number | null,
   *   timeBonusMax?: number,
   *   perfectBonus?: number,
   *   showHints?:    boolean,
   *   showProgress?: boolean,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId:  config.containerId  ?? 'quiz-container',
      tracker:      config.tracker      ?? null,
      passMark:     config.passMark     ?? QUIZ_DEFAULTS.PASS_MARK,
      randomize:    config.randomize    ?? QUIZ_DEFAULTS.RANDOMIZE,
      timeLimit:    config.timeLimit    ?? null,
      timeBonusMax: config.timeBonusMax ?? QUIZ_DEFAULTS.TIME_BONUS_MAX,
      perfectBonus: config.perfectBonus ?? QUIZ_DEFAULTS.PERFECT_BONUS,
      showHints:    config.showHints    ?? QUIZ_DEFAULTS.SHOW_HINTS,
      showProgress: config.showProgress ?? QUIZ_DEFAULTS.SHOW_PROGRESS,
    });

    this.#scorer = new QuizScorer({
      passMark:     this.#config.passMark,
      timeBonusMax: this.#config.timeBonusMax,
      perfectBonus: this.#config.perfectBonus,
    });

    this.#store = new QuizStore();
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Load and validate quiz data.
   * Must be called before start().
   *
   * @param {object} quizData — Full quiz JSON object
   * @throws {Error} If quizData is invalid
   * @returns {QuizEngine} this — for chaining
   */
  load(quizData) {
    this.#validateQuizData(quizData);
    this.#quizData = quizData;

    // Apply question randomization
    const ids = quizData.questions.map((q) => q.id);
    this.#questionOrder = (quizData.randomize ?? this.#config.randomize)
      ? shuffle(ids)
      : ids;

    // Build an indexed question map for O(1) lookup
    this.#questions = quizData.questions;

    this.#setStatus(QUIZ_STATUS.LOADING);
    return this;
  }

  /**
   * Start the quiz session.
   * If a saved session exists the user is offered the option to resume.
   * Renders the full quiz UI into the container element.
   *
   * @param {{ resume?: boolean }} [options]
   * @returns {QuizEngine} this
   */
  start({ resume = true } = {}) {
    if (!this.#quizData) throw new Error('[QuizEngine] Call load() before start().');

    this.#container = document.getElementById(this.#config.containerId);
    if (!this.#container) {
      throw new Error(`[QuizEngine] Container element #${this.#config.containerId} not found.`);
    }

    // Attempt session resume
    const saved = resume ? this.#store.load(this.#quizData.id) : null;

    if (saved) {
      this.#restoreSession(saved);
    } else {
      this.#initFreshSession();
    }

    this.#renderQuizShell();
    this.#renderQuestion(this.#currentIdx);
    this.#updateProgressBar();
    this.#updateMap();
    this.#attachGlobalKeyboardEvents();
    this.#setStatus(QUIZ_STATUS.ACTIVE);

    // Start the timer (using quiz data's timeLimit, falling back to config)
    const timeLimitSecs = this.#quizData.timeLimit ?? this.#config.timeLimit;
    if (timeLimitSecs && timeLimitSecs > 0) {
      this.#initTimer(timeLimitSecs, saved?.elapsed ?? 0);
      this.#timer.start();
    }

    this.#dispatch(QUIZ_EVENTS.STARTED, {
      quizId:    this.#quizData.id,
      total:     this.#questions.length,
      timeLimit: timeLimitSecs,
      resumed:   !!saved,
    });

    return this;
  }

  /**
   * Navigate to a question by its index in the current question order.
   *
   * @param {number} index
   */
  goTo(index) {
    if (!this.#isActive()) return;
    if (index < 0 || index >= this.#questionOrder.length) return;

    this.#currentIdx = index;
    this.#renderQuestion(index);
    this.#updateProgressBar();
    this.#updateMap();
    this.#saveSession();

    this.#dispatch(QUIZ_EVENTS.QUESTION_CHANGED, {
      quizId:     this.#quizData.id,
      index,
      total:      this.#questionOrder.length,
      questionId: this.#questionOrder[index],
    });
  }

  /**
   * Navigate to the next question.
   */
  next() {
    const nextIdx = this.#currentIdx + 1;
    if (nextIdx < this.#questionOrder.length) {
      this.goTo(nextIdx);
    } else if (this.#allAnswered()) {
      // Prompt to submit when the user tries to go past the last question
      this.#announceToScreenReader('You have reached the last question. Submit when ready.');
    }
  }

  /**
   * Navigate to the previous question.
   */
  prev() {
    if (this.#currentIdx > 0) {
      this.goTo(this.#currentIdx - 1);
    }
  }

  /**
   * Skip the current question without answering.
   * Navigation moves to the next unanswered question.
   */
  skip() {
    if (!this.#isActive()) return;

    const currentId = this.#questionOrder[this.#currentIdx];
    this.#dispatch(QUIZ_EVENTS.SKIPPED, {
      quizId:     this.#quizData.id,
      questionId: currentId,
      index:      this.#currentIdx,
    });

    // Jump to next unanswered question, or stay if none
    const nextUnanswered = this.#findNextUnanswered();
    if (nextUnanswered !== null) {
      this.goTo(nextUnanswered);
    }
  }

  /**
   * Toggle the bookmark state of the current question.
   */
  toggleBookmark() {
    if (!this.#isActive()) return;
    const id = this.#questionOrder[this.#currentIdx];
    const wasBookmarked = this.#bookmarks.has(id);

    if (wasBookmarked) {
      this.#bookmarks.delete(id);
    } else {
      this.#bookmarks.add(id);
    }

    this.#updateBookmarkButton(id);
    this.#updateMap();
    this.#saveSession();

    this.#dispatch(QUIZ_EVENTS.BOOKMARKED, {
      quizId:     this.#quizData.id,
      questionId: id,
      bookmarked: !wasBookmarked,
    });

    this.#announceToScreenReader(
      wasBookmarked ? 'Bookmark removed.' : 'Question bookmarked.'
    );
  }

  /**
   * Toggle the flag-for-review state of the current question.
   */
  toggleFlag() {
    if (!this.#isActive()) return;
    const id = this.#questionOrder[this.#currentIdx];
    const wasFlagged = this.#flags.has(id);

    if (wasFlagged) {
      this.#flags.delete(id);
    } else {
      this.#flags.add(id);
    }

    this.#updateFlagButton(id);
    this.#updateMap();
    this.#saveSession();

    this.#dispatch(QUIZ_EVENTS.FLAGGED, {
      quizId:     this.#quizData.id,
      questionId: id,
      flagged:    !wasFlagged,
    });

    this.#announceToScreenReader(
      wasFlagged ? 'Flag removed.' : 'Question flagged for review.'
    );
  }

  /**
   * Pause the quiz session (stops the timer, shows a paused overlay).
   */
  pause() {
    if (this.#status !== QUIZ_STATUS.ACTIVE) return;
    this.#timer?.pause();
    this.#setStatus(QUIZ_STATUS.PAUSED);
    this.#renderPausedScreen();
    this.#saveSession();

    this.#dispatch(QUIZ_EVENTS.PAUSED, {
      quizId:  this.#quizData.id,
      elapsed: this.#timer?.elapsed ?? 0,
    });
  }

  /**
   * Resume a paused quiz session.
   */
  resume() {
    if (this.#status !== QUIZ_STATUS.PAUSED) return;
    this.#container.querySelector(`.${CSS.PAUSED_SCREEN}`)?.remove();
    this.#timer?.start();
    this.#setStatus(QUIZ_STATUS.ACTIVE);

    this.#dispatch(QUIZ_EVENTS.RESUMED, {
      quizId:    this.#quizData.id,
      remaining: this.#timer?.remaining ?? null,
    });

    // Restore focus to the current question panel
    this.#container.querySelector(`.${CSS.QUESTION_PANEL}`)?.focus();
  }

  /**
   * Submit the quiz, calculate the result, persist via ProgressTracker,
   * and render the results screen.
   */
  submit() {
    if (this.#status === QUIZ_STATUS.SUBMITTING || this.#status === QUIZ_STATUS.COMPLETE) return;
    if (this.#status === QUIZ_STATUS.IDLE || !this.#quizData) return;

    this.#timer?.stop();
    this.#setStatus(QUIZ_STATUS.SUBMITTING);

    const elapsedSecs = this.#timer?.elapsed ?? Math.round((Date.now() - this.#startedAt) / 1000);
    const timeMs      = elapsedSecs * 1000;

    // Score the quiz
    const result = this.#scorer.score({
      questions:     this.#orderedQuestions(),
      answers:       this.#answers,
      elapsedSecs,
      timeLimitSecs: this.#quizData.timeLimit ?? this.#config.timeLimit,
    });

    this.#lastResult = { ...result, elapsedSecs, timeMs };

    // Record with ProgressTracker
    if (this.#config.tracker) {
      this.#config.tracker.recordQuizAttempt(this.#quizData.id, {
        score:   result.score,
        total:   result.maxScore,
        timeMs,
        title:   this.#quizData.title,
        answers: Object.values(this.#answers),
      });
    }

    // Clear the saved session — it's complete
    this.#store.clear(this.#quizData.id);
    this.#setStatus(QUIZ_STATUS.COMPLETE);

    this.#renderResults(result);

    this.#dispatch(QUIZ_EVENTS.SUBMITTED, {
      quizId:    this.#quizData.id,
      score:     result.score,
      total:     result.maxScore,
      pct:       result.pct,
      passed:    result.passed,
      grade:     result.grade.label,
      xp:        result.xpEarned,
      timeMs,
    });
  }

  /**
   * Enter review mode — shows all questions with correct/incorrect highlights
   * and explanations. Only available after submission.
   */
  review() {
    if (this.#status !== QUIZ_STATUS.COMPLETE) return;
    this.#reviewIdx = 0;
    this.#setStatus(QUIZ_STATUS.REVIEW);
    this.#renderReviewQuestion(this.#reviewIdx);

    this.#dispatch(QUIZ_EVENTS.REVIEW_CHANGED, {
      quizId: this.#quizData.id,
      index:  0,
      total:  this.#questionOrder.length,
    });
  }

  /**
   * Navigate to the next question in review mode.
   */
  reviewNext() {
    if (this.#status !== QUIZ_STATUS.REVIEW) return;
    const next = this.#reviewIdx + 1;
    if (next < this.#questionOrder.length) {
      this.#reviewIdx = next;
      this.#renderReviewQuestion(next);
      this.#dispatch(QUIZ_EVENTS.REVIEW_CHANGED, {
        quizId: this.#quizData.id,
        index:  next,
        total:  this.#questionOrder.length,
      });
    }
  }

  /**
   * Navigate to the previous question in review mode.
   */
  reviewPrev() {
    if (this.#status !== QUIZ_STATUS.REVIEW) return;
    const prev = this.#reviewIdx - 1;
    if (prev >= 0) {
      this.#reviewIdx = prev;
      this.#renderReviewQuestion(prev);
      this.#dispatch(QUIZ_EVENTS.REVIEW_CHANGED, {
        quizId: this.#quizData.id,
        index:  prev,
        total:  this.#questionOrder.length,
      });
    }
  }

  /**
   * Reset the quiz to its initial idle state.
   * Clears all answers, bookmarks, flags, and saved session data.
   */
  reset() {
    this.#timer?.stop();
    this.#timer = null;

    if (this.#quizData) {
      this.#store.clear(this.#quizData.id);
    }

    this.#answers    = {};
    this.#bookmarks  = new Set();
    this.#flags      = new Set();
    this.#currentIdx = 0;
    this.#reviewIdx  = 0;
    this.#lastResult = null;

    // Re-shuffle question order on reset
    if (this.#quizData) {
      const ids = this.#quizData.questions.map((q) => q.id);
      this.#questionOrder = (this.#quizData.randomize ?? this.#config.randomize)
        ? shuffle(ids)
        : ids;
    }

    if (this.#container) {
      this.#container.innerHTML = '';
      this.#container.className = '';
    }

    this.#setStatus(QUIZ_STATUS.IDLE);

    if (this.#quizData) {
      this.#dispatch(QUIZ_EVENTS.RESET, { quizId: this.#quizData.id });
    }
  }

  /**
   * Tear down all event listeners, timers, and DOM.
   * Required for clean SPA unmounting.
   */
  destroy() {
    this.#timer?.stop();
    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    if (this.#container) {
      this.#container.innerHTML = '';
    }
  }

  // ---- Public read accessors -----------------------------------------------

  /** @returns {string}  Current session status */
  get status() { return this.#status; }

  /** @returns {number}  Index of the currently displayed question */
  get currentIndex() { return this.#currentIdx; }

  /** @returns {number}  Total number of questions */
  get totalQuestions() { return this.#questionOrder.length; }

  /** @returns {boolean} True if all questions have been answered */
  get isComplete() { return this.#allAnswered(); }

  /** @returns {object|null} Last computed result (after submit()) */
  get lastResult() { return this.#lastResult ? { ...this.#lastResult } : null; }

  // ---- Private: session initialisation ------------------------------------

  /**
   * Initialise a brand-new quiz session with empty state.
   */
  #initFreshSession() {
    this.#answers    = {};
    this.#bookmarks  = new Set();
    this.#flags      = new Set();
    this.#currentIdx = 0;
    this.#startedAt  = Date.now();
  }

  /**
   * Restore a previously saved session from storage.
   *
   * @param {object} saved — Parsed storage payload from QuizStore.load()
   */
  #restoreSession(saved) {
    this.#answers   = saved.answers       ?? {};
    this.#bookmarks = new Set(saved.bookmarks ?? []);
    this.#flags     = new Set(saved.flags     ?? []);
    this.#currentIdx = saved.currentIdx   ?? 0;
    this.#startedAt  = saved.startedAt    ?? Date.now();

    // Restore question order from saved session to keep the same shuffle
    if (Array.isArray(saved.questionOrder) && saved.questionOrder.length > 0) {
      this.#questionOrder = saved.questionOrder;
    }
  }

  /**
   * Create and configure a QuizTimer for the current session.
   *
   * @param {number} totalSecs
   * @param {number} [elapsedSecs=0] — Seconds already elapsed (resume case)
   */
  #initTimer(totalSecs, elapsedSecs = 0) {
    this.#timer = new QuizTimer({
      totalSecs,
      warnSecs: QUIZ_DEFAULTS.TIMER_WARNING_SECS,
      onTick:    (remaining, elapsed, total) => {
        this.#updateTimerDisplay(remaining, total);
        this.#dispatch(QUIZ_EVENTS.TIMER_TICK, {
          quizId:    this.#quizData.id,
          remaining,
          elapsed,
          total,
        });
      },
      onWarning: (remaining) => {
        this.#container?.querySelector(`.${CSS.TIMER}`)
          ?.classList.add(CSS.TIMER_WARNING);
        this.#announceToScreenReader(
          `Time warning: ${formatTime(remaining)} remaining.`
        );
        this.#dispatch(QUIZ_EVENTS.TIMER_WARNING, {
          quizId: this.#quizData.id,
          remaining,
        });
      },
      onExpire: () => {
        this.#container?.querySelector(`.${CSS.TIMER}`)
          ?.classList.add(CSS.TIMER_CRITICAL);
        this.#announceToScreenReader('Time has expired. Submitting your quiz.');
        this.#dispatch(QUIZ_EVENTS.TIMER_EXPIRED, { quizId: this.#quizData.id });
        this.submit();
      },
    });

    // Restore elapsed time for resumed sessions
    if (elapsedSecs > 0) {
      this.#timer.restore(totalSecs - elapsedSecs);
    }
  }

  // ---- Private: input recording -------------------------------------------

  /**
   * Record the user's answer for the currently displayed question.
   * Handles all three question types.
   *
   * @param {string}   questionId
   * @param {UserAnswer} answer
   */
  #recordAnswer(questionId, answer) {
    this.#answers[questionId] = answer;
    this.#saveSession();

    const bookmarked = this.#bookmarks.has(questionId);
    const flagged    = this.#flags.has(questionId);

    this.#dispatch(QUIZ_EVENTS.ANSWERED, {
      quizId:     this.#quizData.id,
      questionId,
      answer,
      bookmarked,
      flagged,
    });

    // Refresh map to show answered state
    this.#updateMap();
  }

  // ---- Private: rendering -------------------------------------------------

  /**
   * Render the outer quiz shell (header, progress bar, question area,
   * controls, and question map). Called once on start().
   */
  #renderQuizShell() {
    const timeLimitSecs = this.#quizData.timeLimit ?? this.#config.timeLimit;
    const hasTimer      = Boolean(timeLimitSecs);

    this.#container.className = CSS.ROOT;
    this.#container.setAttribute('role', 'main');
    this.#container.setAttribute('aria-label', escapeAttr(this.#quizData.title));

    this.#container.innerHTML = `
      <!-- Screen reader live region — never hidden -->
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text">
      </div>

      <!-- Header: title + timer -->
      <div class="${CSS.HEADER}">
        <h1 class="${CSS.TITLE}">${escapeHtml(this.#quizData.title)}</h1>
        ${hasTimer ? `
          <div class="${CSS.TIMER}"
               id="quiz-timer"
               role="timer"
               aria-live="off"
               aria-label="Time remaining">
            <span class="${CSS.TIMER_ICON}" aria-hidden="true">${icon('clock', 16)}</span>
            <span class="${CSS.TIMER_DISPLAY}" id="quiz-timer-display">
              ${formatTime(timeLimitSecs)}
            </span>
          </div>
        ` : ''}
      </div>

      <!-- Progress bar -->
      ${this.#config.showProgress ? `
        <div class="${CSS.PROGRESS_BAR}"
             role="progressbar"
             aria-valuemin="0"
             aria-valuemax="${this.#questionOrder.length}"
             aria-valuenow="0"
             aria-label="Quiz progress">
          <div class="${CSS.PROGRESS_FILL}" id="quiz-progress-fill" style="width:0%"></div>
        </div>
        <p class="${CSS.PROGRESS_LABEL}" id="quiz-progress-label" aria-live="polite">
          Question 1 of ${this.#questionOrder.length}
        </p>
      ` : ''}

      <!-- Question panel — populated by #renderQuestion() -->
      <section class="${CSS.QUESTION_PANEL}"
               id="quiz-question-panel"
               aria-labelledby="quiz-question-text"
               tabindex="-1">
      </section>

      <!-- Navigation controls -->
      <div class="${CSS.CONTROLS}">
        <button class="${CSS.BTN_PREV}"
                id="quiz-btn-prev"
                type="button"
                aria-label="Previous question">
          ${icon('chevronLeft', 16)}
          <span>Previous</span>
        </button>

        <div class="quiz__controls-center">
          <button class="${CSS.BTN_SKIP}"
                  id="quiz-btn-skip"
                  type="button"
                  aria-label="Skip this question">
            <span>Skip</span>
          </button>

          ${hasTimer ? `
            <button class="${CSS.BTN_PAUSE}"
                    id="quiz-btn-pause"
                    type="button"
                    aria-label="Pause quiz">
              ${icon('pause', 16)}
              <span>Pause</span>
            </button>
          ` : ''}
        </div>

        <button class="${CSS.BTN_NEXT}"
                id="quiz-btn-next"
                type="button"
                aria-label="Next question">
          <span>Next</span>
          ${icon('chevronRight', 16)}
        </button>

        <button class="${CSS.BTN_SUBMIT}"
                id="quiz-btn-submit"
                type="button"
                aria-label="Submit quiz">
          ${icon('check', 16)}
          <span>Submit Quiz</span>
        </button>
      </div>

      <!-- Question map (thumbnail nav grid) -->
      <div class="${CSS.MAP}" id="quiz-map" aria-labelledby="quiz-map-heading">
        <h2 class="${CSS.MAP_HEADING}" id="quiz-map-heading">
          Question overview
        </h2>
        <div class="${CSS.MAP_GRID}" id="quiz-map-grid" role="list">
        </div>
      </div>
    `;

    // Cache live region reference
    this.#liveRegion = this.#container.querySelector(`.${CSS.LIVE}`);

    // Attach control button events
    this.#attachControlEvents();
  }

  /**
   * Render a specific question by its position in the question order.
   * Replaces the content of the question panel only — the shell is not re-rendered.
   *
   * @param {number} index
   */
  #renderQuestion(index) {
    const panel      = this.#container?.querySelector(`#quiz-question-panel`);
    if (!panel) return;

    const questionId = this.#questionOrder[index];
    const question   = this.#questions.find((q) => q.id === questionId);
    if (!question) return;

    const isBookmarked = this.#bookmarks.has(questionId);
    const isFlagged    = this.#flags.has(questionId);
    const userAnswer   = this.#answers[questionId] ?? null;

    const typeLabel = {
      'multiple-choice':   'Single choice',
      'multiple-select':   'Select all that apply',
      'fill-in-the-blank': 'Fill in the blank',
    }[question.type] ?? question.type;

    panel.innerHTML = `
      <!-- Question metadata row -->
      <div class="${CSS.QUESTION_META}">
        <span class="${CSS.QUESTION_NUMBER}">
          Question ${index + 1} of ${this.#questionOrder.length}
        </span>
        <span class="${CSS.QUESTION_TYPE}">${escapeHtml(typeLabel)}</span>
        <div class="${CSS.QUESTION_ACTIONS}">
          <button class="${CSS.BOOKMARK_BTN} ${isBookmarked ? CSS.BOOKMARK_ACTIVE : ''}"
                  id="quiz-bookmark-btn"
                  type="button"
                  aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark this question'}"
                  aria-pressed="${isBookmarked}">
            ${icon(isBookmarked ? 'bookmarkFilled' : 'bookmark', 18)}
            <span class="sr-only">${isBookmarked ? 'Bookmarked' : 'Bookmark'}</span>
          </button>
          <button class="${CSS.FLAG_BTN} ${isFlagged ? CSS.FLAG_ACTIVE : ''}"
                  id="quiz-flag-btn"
                  type="button"
                  aria-label="${isFlagged ? 'Remove flag' : 'Flag for review'}"
                  aria-pressed="${isFlagged}">
            ${icon(isFlagged ? 'flagFilled' : 'flag', 18)}
            <span class="sr-only">${isFlagged ? 'Flagged' : 'Flag'}</span>
          </button>
        </div>
      </div>

      <!-- Question text -->
      <div class="${CSS.QUESTION_TEXT}" id="quiz-question-text">
        ${escapeHtml(question.text)}
      </div>

      <!-- Optional code block -->
      ${question.code ? `
        <pre class="${CSS.QUESTION_CODE}" tabindex="0"
             aria-label="Code example for this question"><code>${escapeHtml(question.code)}</code></pre>
      ` : ''}

      <!-- Answer area — type-specific -->
      ${this.#renderAnswerArea(question, userAnswer)}

      <!-- Hint (if available and enabled) -->
      ${this.#config.showHints && question.hint ? `
        <div class="${CSS.HINT_WRAPPER}" id="quiz-hint-wrapper">
          <button class="${CSS.HINT_BTN}"
                  id="quiz-hint-btn"
                  type="button"
                  aria-expanded="false"
                  aria-controls="quiz-hint-text">
            ${icon('hint', 16)}
            <span>Show hint</span>
          </button>
          <p class="${CSS.HINT_TEXT}"
             id="quiz-hint-text"
             hidden
             role="note">
            ${escapeHtml(question.hint)}
          </p>
        </div>
      ` : ''}
    `;

    // Attach question-level events
    this.#attachQuestionEvents(panel, question, questionId);

    // Update navigation button states
    this.#updateNavButtons();

    // Move focus to the panel (not an option) for keyboard users
    // Use requestAnimationFrame so the element is painted before focus
    requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  }

  /**
   * Render the answer input area appropriate for the question type.
   *
   * @param {QuizQuestion} question
   * @param {UserAnswer|null} userAnswer — Existing answer (for pre-selection)
   * @returns {string} HTML string
   */
  #renderAnswerArea(question, userAnswer) {
    switch (question.type) {
      case 'multiple-choice':
        return this.#renderMultipleChoice(question, userAnswer, false);

      case 'multiple-select':
        return this.#renderMultipleChoice(question, userAnswer, true);

      case 'fill-in-the-blank':
        return this.#renderFillInTheBlank(question, userAnswer);

      default:
        return `<p class="quiz__error">Unsupported question type: ${escapeHtml(question.type)}</p>`;
    }
  }

  /**
   * Render radio buttons (single) or checkboxes (multiple-select).
   *
   * @param {QuizQuestion} question
   * @param {UserAnswer|null} userAnswer
   * @param {boolean} isMultiple
   * @returns {string}
   */
  #renderMultipleChoice(question, userAnswer, isMultiple) {
    const inputType = isMultiple ? 'checkbox' : 'radio';
    const name      = `quiz-q-${question.id}`;
    const groupId   = `quiz-options-${question.id}`;

    const items = question.options.map((optText, idx) => {
      const inputId  = `quiz-opt-${question.id}-${idx}`;
      const checked  = isMultiple
        ? (userAnswer?.selectedIndices?.includes(idx) ?? false)
        : (userAnswer?.selectedIndex === idx);

      return `
        <li class="${CSS.OPTION} ${checked ? CSS.OPTION_SELECTED : ''}"
            role="none">
          <input
            class="${CSS.OPTION_INPUT}"
            type="${inputType}"
            id="${escapeAttr(inputId)}"
            name="${escapeAttr(name)}"
            value="${idx}"
            ${checked ? 'checked' : ''}
            aria-describedby="${escapeAttr(groupId)}"
          />
          <label class="${CSS.OPTION_LABEL}"
                 for="${escapeAttr(inputId)}">
            <span class="quiz__option-marker" aria-hidden="true">
              ${String.fromCharCode(65 + idx)}
            </span>
            ${escapeHtml(optText)}
          </label>
        </li>
      `;
    }).join('');

    const roleGroup    = isMultiple ? 'group' : 'radiogroup';
    const ariaRequired = 'true';

    return `
      <fieldset class="${CSS.OPTIONS}"
                id="${escapeAttr(groupId)}"
                role="${roleGroup}"
                aria-required="${ariaRequired}"
                aria-label="${isMultiple ? 'Select all correct answers' : 'Select one answer'}">
        <legend class="sr-only">
          ${isMultiple ? 'Select all correct answers' : 'Select one answer'}
        </legend>
        <ol role="list" style="list-style:none;padding:0;margin:0">
          ${items}
        </ol>
      </fieldset>
    `;
  }

  /**
   * Render the fill-in-the-blank text input.
   *
   * @param {QuizQuestion} question
   * @param {UserAnswer|null} userAnswer
   * @returns {string}
   */
  #renderFillInTheBlank(question, userAnswer) {
    const inputId    = `quiz-fitb-${question.id}`;
    const savedValue = userAnswer?.text ?? '';

    return `
      <div class="${CSS.FITB_WRAPPER}">
        <label for="${escapeAttr(inputId)}" class="sr-only">
          Your answer
        </label>
        <input
          class="${CSS.FITB_INPUT}"
          id="${escapeAttr(inputId)}"
          type="text"
          name="${escapeAttr(inputId)}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Type your answer…"
          value="${escapeAttr(savedValue)}"
          aria-label="Your answer"
          aria-required="true"
        />
      </div>
    `;
  }

  /**
   * Render a review-mode question with all answers highlighted.
   *
   * @param {number} index
   */
  #renderReviewQuestion(index) {
    const panel      = this.#container?.querySelector(`#quiz-question-panel`);
    if (!panel) {
      // If the panel is gone (e.g. user navigated away) rebuild the shell first
      this.#renderQuizShell();
    }

    const questionId = this.#questionOrder[index];
    const question   = this.#questions.find((q) => q.id === questionId);
    const result     = this.#lastResult?.perQuestion?.find((r) => r.questionId === questionId);
    const userAnswer = this.#answers[questionId] ?? null;

    const reviewPanel = this.#container?.querySelector(`#quiz-question-panel`);
    if (!reviewPanel || !question) return;

    this.#container.classList.add(CSS.ROOT_REVIEW);

    const typeLabel = {
      'multiple-choice':   'Single choice',
      'multiple-select':   'Select all that apply',
      'fill-in-the-blank': 'Fill in the blank',
    }[question.type] ?? question.type;

    reviewPanel.innerHTML = `
      <div class="${CSS.QUESTION_META}">
        <span class="${CSS.QUESTION_NUMBER}">
          Review: ${index + 1} of ${this.#questionOrder.length}
        </span>
        <span class="${CSS.QUESTION_TYPE}">${escapeHtml(typeLabel)}</span>
        <span class="quiz__result-badge ${result?.correct ? 'quiz__result-badge--correct' : 'quiz__result-badge--incorrect'}"
              aria-label="${result?.correct ? 'Correct' : 'Incorrect'}">
          ${result?.correct ? icon('check', 16) : icon('close', 16)}
          <span>${result?.correct ? 'Correct' : 'Incorrect'}</span>
        </span>
      </div>

      <div class="${CSS.QUESTION_TEXT}" id="quiz-question-text">
        ${escapeHtml(question.text)}
      </div>

      ${question.code ? `
        <pre class="${CSS.QUESTION_CODE}" tabindex="0"
             aria-label="Code example"><code>${escapeHtml(question.code)}</code></pre>
      ` : ''}

      ${this.#renderReviewAnswerArea(question, userAnswer, result)}

      <div class="${CSS.EXPLANATION} ${CSS.EXPLANATION_VISIBLE}">
        ${result?.correct ? '' : `
          <div class="${CSS.CORRECT_ANSWER}">
            <span class="${CSS.EXPLANATION_LABEL}">Correct answer:</span>
            <span>${escapeHtml(this.#formatCorrectAnswer(question))}</span>
          </div>
        `}
        <div class="${CSS.EXPLANATION_TEXT}">
          <span class="${CSS.EXPLANATION_LABEL}">Explanation:</span>
          <p>${escapeHtml(question.explanation)}</p>
        </div>
      </div>
    `;

    // Update navigation controls for review mode
    this.#updateReviewNavButtons(index);

    requestAnimationFrame(() => reviewPanel.focus({ preventScroll: true }));
  }

  /**
   * Render answer area in review mode with correct/incorrect highlighting.
   *
   * @param {QuizQuestion} question
   * @param {UserAnswer|null} userAnswer
   * @param {QuestionResult|null} result
   * @returns {string}
   */
  #renderReviewAnswerArea(question, userAnswer, result) {
    switch (question.type) {
      case 'multiple-choice':
      case 'multiple-select': {
        const isMultiple = question.type === 'multiple-select';
        const correctSet = new Set(
          Array.isArray(question.correct) ? question.correct : [question.correct]
        );
        const selectedSet = new Set(
          isMultiple
            ? (userAnswer?.selectedIndices ?? [])
            : (userAnswer?.selectedIndex !== undefined ? [userAnswer.selectedIndex] : [])
        );

        const items = question.options.map((optText, idx) => {
          const isCorrect  = correctSet.has(idx);
          const isSelected = selectedSet.has(idx);
          const isMissed   = isCorrect && !isSelected;

          let stateClass = '';
          if (isSelected && isCorrect)  stateClass = CSS.OPTION_CORRECT;
          if (isSelected && !isCorrect) stateClass = CSS.OPTION_INCORRECT;
          if (isMissed)                 stateClass = CSS.OPTION_MISSED;

          const ariaLabel = [
            isSelected ? 'Your answer. ' : '',
            isCorrect  ? 'Correct. ' : '',
            (!isCorrect && isSelected) ? 'Incorrect. ' : '',
            isMissed   ? 'Correct answer — not selected. ' : '',
          ].join('');

          return `
            <li class="${CSS.OPTION} ${stateClass}"
                role="none"
                aria-label="${escapeAttr(ariaLabel + optText)}">
              <span class="quiz__option-marker" aria-hidden="true">
                ${String.fromCharCode(65 + idx)}
              </span>
              <span class="${CSS.OPTION_LABEL}">${escapeHtml(optText)}</span>
              ${isCorrect ? `<span class="quiz__option-indicator" aria-hidden="true">${icon('check', 14)}</span>` : ''}
              ${isSelected && !isCorrect ? `<span class="quiz__option-indicator" aria-hidden="true">${icon('close', 14)}</span>` : ''}
            </li>
          `;
        }).join('');

        return `
          <ol class="${CSS.OPTIONS}"
              role="list"
              style="list-style:none;padding:0;margin:0"
              aria-label="Answer choices">
            ${items}
          </ol>
        `;
      }

      case 'fill-in-the-blank': {
        const userText = userAnswer?.text ?? '';
        const stateClass = result?.correct ? CSS.FITB_CORRECT : CSS.FITB_INCORRECT;
        return `
          <div class="${CSS.FITB_WRAPPER}">
            <input
              class="${CSS.FITB_INPUT} ${stateClass}"
              type="text"
              value="${escapeAttr(userText)}"
              readonly
              aria-label="Your answer: ${escapeAttr(userText || 'No answer given')}"
              aria-invalid="${result?.correct ? 'false' : 'true'}"
            />
          </div>
        `;
      }

      default:
        return '';
    }
  }

  /**
   * Render the results/score screen after submission.
   *
   * @param {object} result — From QuizScorer.score()
   */
  #renderResults(result) {
    const panel = this.#container?.querySelector(`#quiz-question-panel`);
    if (panel) panel.innerHTML = '';

    const map = this.#container?.querySelector(`#quiz-map`);
    if (map) map.hidden = true;

    const controls = this.#container?.querySelector(`.${CSS.CONTROLS}`);
    if (controls) controls.hidden = true;

    this.#container.classList.add(CSS.ROOT_COMPLETE);

    const resultEl = document.createElement('section');
    resultEl.className = CSS.RESULTS;
    resultEl.setAttribute('aria-label', 'Quiz results');
    resultEl.setAttribute('tabindex', '-1');

    const passEmoji  = result.passed ? '🎉' : '💪';
    const passText   = result.passed ? 'Passed!' : 'Not Passed';

    resultEl.innerHTML = `
      <div class="${CSS.RESULTS_ICON}" aria-hidden="true">${passEmoji}</div>

      <h2 class="${CSS.RESULTS_TITLE}" id="quiz-results-heading">
        ${escapeHtml(passText)}
      </h2>

      <div class="${CSS.RESULTS_GRADE} ${result.grade.cssClass}"
           aria-label="Grade: ${escapeAttr(result.grade.label)}">
        ${escapeHtml(result.grade.label)}
      </div>

      <div class="${CSS.RESULTS_SCORE}"
           aria-label="${result.score} out of ${result.maxScore} correct, ${result.pct} percent">
        <span class="${CSS.RESULTS_SCORE}__fraction">${result.score} / ${result.maxScore}</span>
        <span class="${CSS.RESULTS_SCORE}__pct">${result.pct}%</span>
      </div>

      <div class="${CSS.RESULTS_DETAIL}" role="list" aria-label="Result details">
        <div class="${CSS.RESULTS_STAT}" role="listitem">
          <span class="${CSS.RESULTS_STAT_VALUE}">${result.score}</span>
          <span class="${CSS.RESULTS_STAT_LABEL}">Correct</span>
        </div>
        <div class="${CSS.RESULTS_STAT}" role="listitem">
          <span class="${CSS.RESULTS_STAT_VALUE}">${result.maxScore - result.score}</span>
          <span class="${CSS.RESULTS_STAT_LABEL}">Incorrect</span>
        </div>
        <div class="${CSS.RESULTS_STAT}" role="listitem">
          <span class="${CSS.RESULTS_STAT_VALUE}">${formatTime(this.#lastResult?.elapsedSecs ?? 0)}</span>
          <span class="${CSS.RESULTS_STAT_LABEL}">Time taken</span>
        </div>
        <div class="${CSS.RESULTS_STAT}" role="listitem">
          <span class="${CSS.RESULTS_STAT_VALUE}">${this.#config.passMark}%</span>
          <span class="${CSS.RESULTS_STAT_LABEL}">Pass mark</span>
        </div>
      </div>

      <div class="${CSS.RESULTS_XP}"
           aria-label="${result.xpEarned} XP earned">
        ${icon('xp', 18)}
        <span class="quiz__xp-amount">+${result.xpEarned} XP</span>
        ${result.timeBonus > 0 ? `
          <span class="quiz__xp-bonus"
                aria-label="includes ${result.timeBonus} time bonus XP">
            (includes +${result.timeBonus} time bonus)
          </span>
        ` : ''}
        ${result.isPerfect ? `
          <span class="quiz__xp-badge" aria-label="Perfect score!">
            ${icon('star', 14)} Perfect!
          </span>
        ` : ''}
      </div>

      <div class="${CSS.RESULTS_ACTIONS}">
        <button class="${CSS.BTN_REVIEW}"
                id="quiz-btn-review"
                type="button"
                aria-label="Review your answers">
          Review Answers
        </button>
        <button class="${CSS.BTN_RETAKE}"
                id="quiz-btn-retake"
                type="button"
                aria-label="Retake this quiz">
          Retake Quiz
        </button>
        <button class="${CSS.BTN_CONTINUE}"
                id="quiz-btn-continue"
                type="button"
                aria-label="Continue to the next lesson">
          ${icon('chevronRight', 16)}
          <span>Continue</span>
        </button>
      </div>
    `;

    this.#container.insertBefore(resultEl, this.#container.querySelector(`.${CSS.CONTROLS}`));

    // Attach results button events
    this.#attachResultsEvents(resultEl);

    // Announce to screen readers
    this.#announceToScreenReader(
      `Quiz complete. You scored ${result.score} out of ${result.maxScore}, ` +
      `${result.pct} percent. ${result.passed ? 'Passed.' : 'Not passed.'} ` +
      `You earned ${result.xpEarned} XP.`
    );

    // Move focus to the results section
    requestAnimationFrame(() => resultEl.focus({ preventScroll: true }));
  }

  /**
   * Render the paused-state overlay screen.
   */
  #renderPausedScreen() {
    const existing = this.#container?.querySelector(`.${CSS.PAUSED_SCREEN}`);
    if (existing) return;

    const paused = document.createElement('div');
    paused.className = CSS.PAUSED_SCREEN;
    paused.setAttribute('role', 'dialog');
    paused.setAttribute('aria-modal', 'true');
    paused.setAttribute('aria-labelledby', 'quiz-paused-title');
    paused.setAttribute('tabindex', '-1');

    paused.innerHTML = `
      <h2 class="${CSS.PAUSED_TITLE}" id="quiz-paused-title">Quiz Paused</h2>
      <p>Your progress has been saved.</p>
      <div class="${CSS.PAUSED_ACTIONS}">
        <button class="${CSS.BTN_RESUME}"
                id="quiz-btn-resume"
                type="button"
                aria-label="Resume quiz">
          ${icon('play', 16)}
          <span>Resume</span>
        </button>
      </div>
    `;

    this.#container.appendChild(paused);
    this.#container.classList.add(CSS.ROOT_PAUSED);

    const resumeBtn = paused.querySelector(`#quiz-btn-resume`);
    const onResume  = () => this.resume();
    resumeBtn?.addEventListener('click', onResume);
    this.#cleanupFns.push(() => resumeBtn?.removeEventListener('click', onResume));

    // Focus the paused screen so keyboard users can resume
    requestAnimationFrame(() => paused.focus({ preventScroll: true }));
  }

  // ---- Private: DOM updates -----------------------------------------------

  /**
   * Update the timer display element with the formatted remaining time.
   *
   * @param {number} remaining
   * @param {number} total
   */
  #updateTimerDisplay(remaining, total) {
    const display = this.#container?.querySelector(`#quiz-timer-display`);
    if (!display) return;

    display.textContent = formatTime(remaining);

    // Update aria-label on the timer container
    const timerEl = this.#container?.querySelector(`#quiz-timer`);
    if (timerEl) {
      timerEl.setAttribute('aria-label', `${formatTime(remaining)} remaining`);
    }

    // Add critical class at < 30 seconds
    const timerContainer = this.#container?.querySelector(`.${CSS.TIMER}`);
    if (timerContainer && remaining <= 30 && remaining > 0) {
      timerContainer.classList.add(CSS.TIMER_CRITICAL);
      timerContainer.classList.remove(CSS.TIMER_WARNING);
    }
  }

  /**
   * Update the progress bar and label to reflect the current answered count.
   */
  #updateProgressBar() {
    const total     = this.#questionOrder.length;
    const answered  = Object.keys(this.#answers).length;
    const fill      = this.#container?.querySelector(`#quiz-progress-fill`);
    const bar       = this.#container?.querySelector(`.${CSS.PROGRESS_BAR}`);
    const label     = this.#container?.querySelector(`#quiz-progress-label`);

    if (fill) {
      const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
      fill.style.width = `${pct}%`;
    }

    if (bar) {
      bar.setAttribute('aria-valuenow', String(answered));
      bar.setAttribute('aria-label', `${answered} of ${total} questions answered`);
    }

    if (label) {
      label.textContent = `Question ${this.#currentIdx + 1} of ${total}`;
    }
  }

  /**
   * Rebuild the question map grid to show answered/flagged/bookmarked state.
   */
  #updateMap() {
    const grid = this.#container?.querySelector(`#quiz-map-grid`);
    if (!grid) return;

    grid.innerHTML = this.#questionOrder.map((qId, idx) => {
      const isAnswered   = this.#answers[qId] !== undefined;
      const isFlagged    = this.#flags.has(qId);
      const isBookmarked = this.#bookmarks.has(qId);
      const isCurrent    = idx === this.#currentIdx;

      const classes = [
        CSS.MAP_BTN,
        isAnswered   ? CSS.MAP_BTN_ANSWERED   : '',
        isFlagged    ? CSS.MAP_BTN_FLAGGED    : '',
        isBookmarked ? CSS.MAP_BTN_BOOKMARKED : '',
        isCurrent    ? CSS.MAP_BTN_CURRENT    : '',
      ].filter(Boolean).join(' ');

      const stateLabel = [
        isAnswered   ? 'answered' : 'unanswered',
        isFlagged    ? ', flagged'    : '',
        isBookmarked ? ', bookmarked' : '',
        isCurrent    ? ', current'   : '',
      ].join('');

      return `
        <button class="${classes}"
                type="button"
                role="listitem"
                data-quiz-map-idx="${idx}"
                aria-label="Go to question ${idx + 1}, ${stateLabel}"
                aria-current="${isCurrent ? 'step' : 'false'}">
          ${idx + 1}
        </button>
      `;
    }).join('');

    // Attach map button events
    const mapBtns = grid.querySelectorAll(`.${CSS.MAP_BTN}`);
    mapBtns.forEach((btn) => {
      const onClick = () => {
        const idx = Number(btn.dataset.quizMapIdx);
        this.goTo(idx);
      };
      btn.addEventListener('click', onClick);
      this.#cleanupFns.push(() => btn.removeEventListener('click', onClick));
    });
  }

  /**
   * Update the bookmark button's visual state for the given question ID.
   *
   * @param {string} questionId
   */
  #updateBookmarkButton(questionId) {
    const btn = this.#container?.querySelector(`#quiz-bookmark-btn`);
    if (!btn) return;

    const isBookmarked = this.#bookmarks.has(questionId);
    btn.classList.toggle(CSS.BOOKMARK_ACTIVE, isBookmarked);
    btn.setAttribute('aria-pressed', String(isBookmarked));
    btn.setAttribute('aria-label', isBookmarked ? 'Remove bookmark' : 'Bookmark this question');
    btn.querySelector('svg')?.replaceWith(
      (() => {
        const span = document.createElement('span');
        span.innerHTML = icon(isBookmarked ? 'bookmarkFilled' : 'bookmark', 18);
        return span.firstElementChild;
      })()
    );
  }

  /**
   * Update the flag button's visual state for the given question ID.
   *
   * @param {string} questionId
   */
  #updateFlagButton(questionId) {
    const btn = this.#container?.querySelector(`#quiz-flag-btn`);
    if (!btn) return;

    const isFlagged = this.#flags.has(questionId);
    btn.classList.toggle(CSS.FLAG_ACTIVE, isFlagged);
    btn.setAttribute('aria-pressed', String(isFlagged));
    btn.setAttribute('aria-label', isFlagged ? 'Remove flag' : 'Flag for review');
  }

  /**
   * Update the Previous / Next / Submit button disabled states
   * based on the current question index.
   */
  #updateNavButtons() {
    const prevBtn   = this.#container?.querySelector(`#quiz-btn-prev`);
    const nextBtn   = this.#container?.querySelector(`#quiz-btn-next`);
    const submitBtn = this.#container?.querySelector(`#quiz-btn-submit`);

    if (prevBtn) {
      const atFirst = this.#currentIdx === 0;
      prevBtn.disabled = atFirst;
      prevBtn.setAttribute('aria-disabled', String(atFirst));
    }

    if (nextBtn) {
      const atLast = this.#currentIdx === this.#questionOrder.length - 1;
      nextBtn.disabled = atLast;
      nextBtn.setAttribute('aria-disabled', String(atLast));
    }

    if (submitBtn) {
      // Submit is always enabled — partial submission allowed
      submitBtn.hidden = false;
    }
  }

  /**
   * Update navigation buttons for review mode.
   *
   * @param {number} index
   */
  #updateReviewNavButtons(index) {
    const controls = this.#container?.querySelector(`.${CSS.CONTROLS}`);
    if (!controls) return;

    controls.hidden = false;

    const prevBtn   = controls.querySelector(`#quiz-btn-prev`);
    const nextBtn   = controls.querySelector(`#quiz-btn-next`);
    const skipBtn   = controls.querySelector(`#quiz-btn-skip`);
    const pauseBtn  = controls.querySelector(`#quiz-btn-pause`);
    const submitBtn = controls.querySelector(`#quiz-btn-submit`);

    if (skipBtn)   skipBtn.hidden   = true;
    if (pauseBtn)  pauseBtn.hidden  = true;
    if (submitBtn) submitBtn.hidden = true;

    if (prevBtn) {
      const atFirst = index === 0;
      prevBtn.disabled = atFirst;
      prevBtn.setAttribute('aria-disabled', String(atFirst));
      prevBtn.onclick = () => this.reviewPrev();
    }

    if (nextBtn) {
      const atLast = index === this.#questionOrder.length - 1;
      nextBtn.disabled = atLast;
      nextBtn.setAttribute('aria-disabled', String(atLast));
      nextBtn.onclick = () => this.reviewNext();
    }
  }

  // ---- Private: event attachment -------------------------------------------

  /**
   * Attach events for the quiz navigation control buttons.
   * Uses stored cleanup references for proper teardown.
   */
  #attachControlEvents() {
    const controls = [
      {
        id:      'quiz-btn-prev',
        handler: () => this.prev(),
      },
      {
        id:      'quiz-btn-next',
        handler: () => this.next(),
      },
      {
        id:      'quiz-btn-skip',
        handler: () => this.skip(),
      },
      {
        id:      'quiz-btn-pause',
        handler: () => this.pause(),
      },
      {
        id:      'quiz-btn-submit',
        handler: () => {
          if (this.#status === QUIZ_STATUS.ACTIVE) {
            this.submit();
          }
        },
      },
    ];

    controls.forEach(({ id, handler }) => {
      const btn = this.#container?.querySelector(`#${id}`);
      if (!btn) return;
      btn.addEventListener('click', handler);
      this.#cleanupFns.push(() => btn.removeEventListener('click', handler));
    });
  }

  /**
   * Attach input events for the current question panel.
   * Handles radio, checkbox, and text input answer recording.
   *
   * @param {HTMLElement}  panel
   * @param {QuizQuestion} question
   * @param {string}       questionId
   */
  #attachQuestionEvents(panel, question, questionId) {
    // Bookmark button
    const bookmarkBtn = panel.querySelector(`#quiz-bookmark-btn`);
    if (bookmarkBtn) {
      const onBookmark = () => this.toggleBookmark();
      bookmarkBtn.addEventListener('click', onBookmark);
      this.#cleanupFns.push(() => bookmarkBtn.removeEventListener('click', onBookmark));
    }

    // Flag button
    const flagBtn = panel.querySelector(`#quiz-flag-btn`);
    if (flagBtn) {
      const onFlag = () => this.toggleFlag();
      flagBtn.addEventListener('click', onFlag);
      this.#cleanupFns.push(() => flagBtn.removeEventListener('click', onFlag));
    }

    // Hint toggle
    const hintBtn  = panel.querySelector(`#quiz-hint-btn`);
    const hintText = panel.querySelector(`#quiz-hint-text`);
    if (hintBtn && hintText) {
      const onHint = () => {
        const isHidden = hintText.hidden;
        hintText.hidden = !isHidden;
        hintBtn.setAttribute('aria-expanded', String(isHidden));
        hintBtn.querySelector('span:last-child')!.textContent =
          isHidden ? 'Hide hint' : 'Show hint';
        panel.querySelector(`.${CSS.HINT_WRAPPER}`)
          ?.classList.toggle(CSS.HINT_VISIBLE, isHidden);
      };
      hintBtn.addEventListener('click', onHint);
      this.#cleanupFns.push(() => hintBtn.removeEventListener('click', onHint));
    }

    // Answer inputs
    switch (question.type) {
      case 'multiple-choice': {
        const radios = panel.querySelectorAll(`input[type="radio"]`);
        radios.forEach((radio) => {
          const onChange = () => {
            const idx = Number(radio.value);
            // Update selected state on all options
            panel.querySelectorAll(`.${CSS.OPTION}`).forEach((opt, i) => {
              opt.classList.toggle(CSS.OPTION_SELECTED, i === idx);
            });
            this.#recordAnswer(questionId, { selectedIndex: idx });
          };
          radio.addEventListener('change', onChange);
          this.#cleanupFns.push(() => radio.removeEventListener('change', onChange));
        });
        break;
      }

      case 'multiple-select': {
        const checkboxes = panel.querySelectorAll(`input[type="checkbox"]`);
        const getSelected = () =>
          Array.from(checkboxes)
            .filter((cb) => cb.checked)
            .map((cb) => Number(cb.value));

        checkboxes.forEach((checkbox) => {
          const onChange = () => {
            const selected = getSelected();
            const idx      = Number(checkbox.value);
            const optEl    = panel.querySelectorAll(`.${CSS.OPTION}`)[idx];
            optEl?.classList.toggle(CSS.OPTION_SELECTED, checkbox.checked);
            this.#recordAnswer(questionId, { selectedIndices: selected });
          };
          checkbox.addEventListener('change', onChange);
          this.#cleanupFns.push(() => checkbox.removeEventListener('change', onChange));
        });
        break;
      }

      case 'fill-in-the-blank': {
        const fitbInput = panel.querySelector(`.${CSS.FITB_INPUT}`);
        if (fitbInput) {
          const onInput = debounce(() => {
            const text = fitbInput.value;
            this.#recordAnswer(questionId, { text });
          }, 400);
          fitbInput.addEventListener('input', onInput);
          this.#cleanupFns.push(() => fitbInput.removeEventListener('input', onInput));
        }
        break;
      }
    }
  }

  /**
   * Attach events for the results screen action buttons.
   *
   * @param {HTMLElement} resultEl
   */
  #attachResultsEvents(resultEl) {
    const reviewBtn   = resultEl.querySelector(`#quiz-btn-review`);
    const retakeBtn   = resultEl.querySelector(`#quiz-btn-retake`);
    const continueBtn = resultEl.querySelector(`#quiz-btn-continue`);

    if (reviewBtn) {
      const onReview = () => this.review();
      reviewBtn.addEventListener('click', onReview);
      this.#cleanupFns.push(() => reviewBtn.removeEventListener('click', onReview));
    }

    if (retakeBtn) {
      const onRetake = () => {
        this.reset();
        this.start({ resume: false });
      };
      retakeBtn.addEventListener('click', onRetake);
      this.#cleanupFns.push(() => retakeBtn.removeEventListener('click', onRetake));
    }

    if (continueBtn) {
      const onContinue = () => {
        this.#dispatch('quiz:continue', { quizId: this.#quizData.id });
      };
      continueBtn.addEventListener('click', onContinue);
      this.#cleanupFns.push(() => continueBtn.removeEventListener('click', onContinue));
    }
  }

  /**
   * Attach global keyboard shortcuts for the quiz.
   *
   *   ArrowLeft / ArrowRight — previous / next question
   *   B                      — toggle bookmark
   *   F                      — toggle flag
   *   P                      — pause/resume (timed quizzes)
   *   Escape                 — pause if active
   */
  #attachGlobalKeyboardEvents() {
    const onKeydown = (e) => {
      // Do not intercept when focus is inside an input or textarea
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      // Do not intercept with modifier keys (browser/OS shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.#status === QUIZ_STATUS.REVIEW ? this.reviewPrev() : this.prev();
          break;

        case 'ArrowRight':
          e.preventDefault();
          this.#status === QUIZ_STATUS.REVIEW ? this.reviewNext() : this.next();
          break;

        case 'b':
        case 'B':
          if (this.#status === QUIZ_STATUS.ACTIVE) {
            e.preventDefault();
            this.toggleBookmark();
          }
          break;

        case 'f':
        case 'F':
          if (this.#status === QUIZ_STATUS.ACTIVE) {
            e.preventDefault();
            this.toggleFlag();
          }
          break;

        case 'p':
        case 'P':
          if (this.#status === QUIZ_STATUS.ACTIVE) {
            e.preventDefault();
            this.pause();
          } else if (this.#status === QUIZ_STATUS.PAUSED) {
            e.preventDefault();
            this.resume();
          }
          break;

        case 'Escape':
          if (this.#status === QUIZ_STATUS.ACTIVE) {
            e.preventDefault();
            this.pause();
          }
          break;

        default:
          break;
      }
    };

    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));
  }

  // ---- Private: persistence ------------------------------------------------

  /**
   * Save the current session state to localStorage.
   * Called after every meaningful state change.
   */
  #saveSession() {
    if (!this.#quizData) return;

    this.#store.save(this.#quizData.id, {
      answers:       this.#answers,
      bookmarks:     [...this.#bookmarks],
      flags:         [...this.#flags],
      currentIdx:    this.#currentIdx,
      elapsed:       this.#timer?.elapsed ?? 0,
      questionOrder: this.#questionOrder,
      startedAt:     this.#startedAt,
    });
  }

  // ---- Private: status management ------------------------------------------

  /**
   * Update the session status and sync the container CSS modifier class.
   *
   * @param {string} newStatus — One of QUIZ_STATUS values
   */
  #setStatus(newStatus) {
    this.#status = newStatus;

    if (!this.#container) return;

    // Sync root-level modifier classes
    this.#container.classList.toggle(CSS.ROOT_ACTIVE,    newStatus === QUIZ_STATUS.ACTIVE);
    this.#container.classList.toggle(CSS.ROOT_REVIEW,    newStatus === QUIZ_STATUS.REVIEW);
    this.#container.classList.toggle(CSS.ROOT_COMPLETE,  newStatus === QUIZ_STATUS.COMPLETE);
    this.#container.classList.toggle(CSS.ROOT_PAUSED,    newStatus === QUIZ_STATUS.PAUSED);
    this.#container.classList.toggle(CSS.ROOT_LOADING,   newStatus === QUIZ_STATUS.LOADING);
  }

  // ---- Private: guards -----------------------------------------------------

  /**
   * Returns true if the quiz is in a state where answers can be recorded.
   * @returns {boolean}
   */
  #isActive() {
    return this.#status === QUIZ_STATUS.ACTIVE;
  }

  /**
   * Returns true if every question in the order has a recorded answer.
   * @returns {boolean}
   */
  #allAnswered() {
    return this.#questionOrder.every((id) => this.#answers[id] !== undefined);
  }

  // ---- Private: navigation helpers -----------------------------------------

  /**
   * Find the index of the next unanswered question after the current one.
   * Wraps around to search from the beginning.
   *
   * @returns {number|null} — Index, or null if all questions are answered
   */
  #findNextUnanswered() {
    const total = this.#questionOrder.length;
    for (let offset = 1; offset < total; offset++) {
      const idx = (this.#currentIdx + offset) % total;
      if (this.#answers[this.#questionOrder[idx]] === undefined) {
        return idx;
      }
    }
    return null;
  }

  /**
   * Return questions in the current randomised order.
   * @returns {QuizQuestion[]}
   */
  #orderedQuestions() {
    return this.#questionOrder.map((id) =>
      this.#questions.find((q) => q.id === id)
    ).filter(Boolean);
  }

  /**
   * Format the correct answer(s) for a question into a human-readable string.
   * Used in review mode to show what the right answer was.
   *
   * @param {QuizQuestion} question
   * @returns {string}
   */
  #formatCorrectAnswer(question) {
    switch (question.type) {
      case 'multiple-choice': {
        const idx = Array.isArray(question.correct) ? question.correct[0] : question.correct;
        return question.options?.[idx] ?? String(idx);
      }

      case 'multiple-select': {
        const indices = Array.isArray(question.correct) ? question.correct : [question.correct];
        return indices
          .map((i) => question.options?.[i] ?? String(i))
          .join(', ');
      }

      case 'fill-in-the-blank': {
        const accepted = Array.isArray(question.correct) ? question.correct : [question.correct];
        return accepted.join(' or ');
      }

      default:
        return String(question.correct);
    }
  }

  // ---- Private: validation -------------------------------------------------

  /**
   * Validate a quiz data object before loading.
   * Throws a descriptive error on the first validation failure.
   *
   * @param {*} data
   * @throws {Error}
   */
  #validateQuizData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('[QuizEngine] Quiz data must be a non-null object.');
    }

    if (typeof data.id !== 'string' || data.id.trim() === '') {
      throw new Error('[QuizEngine] Quiz data must have a non-empty string "id".');
    }

    if (typeof data.title !== 'string' || data.title.trim() === '') {
      throw new Error('[QuizEngine] Quiz data must have a non-empty string "title".');
    }

    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('[QuizEngine] Quiz data must have a non-empty "questions" array.');
    }

    const validTypes = new Set(['multiple-choice', 'multiple-select', 'fill-in-the-blank']);

    data.questions.forEach((q, idx) => {
      const prefix = `[QuizEngine] questions[${idx}]`;

      if (!q || typeof q !== 'object') {
        throw new Error(`${prefix} must be an object.`);
      }

      if (typeof q.id !== 'string' || q.id.trim() === '') {
        throw new Error(`${prefix} must have a non-empty string "id".`);
      }

      if (!validTypes.has(q.type)) {
        throw new Error(`${prefix} has unknown type "${q.type}". Expected: ${[...validTypes].join(', ')}.`);
      }

      if (typeof q.text !== 'string' || q.text.trim() === '') {
        throw new Error(`${prefix} must have a non-empty string "text".`);
      }

      if (q.type === 'multiple-choice' || q.type === 'multiple-select') {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          throw new Error(`${prefix} must have at least 2 "options".`);
        }
        if (q.correct === undefined || q.correct === null) {
          throw new Error(`${prefix} must have a "correct" answer.`);
        }
      }

      if (q.type === 'fill-in-the-blank') {
        if (q.correct === undefined || q.correct === null) {
          throw new Error(`${prefix} must have a "correct" answer.`);
        }
      }
    });
  }

  // ---- Private: accessibility ----------------------------------------------

  /**
   * Write a message to the ARIA live region for screen reader announcement.
   * Clears first to ensure re-announcements of the same string trigger AT.
   *
   * @param {string} message
   */
  #announceToScreenReader(message) {
    if (!this.#liveRegion) {
      // Attempt to find the live region if it was rendered separately
      this.#liveRegion = this.#container?.querySelector(`.${CSS.LIVE}`);
    }
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
   * Consistent pattern with navigation.js, header.js, footer.js.
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

export default QuizEngine;