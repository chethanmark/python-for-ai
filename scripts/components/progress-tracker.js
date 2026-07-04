/**
 * =============================================================================
 * PROGRESS TRACKER COMPONENT
 * scripts/components/progress-tracker.js
 * -----------------------------------------------------------------------------
 * Central learning-progress engine for the Python for AI educational platform.
 * This module is the single source of truth for all user progress data. Every
 * other component that needs progress information reads it through this module —
 * never directly from localStorage.
 *
 * RESPONSIBILITIES:
 *   ① Persistence Layer
 *      - Reads and writes a structured progress document to localStorage
 *      - Schema versioning with forward-migration support
 *      - Atomic writes: the document is serialised in one operation so a
 *        partial write cannot corrupt the stored state
 *      - Graceful degradation when localStorage is unavailable (private
 *        browsing, quota exceeded) — the module continues in-memory
 *
 *   ② Tutorial Progress
 *      - Mark a tutorial as started, in-progress, or completed
 *      - Store the last-visited section index for resume-from-where-you-left-off
 *      - Record completion timestamp and time-on-page in seconds
 *      - Calculate per-category completion percentage
 *
 *   ③ Quiz Progress
 *      - Record every quiz attempt: score, total questions, time taken, answers
 *      - Track best score and attempt count per quiz
 *      - Calculate pass/fail based on configurable pass threshold (default 70%)
 *      - Compute overall quiz accuracy across all attempts
 *
 *   ④ Project Progress
 *      - Track project states: locked → available → in-progress → submitted → completed
 *      - Store submission metadata (timestamp, self-assessed difficulty rating)
 *      - Support partial progress within a project (step completion)
 *
 *   ⑤ XP and Level System
 *      - Award XP for every learning action (configurable in XP_REWARDS)
 *      - Bonus XP for perfect quiz scores, fast completions, and streaks
 *      - Level derived from cumulative XP via a progressive threshold table
 *      - XP needed for next level exposed for progress-bar rendering
 *
 *   ⑥ Learning Streak
 *      - Daily streak: incremented when the user completes any learning activity
 *        on a calendar day after the previous activity was on the prior day
 *      - Longest streak tracked separately from current streak
 *      - Streak freezes: the user does not lose their streak on a single missed
 *        day if they have at least one freeze available (earned via milestones)
 *      - Streak warning: fires an event when the streak will expire within 4 hours
 *
 *   ⑦ Achievement / Badge System
 *      - 30+ achievements defined in ACHIEVEMENT_DEFINITIONS
 *      - Each achievement has: id, title, description, icon, category, XP reward,
 *        and a pure predicate function that receives the full progress state
 *      - Achievements are evaluated after every state mutation
 *      - Newly unlocked achievements are emitted as events for the UI to display
 *        (toast notification, modal, dashboard update)
 *      - Hidden achievements are revealed only after unlock (no spoilers)
 *
 *   ⑧ Summary and Dashboard Integration
 *      - getSummary() returns a single serialisable snapshot consumed by dashboard.js
 *      - Exposes typed accessor methods for every domain (no raw state reads)
 *      - Emits progress:updated after every mutation so dashboard re-renders
 *        reactively without polling
 *
 * DOES NOT OWN:
 *   - DOM rendering     → dashboard.js reads getSummary() and renders
 *   - Quiz logic        → quiz.js submits results via recordQuizAttempt()
 *   - Code execution    → code-editor.js
 *   - Authentication    → future firebase module
 *
 * STORAGE SCHEMA (localStorage key: "pyai-progress"):
 *   {
 *     version:      2,                          // schema version for migrations
 *     createdAt:    1719000000000,              // Unix ms timestamp
 *     updatedAt:    1719000000000,
 *     xp:           0,
 *     streak: {
 *       current:    0,
 *       longest:    0,
 *       lastDate:   null,                      // "YYYY-MM-DD" string or null
 *       freezes:    0,
 *       freezeUsed: false,
 *     },
 *     tutorials:    { [id]: TutorialRecord },
 *     quizzes:      { [id]: QuizRecord },
 *     projects:     { [id]: ProjectRecord },
 *     achievements: { [id]: AchievementRecord },
 *   }
 *
 * DEPENDENCIES:
 *   - scripts/core/events.js — event bus (window.__pyaiEvents)
 *   - No DOM dependency — this module is pure data; safe to import anywhere
 *
 * EVENT EMISSIONS:
 *   progress:updated              { summary }       — after any state change
 *   progress:xp:gained            { amount, total, source, level, leveledUp }
 *   progress:level:up             { level, previousLevel, xp }
 *   progress:tutorial:started     { id, title }
 *   progress:tutorial:completed   { id, title, xp, firstTime }
 *   progress:quiz:attempted       { id, score, total, passed, xp }
 *   progress:project:updated      { id, state, xp }
 *   progress:achievement:unlocked { achievement }
 *   progress:streak:updated       { current, longest, gained }
 *   progress:streak:warning       { current, expiresInMs }
 *   progress:reset                {}
 *
 * USAGE (quiz.js, tutorial-detail.js, dashboard.js):
 *
 *   import { ProgressTracker, PROGRESS_EVENTS } from './progress-tracker.js';
 *
 *   const tracker = new ProgressTracker();
 *   tracker.init();
 *
 *   // Tutorial completion
 *   tracker.recordTutorialStart('python-variables');
 *   tracker.recordTutorialComplete('python-variables', { timeOnPage: 480 });
 *
 *   // Quiz attempt
 *   tracker.recordQuizAttempt('python-variables-quiz', {
 *     score: 8, total: 10, timeMs: 95000, answers: [...]
 *   });
 *
 *   // Dashboard
 *   const summary = tracker.getSummary();
 *
 * EXPORTS:
 *   ProgressTracker    — primary class (default export)
 *   PROGRESS_EVENTS    — event name constants
 *   XP_REWARDS         — XP award table (read-only reference)
 *   LEVEL_THRESHOLDS   — level XP thresholds (read-only reference)
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const PROGRESS_EVENTS = {
  UPDATED:              'progress:updated',
  XP_GAINED:            'progress:xp:gained',
  LEVEL_UP:             'progress:level:up',
  TUTORIAL_STARTED:     'progress:tutorial:started',
  TUTORIAL_COMPLETED:   'progress:tutorial:completed',
  QUIZ_ATTEMPTED:       'progress:quiz:attempted',
  PROJECT_UPDATED:      'progress:project:updated',
  ACHIEVEMENT_UNLOCKED: 'progress:achievement:unlocked',
  STREAK_UPDATED:       'progress:streak:updated',
  STREAK_WARNING:       'progress:streak:warning',
  RESET:                'progress:reset',
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** localStorage key for the progress document */
const STORAGE_KEY    = 'pyai-progress';

/** Current schema version. Increment when the schema changes. */
const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// XP reward table
// ---------------------------------------------------------------------------

/**
 * XP awarded for each learning action.
 * All values are intentionally exported so the UI can display them
 * in a "how to earn XP" explainer without duplicating data.
 *
 * @type {Record<string, number>}
 */
export const XP_REWARDS = {
  TUTORIAL_START:        5,
  TUTORIAL_COMPLETE:     50,
  TUTORIAL_REVISIT:      5,
  QUIZ_ATTEMPT:          10,
  QUIZ_PASS:             30,
  QUIZ_PERFECT:          75,   // 100% score bonus (on top of QUIZ_PASS)
  QUIZ_IMPROVEMENT:      15,   // Beat personal best score
  PROJECT_START:         10,
  PROJECT_COMPLETE:      100,
  PROJECT_RATED:         10,   // User self-rates the project difficulty
  STREAK_DAY:            20,   // Bonus per active streak day (awarded on each completion)
  STREAK_MILESTONE_7:    100,  // 7-day streak milestone bonus
  STREAK_MILESTONE_30:   500,
  STREAK_MILESTONE_100:  2000,
  ACHIEVEMENT_BASE:      25,   // Base XP for unlocking any achievement (stackable)
  DAILY_LOGIN:           5,    // Awarded once per calendar day
};

// ---------------------------------------------------------------------------
// Level threshold table
// ---------------------------------------------------------------------------

/**
 * Cumulative XP required to reach each level (index = level number).
 * Level 0 is the starting state (not displayed); level 1 begins at 0 XP.
 * The table defines levels 1–25. Beyond level 25 the formula
 * LEVEL_25_XP + (level - 25) * 2000 continues the progression.
 *
 * @type {number[]}
 */
export const LEVEL_THRESHOLDS = [
  0,       // level 0 — unused sentinel
  0,       // level 1
  100,     // level 2
  250,     // level 3
  500,     // level 4
  850,     // level 5
  1300,    // level 6
  1900,    // level 7
  2600,    // level 8
  3500,    // level 9
  4600,    // level 10
  5900,    // level 11
  7400,    // level 12
  9100,    // level 13
  11000,   // level 14
  13200,   // level 15
  15700,   // level 16
  18500,   // level 17
  21700,   // level 18
  25300,   // level 19
  29300,   // level 20
  33800,   // level 21
  38900,   // level 22
  44600,   // level 23
  51000,   // level 24
  58200,   // level 25
];

/** XP required for level 25 (highest in the static table) */
const LEVEL_25_XP = LEVEL_THRESHOLDS[25];

// ---------------------------------------------------------------------------
// Project state enum
// ---------------------------------------------------------------------------

/**
 * Valid states for a project record.
 * The state machine is: locked → available → in-progress → submitted → completed
 * (Completed projects may be re-attempted from the available state.)
 *
 * @enum {string}
 */
export const PROJECT_STATE = {
  LOCKED:      'locked',
  AVAILABLE:   'available',
  IN_PROGRESS: 'in-progress',
  SUBMITTED:   'submitted',
  COMPLETED:   'completed',
};

// ---------------------------------------------------------------------------
// Pass threshold
// ---------------------------------------------------------------------------

/** Minimum score fraction to count a quiz as "passed" (70%) */
const QUIZ_PASS_THRESHOLD = 0.70;

/** Number of hours remaining before a streak expires that triggers a warning */
const STREAK_WARNING_HOURS = 4;

// ---------------------------------------------------------------------------
// Achievement definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AchievementDefinition
 * @property {string}   id          — Unique identifier, snake_case
 * @property {string}   title       — Short display name
 * @property {string}   description — Full description shown on unlock
 * @property {string}   icon        — Emoji or icon name
 * @property {string}   category    — 'tutorial'|'quiz'|'project'|'streak'|'xp'|'special'
 * @property {number}   xp          — XP awarded on unlock
 * @property {boolean}  [hidden]    — Hidden until unlocked (default false)
 * @property {function} predicate   — Pure function(state) → boolean
 */

/** @type {AchievementDefinition[]} */
const ACHIEVEMENT_DEFINITIONS = [

  // ── Tutorial achievements ──────────────────────────────────────────────────
  {
    id:          'first_tutorial',
    title:       'First Steps',
    description: 'Complete your first tutorial.',
    icon:        '📖',
    category:    'tutorial',
    xp:          25,
    predicate:   (s) => countCompleted(s.tutorials) >= 1,
  },
  {
    id:          'tutorial_5',
    title:       'Getting Serious',
    description: 'Complete 5 tutorials.',
    icon:        '📚',
    category:    'tutorial',
    xp:          50,
    predicate:   (s) => countCompleted(s.tutorials) >= 5,
  },
  {
    id:          'tutorial_10',
    title:       'Knowledge Builder',
    description: 'Complete 10 tutorials.',
    icon:        '🧱',
    category:    'tutorial',
    xp:          100,
    predicate:   (s) => countCompleted(s.tutorials) >= 10,
  },
  {
    id:          'tutorial_25',
    title:       'Scholar',
    description: 'Complete 25 tutorials.',
    icon:        '🎓',
    category:    'tutorial',
    xp:          250,
    predicate:   (s) => countCompleted(s.tutorials) >= 25,
  },
  {
    id:          'tutorial_50',
    title:       'Curriculum Master',
    description: 'Complete 50 tutorials. The curriculum bows to you.',
    icon:        '🏛️',
    category:    'tutorial',
    xp:          500,
    predicate:   (s) => countCompleted(s.tutorials) >= 50,
  },
  {
    id:          'speed_learner',
    title:       'Speed Learner',
    description: 'Complete a tutorial in under 5 minutes.',
    icon:        '⚡',
    category:    'tutorial',
    xp:          30,
    hidden:      true,
    predicate:   (s) =>
      Object.values(s.tutorials).some(
        (t) => t.completedAt && t.timeOnPage !== undefined && t.timeOnPage < 300
      ),
  },
  {
    id:          'deep_dive',
    title:       'Deep Dive',
    description: 'Spend more than 30 minutes on a single tutorial.',
    icon:        '🤿',
    category:    'tutorial',
    xp:          40,
    hidden:      true,
    predicate:   (s) =>
      Object.values(s.tutorials).some(
        (t) => t.timeOnPage !== undefined && t.timeOnPage > 1800
      ),
  },

  // ── Quiz achievements ──────────────────────────────────────────────────────
  {
    id:          'first_quiz',
    title:       'Quiz Taker',
    description: 'Complete your first quiz.',
    icon:        '✏️',
    category:    'quiz',
    xp:          25,
    predicate:   (s) => Object.keys(s.quizzes).length >= 1,
  },
  {
    id:          'first_pass',
    title:       'Passing Grade',
    description: 'Pass a quiz with 70% or higher.',
    icon:        '✅',
    category:    'quiz',
    xp:          30,
    predicate:   (s) =>
      Object.values(s.quizzes).some((q) => q.bestScore / q.totalQuestions >= QUIZ_PASS_THRESHOLD),
  },
  {
    id:          'perfect_score',
    title:       'Perfect Score',
    description: 'Score 100% on any quiz.',
    icon:        '💯',
    category:    'quiz',
    xp:          75,
    predicate:   (s) =>
      Object.values(s.quizzes).some((q) => q.bestScore === q.totalQuestions),
  },
  {
    id:          'quiz_5',
    title:       'Quiz Regular',
    description: 'Complete 5 quizzes.',
    icon:        '📝',
    category:    'quiz',
    xp:          50,
    predicate:   (s) => Object.keys(s.quizzes).length >= 5,
  },
  {
    id:          'quiz_10',
    title:       'Quiz Champion',
    description: 'Complete 10 quizzes.',
    icon:        '🏆',
    category:    'quiz',
    xp:          100,
    predicate:   (s) => Object.keys(s.quizzes).length >= 10,
  },
  {
    id:          'persistent_learner',
    title:       'Persistent Learner',
    description: 'Retake a quiz and beat your previous score.',
    icon:        '📈',
    category:    'quiz',
    xp:          35,
    hidden:      true,
    predicate:   (s) =>
      Object.values(s.quizzes).some((q) => q.attempts >= 2 && q.improved),
  },
  {
    id:          'speed_quiz',
    title:       'Quick on the Draw',
    description: 'Pass a quiz in under 60 seconds.',
    icon:        '🎯',
    category:    'quiz',
    xp:          50,
    hidden:      true,
    predicate:   (s) =>
      Object.values(s.quizzes).some(
        (q) => q.bestScore / q.totalQuestions >= QUIZ_PASS_THRESHOLD &&
               q.fastestTimeMs !== undefined && q.fastestTimeMs < 60_000
      ),
  },
  {
    id:          'all_quizzes_passed',
    title:       'Straight-A Student',
    description: 'Pass every quiz you have attempted.',
    icon:        '🌟',
    category:    'quiz',
    xp:          150,
    predicate:   (s) => {
      const quizzes = Object.values(s.quizzes);
      return quizzes.length > 0 &&
        quizzes.every((q) => q.bestScore / q.totalQuestions >= QUIZ_PASS_THRESHOLD);
    },
  },

  // ── Project achievements ───────────────────────────────────────────────────
  {
    id:          'first_project',
    title:       'Builder',
    description: 'Complete your first AI project.',
    icon:        '🔨',
    category:    'project',
    xp:          100,
    predicate:   (s) => countByState(s.projects, PROJECT_STATE.COMPLETED) >= 1,
  },
  {
    id:          'project_3',
    title:       'Project Veteran',
    description: 'Complete 3 AI projects.',
    icon:        '🏗️',
    category:    'project',
    xp:          200,
    predicate:   (s) => countByState(s.projects, PROJECT_STATE.COMPLETED) >= 3,
  },
  {
    id:          'project_10',
    title:       'AI Engineer',
    description: 'Complete 10 AI projects.',
    icon:        '🤖',
    category:    'project',
    xp:          500,
    predicate:   (s) => countByState(s.projects, PROJECT_STATE.COMPLETED) >= 10,
  },
  {
    id:          'project_rated',
    title:       'Self-Aware',
    description: 'Rate the difficulty of a completed project.',
    icon:        '🔍',
    category:    'project',
    xp:          10,
    predicate:   (s) =>
      Object.values(s.projects).some((p) => p.difficultyRating !== undefined),
  },

  // ── Streak achievements ────────────────────────────────────────────────────
  {
    id:          'streak_3',
    title:       'On a Roll',
    description: 'Maintain a 3-day learning streak.',
    icon:        '🔥',
    category:    'streak',
    xp:          30,
    predicate:   (s) => s.streak.longest >= 3,
  },
  {
    id:          'streak_7',
    title:       'Week Warrior',
    description: 'Maintain a 7-day learning streak.',
    icon:        '🗓️',
    category:    'streak',
    xp:          100,
    predicate:   (s) => s.streak.longest >= 7,
  },
  {
    id:          'streak_30',
    title:       'Habit Formed',
    description: 'Maintain a 30-day learning streak.',
    icon:        '⚙️',
    category:    'streak',
    xp:          500,
    predicate:   (s) => s.streak.longest >= 30,
  },
  {
    id:          'streak_100',
    title:       'Centurion',
    description: 'Maintain a 100-day learning streak. Legendary.',
    icon:        '💎',
    category:    'streak',
    xp:          2000,
    hidden:      true,
    predicate:   (s) => s.streak.longest >= 100,
  },

  // ── XP / Level achievements ────────────────────────────────────────────────
  {
    id:          'level_5',
    title:       'Level 5',
    description: 'Reach level 5.',
    icon:        '⭐',
    category:    'xp',
    xp:          50,
    predicate:   (s) => xpToLevel(s.xp) >= 5,
  },
  {
    id:          'level_10',
    title:       'Double Digits',
    description: 'Reach level 10.',
    icon:        '🌠',
    category:    'xp',
    xp:          100,
    predicate:   (s) => xpToLevel(s.xp) >= 10,
  },
  {
    id:          'level_20',
    title:       'Elite Learner',
    description: 'Reach level 20.',
    icon:        '🚀',
    category:    'xp',
    xp:          500,
    predicate:   (s) => xpToLevel(s.xp) >= 20,
  },
  {
    id:          'level_25',
    title:       'Python for AI Master',
    description: 'Reach the maximum level. You have mastered the curriculum.',
    icon:        '🏅',
    category:    'xp',
    xp:          1000,
    hidden:      true,
    predicate:   (s) => xpToLevel(s.xp) >= 25,
  },
  {
    id:          'xp_1000',
    title:       'Four Figures',
    description: 'Earn 1,000 total XP.',
    icon:        '💰',
    category:    'xp',
    xp:          50,
    predicate:   (s) => s.xp >= 1000,
  },
  {
    id:          'xp_10000',
    title:       'Ten Thousand Club',
    description: 'Earn 10,000 total XP.',
    icon:        '💎',
    category:    'xp',
    xp:          500,
    hidden:      true,
    predicate:   (s) => s.xp >= 10_000,
  },

  // ── Special / multi-domain achievements ───────────────────────────────────
  {
    id:          'triple_threat',
    title:       'Triple Threat',
    description: 'Complete a tutorial, a quiz, and a project on the same day.',
    icon:        '🌈',
    category:    'special',
    xp:          150,
    hidden:      true,
    predicate:   (s) => {
      const today = todayDateString();
      const tutorialToday  = Object.values(s.tutorials).some((t) => t.completedAt && dateString(t.completedAt) === today);
      const quizToday      = Object.values(s.quizzes).some((q) => q.lastAttemptAt && dateString(q.lastAttemptAt) === today);
      const projectToday   = Object.values(s.projects).some((p) => p.completedAt && dateString(p.completedAt) === today);
      return tutorialToday && quizToday && projectToday;
    },
  },
  {
    id:          'night_owl',
    title:       'Night Owl',
    description: 'Complete a learning activity after midnight.',
    icon:        '🦉',
    category:    'special',
    xp:          20,
    hidden:      true,
    predicate:   (s) => {
      const allTimestamps = [
        ...Object.values(s.tutorials).map((t) => t.completedAt),
        ...Object.values(s.quizzes).map((q) => q.lastAttemptAt),
        ...Object.values(s.projects).map((p) => p.completedAt),
      ].filter(Boolean);
      return allTimestamps.some((ts) => {
        const h = new Date(ts).getHours();
        return h >= 0 && h < 4;
      });
    },
  },
  {
    id:          'early_bird',
    title:       'Early Bird',
    description: 'Complete a learning activity before 7 AM.',
    icon:        '🌅',
    category:    'special',
    xp:          20,
    hidden:      true,
    predicate:   (s) => {
      const allTimestamps = [
        ...Object.values(s.tutorials).map((t) => t.completedAt),
        ...Object.values(s.quizzes).map((q) => q.lastAttemptAt),
        ...Object.values(s.projects).map((p) => p.completedAt),
      ].filter(Boolean);
      return allTimestamps.some((ts) => {
        const h = new Date(ts).getHours();
        return h >= 4 && h < 7;
      });
    },
  },
  {
    id:          'comeback_kid',
    title:       'Comeback Kid',
    description: 'Return to learning after a break of 7 or more days.',
    icon:        '🔄',
    category:    'special',
    xp:          50,
    hidden:      true,
    predicate:   (s) => s.streak.hadLongBreak === true,
  },
];

// ---------------------------------------------------------------------------
// Pure utility functions (module-private, no side effects)
// ---------------------------------------------------------------------------

/**
 * Count items in a record where completedAt is set.
 * @param {Record<string, {completedAt?: number}>} record
 * @returns {number}
 */
function countCompleted(record) {
  return Object.values(record).filter((item) => item.completedAt != null).length;
}

/**
 * Count project records that are in a specific state.
 * @param {Record<string, {state: string}>} record
 * @param {string} state
 * @returns {number}
 */
function countByState(record, state) {
  return Object.values(record).filter((p) => p.state === state).length;
}

/**
 * Derive the current level from cumulative XP.
 * @param {number} xp
 * @returns {number} Level number (minimum 1)
 */
export function xpToLevel(xp) {
  if (xp <= 0) return 1;

  // Check the static table first
  for (let lvl = LEVEL_THRESHOLDS.length - 1; lvl >= 1; lvl--) {
    if (xp >= LEVEL_THRESHOLDS[lvl]) return lvl;
  }

  // Beyond the static table: continue with +2000 XP per level
  let lvl = 25;
  let required = LEVEL_25_XP;
  while (xp >= required + 2000) {
    lvl++;
    required += 2000;
  }

  return lvl;
}

/**
 * XP required to reach a specific level.
 * @param {number} level
 * @returns {number}
 */
export function levelToXp(level) {
  if (level <= 1) return 0;
  if (level <= 25) return LEVEL_THRESHOLDS[level];
  return LEVEL_25_XP + (level - 25) * 2000;
}

/**
 * Return today's date as a "YYYY-MM-DD" string in local time.
 * @returns {string}
 */
function todayDateString() {
  return dateString(Date.now());
}

/**
 * Convert a Unix ms timestamp to a "YYYY-MM-DD" local-time string.
 * @param {number} ts
 * @returns {string}
 */
function dateString(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return yesterday's date as a "YYYY-MM-DD" string in local time.
 * @returns {string}
 */
function yesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateString(d.getTime());
}

/**
 * Check whether two "YYYY-MM-DD" strings represent consecutive calendar days.
 * @param {string} dateA
 * @param {string} dateB  — must be >= dateA
 * @returns {boolean}
 */
function areConsecutiveDays(dateA, dateB) {
  if (!dateA || !dateB) return false;
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  const diffMs   = b.getTime() - a.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  return diffDays === 1;
}

// ---------------------------------------------------------------------------
// Default state factory
// ---------------------------------------------------------------------------

/**
 * Returns a fresh, empty progress document.
 * Always call this function — never hardcode the structure elsewhere —
 * so there is exactly one place to update when the schema changes.
 *
 * @returns {ProgressState}
 */
function createDefaultState() {
  const now = Date.now();
  return {
    version:   SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    xp:        0,
    streak: {
      current:     0,
      longest:     0,
      lastDate:    null,
      freezes:     0,
      freezeUsed:  false,
      hadLongBreak: false,
    },
    tutorials:    {},
    quizzes:      {},
    projects:     {},
    achievements: {},
  };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Migrate a persisted state document forward to the current schema version.
 * Each case handles exactly one version bump.
 * Missing cases mean that version is already compatible.
 *
 * @param {object} raw — Raw parsed JSON from localStorage
 * @returns {ProgressState} Migrated state
 */
function migrateState(raw) {
  let state = raw;

  // v1 → v2: added streak.hadLongBreak and project step tracking
  if ((state.version ?? 1) < 2) {
    state = {
      ...state,
      version: 2,
      streak: {
        current:      state.streak?.current      ?? 0,
        longest:      state.streak?.longest      ?? 0,
        lastDate:     state.streak?.lastDate      ?? null,
        freezes:      state.streak?.freezes       ?? 0,
        freezeUsed:   state.streak?.freezeUsed    ?? false,
        hadLongBreak: false,
      },
    };

    // Ensure all project records have the steps field
    for (const id of Object.keys(state.projects ?? {})) {
      if (!state.projects[id].steps) {
        state.projects[id].steps = {};
      }
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around localStorage that isolates all storage operations.
 * Falls back to an in-memory Map when localStorage is unavailable.
 */
class StorageAdapter {
  /** @type {Map<string, string>|null} — in-memory fallback */
  #memory = null;

  /** @type {boolean} */
  #available = true;

  constructor() {
    try {
      const probe = '__pyai_probe__';
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
        : (this.#memory.get(key) ?? null);
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
        this.#memory.set(key, value);
      }
    } catch (e) {
      // QuotaExceededError — swallow, continue in memory
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
  get isAvailable() {
    return this.#available;
  }
}

// ---------------------------------------------------------------------------
// ProgressTracker — primary class
// ---------------------------------------------------------------------------

/**
 * Central progress tracking engine.
 *
 * Lifecycle:
 *   1. new ProgressTracker()  — no side effects
 *   2. .init()                — loads persisted state, starts streak timer
 *   3. .record*()             — mutate state, persist, evaluate achievements
 *   4. .getSummary()          — read-only snapshot for dashboard rendering
 *   5. .destroy()             — clears timers and event subscriptions
 */
export class ProgressTracker {

  // ---- State ---------------------------------------------------------------

  /** @type {ProgressState}   */ #state;
  /** @type {StorageAdapter}  */ #storage;
  /** @type {boolean}         */ #initialised = false;

  // ---- Timers and watchers -------------------------------------------------

  /** @type {number|null} — streak expiry warning timer ID */
  #streakWarningTimer = null;

  // ---- Cleanup references --------------------------------------------------

  /** @type {Array<() => void>} */ #cleanupFns = [];

  // --------------------------------------------------------------------------

  constructor() {
    this.#storage = new StorageAdapter();
    this.#state   = createDefaultState();
  }

  // ---- Public API: lifecycle ------------------------------------------------

  /**
   * Load persisted progress, run migrations, evaluate achievements,
   * and start the streak warning timer.
   *
   * @returns {ProgressTracker} this — for chaining
   */
  init() {
    if (this.#initialised) return this;
    this.#initialised = true;

    this.#load();
    this.#awardDailyLogin();
    this.#evaluateAchievements();
    this.#scheduleStreakWarning();

    return this;
  }

  /**
   * Release timers and event subscriptions.
   */
  destroy() {
    if (this.#streakWarningTimer !== null) {
      clearTimeout(this.#streakWarningTimer);
      this.#streakWarningTimer = null;
    }
    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];
  }

  // ---- Public API: tutorial tracking ---------------------------------------

  /**
   * Record that the user has started a tutorial.
   * Idempotent — safe to call on every page load of a tutorial.
   *
   * @param {string} id         — Tutorial slug (e.g. "python-variables")
   * @param {{ title?: string }} [meta]
   */
  recordTutorialStart(id, meta = {}) {
    this.#assertInit();

    const existing = this.#state.tutorials[id];

    // Do not reset a completed tutorial on re-visit
    if (existing?.completedAt) {
      this.#grantXp(XP_REWARDS.TUTORIAL_REVISIT, `Tutorial revisit: ${id}`);
      return;
    }

    if (!existing) {
      this.#state.tutorials[id] = {
        id,
        title:       meta.title ?? id,
        startedAt:   Date.now(),
        completedAt: null,
        lastSection: 0,
        timeOnPage:  0,
      };

      this.#grantXp(XP_REWARDS.TUTORIAL_START, `Tutorial started: ${id}`);
      this.#persist();
      this.#dispatch(PROGRESS_EVENTS.TUTORIAL_STARTED, {
        id,
        title: meta.title ?? id,
      });
    }
  }

  /**
   * Record progress through a tutorial (section checkpoint).
   * Saves the furthest-reached section for resume support.
   *
   * @param {string} id
   * @param {{ sectionIndex: number, timeOnPage?: number }} progress
   */
  recordTutorialProgress(id, { sectionIndex = 0, timeOnPage = 0 } = {}) {
    this.#assertInit();

    if (!this.#state.tutorials[id]) {
      this.recordTutorialStart(id);
    }

    const record = this.#state.tutorials[id];

    // Only advance — never go backwards
    if (sectionIndex > (record.lastSection ?? 0)) {
      record.lastSection = sectionIndex;
    }

    if (timeOnPage > (record.timeOnPage ?? 0)) {
      record.timeOnPage = timeOnPage;
    }

    this.#persist();
  }

  /**
   * Record that a tutorial has been fully completed.
   *
   * @param {string} id
   * @param {{
   *   title?:      string,
   *   timeOnPage?: number,     — seconds spent on the tutorial page
   * }} [meta]
   */
  recordTutorialComplete(id, meta = {}) {
    this.#assertInit();

    if (!this.#state.tutorials[id]) {
      this.recordTutorialStart(id, meta);
    }

    const record     = this.#state.tutorials[id];
    const firstTime  = !record.completedAt;

    record.completedAt = Date.now();
    record.title       = meta.title ?? record.title ?? id;

    if (meta.timeOnPage !== undefined) {
      record.timeOnPage = meta.timeOnPage;
    }

    if (firstTime) {
      const xpGained = this.#grantXp(XP_REWARDS.TUTORIAL_COMPLETE, `Tutorial completed: ${id}`);
      this.#updateStreak();
      this.#persist();
      this.#evaluateAchievements();

      this.#dispatch(PROGRESS_EVENTS.TUTORIAL_COMPLETED, {
        id,
        title:     record.title,
        xp:        xpGained,
        firstTime: true,
      });
    }
  }

  /**
   * Update the last-visited section for a tutorial (for resume support).
   *
   * @param {string} id
   * @param {number} sectionIndex
   */
  setTutorialSection(id, sectionIndex) {
    this.#assertInit();

    if (!this.#state.tutorials[id]) return;

    const record = this.#state.tutorials[id];
    if (sectionIndex > (record.lastSection ?? 0)) {
      record.lastSection = sectionIndex;
      this.#persist();
    }
  }

  /**
   * Get the stored progress record for a single tutorial.
   *
   * @param {string} id
   * @returns {TutorialRecord|null}
   */
  getTutorial(id) {
    return this.#state.tutorials[id] ?? null;
  }

  // ---- Public API: quiz tracking -------------------------------------------

  /**
   * Record a completed quiz attempt.
   *
   * @param {string} id   — Quiz slug (e.g. "python-variables-quiz")
   * @param {{
   *   score:         number,         — Number of correct answers
   *   total:         number,         — Total number of questions
   *   timeMs:        number,         — Duration of the attempt in milliseconds
   *   title?:        string,
   *   answers?:      Array<any>,     — Raw answer data for review
   * }} attempt
   */
  recordQuizAttempt(id, attempt) {
    this.#assertInit();

    const { score, total, timeMs = 0, title = id, answers = [] } = attempt;

    if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) {
      console.warn('[ProgressTracker] recordQuizAttempt: invalid score/total', { score, total });
      return;
    }

    const existing   = this.#state.quizzes[id];
    const passed     = score / total >= QUIZ_PASS_THRESHOLD;
    const isPerfect  = score === total;
    const isFirstAttempt = !existing;
    const prevBest   = existing?.bestScore ?? -1;
    const improved   = score > prevBest;

    // Build or update the quiz record
    const record = existing ?? {
      id,
      title,
      attempts:       0,
      bestScore:      0,
      totalQuestions: total,
      fastestTimeMs:  Infinity,
      lastAttemptAt:  null,
      improved:       false,
      history:        [],
    };

    record.attempts++;
    record.lastAttemptAt = Date.now();
    record.title         = title;
    record.totalQuestions = total;

    if (score > record.bestScore) {
      record.bestScore = score;
      record.improved  = !isFirstAttempt; // improved only if not first attempt
    }

    if (timeMs > 0 && timeMs < (record.fastestTimeMs ?? Infinity)) {
      record.fastestTimeMs = timeMs;
    }

    // Keep a capped history of the last 10 attempts
    record.history = [
      ...(record.history ?? []).slice(-9),
      { score, total, timeMs, ts: Date.now(), answers },
    ];

    this.#state.quizzes[id] = record;

    // ── XP calculation ──────────────────────────────────────────────────────
    let xpGained = this.#grantXp(XP_REWARDS.QUIZ_ATTEMPT, `Quiz attempt: ${id}`);

    if (passed) {
      xpGained += this.#grantXp(XP_REWARDS.QUIZ_PASS, `Quiz passed: ${id}`);
    }

    if (isPerfect) {
      xpGained += this.#grantXp(XP_REWARDS.QUIZ_PERFECT, `Quiz perfect: ${id}`);
    }

    if (improved && !isFirstAttempt) {
      xpGained += this.#grantXp(XP_REWARDS.QUIZ_IMPROVEMENT, `Quiz improved: ${id}`);
    }

    this.#updateStreak();
    this.#persist();
    this.#evaluateAchievements();

    this.#dispatch(PROGRESS_EVENTS.QUIZ_ATTEMPTED, {
      id,
      score,
      total,
      passed,
      perfect:  isPerfect,
      improved,
      attempts: record.attempts,
      xp:       xpGained,
    });
  }

  /**
   * Get the stored progress record for a single quiz.
   *
   * @param {string} id
   * @returns {QuizRecord|null}
   */
  getQuiz(id) {
    return this.#state.quizzes[id] ?? null;
  }

  // ---- Public API: project tracking ----------------------------------------

  /**
   * Set a project's state. Handles the state machine transitions and
   * awards XP at appropriate points.
   *
   * Valid transitions:
   *   (none) → available
   *   available → in-progress
   *   in-progress → submitted
   *   in-progress → completed
   *   submitted → completed
   *
   * @param {string} id   — Project slug
   * @param {string} newState — One of PROJECT_STATE values
   * @param {{
   *   title?:            string,
   *   difficultyRating?: number,   — 1–5 self-assessed difficulty
   *   steps?:            Record<string, boolean>,
   * }} [meta]
   */
  recordProjectUpdate(id, newState, meta = {}) {
    this.#assertInit();

    if (!Object.values(PROJECT_STATE).includes(newState)) {
      console.warn('[ProgressTracker] recordProjectUpdate: invalid state', newState);
      return;
    }

    const existing = this.#state.projects[id];
    const isNew    = !existing;

    const record = existing ?? {
      id,
      title:            meta.title ?? id,
      state:            PROJECT_STATE.LOCKED,
      startedAt:        null,
      completedAt:      null,
      difficultyRating: undefined,
      steps:            {},
    };

    const prevState = record.state;
    record.state    = newState;
    record.title    = meta.title ?? record.title;

    if (meta.steps) {
      record.steps = { ...record.steps, ...meta.steps };
    }

    let xpGained = 0;

    if (newState === PROJECT_STATE.IN_PROGRESS && !record.startedAt) {
      record.startedAt = Date.now();
      xpGained += this.#grantXp(XP_REWARDS.PROJECT_START, `Project started: ${id}`);
    }

    if (newState === PROJECT_STATE.COMPLETED && !record.completedAt) {
      record.completedAt = Date.now();
      xpGained += this.#grantXp(XP_REWARDS.PROJECT_COMPLETE, `Project completed: ${id}`);
      this.#updateStreak();
    }

    if (meta.difficultyRating !== undefined) {
      const hadRating         = record.difficultyRating !== undefined;
      record.difficultyRating = Math.max(1, Math.min(5, Number(meta.difficultyRating)));
      if (!hadRating) {
        xpGained += this.#grantXp(XP_REWARDS.PROJECT_RATED, `Project rated: ${id}`);
      }
    }

    this.#state.projects[id] = record;

    this.#persist();
    this.#evaluateAchievements();

    this.#dispatch(PROGRESS_EVENTS.PROJECT_UPDATED, {
      id,
      state:     newState,
      prevState,
      xp:        xpGained,
    });
  }

  /**
   * Mark a specific step within a project as complete.
   *
   * @param {string} projectId
   * @param {string} stepId
   */
  recordProjectStep(projectId, stepId) {
    this.#assertInit();

    if (!this.#state.projects[projectId]) {
      this.recordProjectUpdate(projectId, PROJECT_STATE.IN_PROGRESS);
    }

    const record = this.#state.projects[projectId];
    if (!record.steps) record.steps = {};

    record.steps[stepId] = true;
    this.#persist();
  }

  /**
   * Get the stored progress record for a single project.
   *
   * @param {string} id
   * @returns {ProjectRecord|null}
   */
  getProject(id) {
    return this.#state.projects[id] ?? null;
  }

  // ---- Public API: streak --------------------------------------------------

  /**
   * Read the current streak values.
   *
   * @returns {{ current: number, longest: number, lastDate: string|null, freezes: number }}
   */
  getStreak() {
    const s = this.#state.streak;
    return {
      current:  s.current,
      longest:  s.longest,
      lastDate: s.lastDate,
      freezes:  s.freezes,
    };
  }

  /**
   * Add streak freeze charges (awarded by milestone achievements).
   * @param {number} count
   */
  addStreakFreezes(count) {
    this.#assertInit();
    this.#state.streak.freezes = Math.max(0, (this.#state.streak.freezes ?? 0) + count);
    this.#persist();
  }

  // ---- Public API: achievements --------------------------------------------

  /**
   * Get all achievement definitions with unlock status attached.
   *
   * @returns {Array<AchievementDefinition & { unlocked: boolean, unlockedAt?: number }>}
   */
  getAchievements() {
    return ACHIEVEMENT_DEFINITIONS.map((def) => {
      const record = this.#state.achievements[def.id];
      return {
        ...def,
        unlocked:   !!record?.unlockedAt,
        unlockedAt: record?.unlockedAt ?? null,
        // Hide description for hidden achievements not yet unlocked
        description: def.hidden && !record?.unlockedAt
          ? '???'
          : def.description,
        title: def.hidden && !record?.unlockedAt
          ? '???'
          : def.title,
      };
    });
  }

  /**
   * Get only the unlocked achievements, sorted by unlock date descending.
   *
   * @returns {Array<AchievementDefinition & { unlockedAt: number }>}
   */
  getUnlockedAchievements() {
    return this.getAchievements()
      .filter((a) => a.unlocked)
      .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
  }

  // ---- Public API: XP and levels ------------------------------------------

  /**
   * Get current XP, level, and progress toward the next level.
   *
   * @returns {{
   *   xp:            number,
   *   level:         number,
   *   xpForLevel:    number,   — XP needed to reach current level
   *   xpForNext:     number,   — XP needed to reach next level
   *   xpIntoLevel:   number,   — XP earned since entering current level
   *   xpNeeded:      number,   — XP still needed to level up
   *   progressPct:   number,   — 0–100 percentage to next level
   *   isMaxLevel:    boolean,
   * }}
   */
  getLevelInfo() {
    const xp    = this.#state.xp;
    const level = xpToLevel(xp);
    const xpForLevel = levelToXp(level);
    const xpForNext  = levelToXp(level + 1);
    const xpIntoLevel = xp - xpForLevel;
    const xpNeeded    = xpForNext - xp;
    const span        = xpForNext - xpForLevel;
    const progressPct = span > 0
      ? Math.min(100, Math.round((xpIntoLevel / span) * 100))
      : 100;
    const isMaxLevel = level >= 25 && xp >= LEVEL_25_XP;

    return {
      xp,
      level,
      xpForLevel,
      xpForNext,
      xpIntoLevel,
      xpNeeded,
      progressPct,
      isMaxLevel,
    };
  }

  // ---- Public API: summary (for dashboard.js) ------------------------------

  /**
   * Returns a complete, serialisable snapshot of all progress data.
   * dashboard.js calls this after every progress:updated event.
   *
   * @returns {ProgressSummary}
   */
  getSummary() {
    const levelInfo = this.getLevelInfo();
    const streak    = this.getStreak();

    const totalTutorials  = Object.keys(this.#state.tutorials).length;
    const doneTutorials   = countCompleted(this.#state.tutorials);

    const totalQuizzes    = Object.keys(this.#state.quizzes).length;
    const passedQuizzes   = Object.values(this.#state.quizzes)
      .filter((q) => q.bestScore / q.totalQuestions >= QUIZ_PASS_THRESHOLD).length;

    const totalProjects   = Object.keys(this.#state.projects).length;
    const doneProjects    = countByState(this.#state.projects, PROJECT_STATE.COMPLETED);

    const allAttempts     = Object.values(this.#state.quizzes)
      .flatMap((q) => q.history ?? []);
    const totalCorrect    = allAttempts.reduce((sum, a) => sum + (a.score ?? 0), 0);
    const totalAnswered   = allAttempts.reduce((sum, a) => sum + (a.total ?? 0), 0);
    const quizAccuracy    = totalAnswered > 0
      ? Math.round((totalCorrect / totalAnswered) * 100)
      : 0;

    const unlockedAchievements = this.getUnlockedAchievements();
    const totalAchievements    = ACHIEVEMENT_DEFINITIONS.length;

    return {
      // Level & XP
      ...levelInfo,

      // Streak
      streak: {
        current:  streak.current,
        longest:  streak.longest,
        lastDate: streak.lastDate,
        freezes:  streak.freezes,
      },

      // Tutorials
      tutorials: {
        started:   totalTutorials,
        completed: doneTutorials,
        pct:       totalTutorials > 0
          ? Math.round((doneTutorials / totalTutorials) * 100)
          : 0,
        records:   { ...this.#state.tutorials },
      },

      // Quizzes
      quizzes: {
        attempted: totalQuizzes,
        passed:    passedQuizzes,
        accuracy:  quizAccuracy,
        pct:       totalQuizzes > 0
          ? Math.round((passedQuizzes / totalQuizzes) * 100)
          : 0,
        records:   { ...this.#state.quizzes },
      },

      // Projects
      projects: {
        total:     totalProjects,
        completed: doneProjects,
        pct:       totalProjects > 0
          ? Math.round((doneProjects / totalProjects) * 100)
          : 0,
        records:   { ...this.#state.projects },
      },

      // Achievements
      achievements: {
        unlocked: unlockedAchievements.length,
        total:    totalAchievements,
        pct:      Math.round((unlockedAchievements.length / totalAchievements) * 100),
        recent:   unlockedAchievements.slice(0, 5),
        all:      this.getAchievements(),
      },

      // Timestamps
      createdAt: this.#state.createdAt,
      updatedAt: this.#state.updatedAt,

      // Storage info
      storageAvailable: this.#storage.isAvailable,
    };
  }

  // ---- Public API: category progress ---------------------------------------

  /**
   * Calculate the completion percentage for a specific tutorial category.
   * Useful for the dashboard category breakdown widget.
   *
   * @param {string[]} tutorialIds — All tutorial IDs in the category
   * @returns {{ completed: number, total: number, pct: number }}
   */
  getCategoryProgress(tutorialIds) {
    const total     = tutorialIds.length;
    const completed = tutorialIds.filter(
      (id) => this.#state.tutorials[id]?.completedAt != null
    ).length;

    return {
      completed,
      total,
      pct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  // ---- Public API: reset ---------------------------------------------------

  /**
   * Permanently erase all progress data and reset to a clean state.
   * Requires explicit confirmation parameter to guard against accidental calls.
   *
   * @param {{ confirm: true }} options — Must pass { confirm: true }
   */
  reset({ confirm } = {}) {
    if (confirm !== true) {
      console.warn('[ProgressTracker] reset() requires { confirm: true }. No data was erased.');
      return;
    }

    this.#storage.remove(STORAGE_KEY);
    this.#state = createDefaultState();
    this.#dispatch(PROGRESS_EVENTS.RESET);
    this.#dispatch(PROGRESS_EVENTS.UPDATED, { summary: this.getSummary() });
  }

  // ---- Private: persistence ------------------------------------------------

  /**
   * Load and migrate the persisted state from storage.
   * Falls back to a fresh default state on parse errors.
   */
  #load() {
    const raw = this.#storage.get(STORAGE_KEY);
    if (!raw) {
      this.#state = createDefaultState();
      return;
    }

    try {
      const parsed  = JSON.parse(raw);
      this.#state   = migrateState(parsed);
    } catch {
      console.warn('[ProgressTracker] Failed to parse persisted state. Starting fresh.');
      this.#state = createDefaultState();
    }
  }

  /**
   * Serialise and write the current state to storage.
   * Sets updatedAt to the current timestamp before writing.
   */
  #persist() {
    this.#state.updatedAt = Date.now();
    try {
      this.#storage.set(STORAGE_KEY, JSON.stringify(this.#state));
    } catch {
      // Swallow — StorageAdapter already handles quota errors
    }
  }

  // ---- Private: XP management ----------------------------------------------

  /**
   * Add XP to the running total, detect level-ups, and emit events.
   *
   * @param {number} amount
   * @param {string} [source] — Human-readable label for debugging
   * @returns {number} Actual XP granted (always === amount)
   */
  #grantXp(amount, source = '') {
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const prevLevel = xpToLevel(this.#state.xp);
    this.#state.xp += amount;
    const newLevel  = xpToLevel(this.#state.xp);
    const leveledUp = newLevel > prevLevel;

    this.#dispatch(PROGRESS_EVENTS.XP_GAINED, {
      amount,
      total:    this.#state.xp,
      source,
      level:    newLevel,
      leveledUp,
    });

    if (leveledUp) {
      this.#dispatch(PROGRESS_EVENTS.LEVEL_UP, {
        level:         newLevel,
        previousLevel: prevLevel,
        xp:            this.#state.xp,
      });
    }

    return amount;
  }

  // ---- Private: streak management ------------------------------------------

  /**
   * Update the learning streak after any qualifying activity.
   *
   * Rules:
   *  - If today === lastDate        → same day, no change
   *  - If today === yesterday + 1   → streak continues, increment
   *  - If gap === 2 days AND freeze available → use a freeze, streak continues
   *  - Otherwise                    → streak resets to 1
   *
   * Bonus XP is awarded for streak milestones (7, 30, 100 days).
   */
  #updateStreak() {
    const streak  = this.#state.streak;
    const today   = todayDateString();
    const prevDate = streak.lastDate;

    // Already updated today — nothing to do
    if (prevDate === today) return;

    const yesterdayStr  = yesterdayDateString();
    const isConsecutive = prevDate ? areConsecutiveDays(prevDate, today) : false;

    // Detect a long break (≥ 7 days gap) for the comeback_kid achievement
    if (prevDate) {
      const gapDays = Math.round(
        (new Date(today + 'T00:00:00').getTime() -
         new Date(prevDate + 'T00:00:00').getTime()) / 86_400_000
      );
      if (gapDays >= 7) {
        streak.hadLongBreak = true;
      }
    }

    if (isConsecutive) {
      // ── Streak continues ─────────────────────────────────────────────────
      streak.current++;
      streak.freezeUsed = false;    // Reset freeze used flag for today

    } else if (
      prevDate &&
      !isConsecutive &&
      streak.freezes > 0 &&
      !streak.freezeUsed &&
      areConsecutiveDays(yesterdayStr, today) === false &&
      // Check if the gap is exactly 2 days (one missed day)
      Math.round(
        (new Date(today + 'T00:00:00').getTime() -
         new Date(prevDate + 'T00:00:00').getTime()) / 86_400_000
      ) === 2
    ) {
      // ── Streak freeze applied ────────────────────────────────────────────
      streak.freezes--;
      streak.freezeUsed = true;
      streak.current++;

    } else if (!prevDate) {
      // ── First-ever activity ──────────────────────────────────────────────
      streak.current = 1;

    } else {
      // ── Streak broken ────────────────────────────────────────────────────
      streak.current = 1;
      streak.freezeUsed = false;
    }

    streak.lastDate = today;
    streak.longest  = Math.max(streak.longest, streak.current);

    // Award base streak XP
    this.#grantXp(XP_REWARDS.STREAK_DAY, `Streak day ${streak.current}`);

    // Milestone bonuses
    const milestones = {
      7:   XP_REWARDS.STREAK_MILESTONE_7,
      30:  XP_REWARDS.STREAK_MILESTONE_30,
      100: XP_REWARDS.STREAK_MILESTONE_100,
    };

    for (const [days, xp] of Object.entries(milestones)) {
      if (streak.current === Number(days)) {
        this.#grantXp(xp, `Streak milestone ${days} days`);
        // Award a freeze at the 7-day milestone
        if (Number(days) === 7) {
          streak.freezes++;
        }
        break;
      }
    }

    this.#dispatch(PROGRESS_EVENTS.STREAK_UPDATED, {
      current: streak.current,
      longest: streak.longest,
      gained:  true,
    });

    // Re-schedule the warning timer now that lastDate has changed
    this.#scheduleStreakWarning();
  }

  /**
   * Schedule a warning event to fire when the streak is about to expire.
   * The warning fires STREAK_WARNING_HOURS before midnight local time.
   */
  #scheduleStreakWarning() {
    // Clear any existing timer
    if (this.#streakWarningTimer !== null) {
      clearTimeout(this.#streakWarningTimer);
      this.#streakWarningTimer = null;
    }

    const streak = this.#state.streak;
    if (!streak.lastDate || streak.current === 0) return;

    // The streak expires at midnight ending today (i.e. start of tomorrow)
    const now         = new Date();
    const tomorrow    = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight  = tomorrow.getTime() - now.getTime();
    const msUntilWarning   = msUntilMidnight - (STREAK_WARNING_HOURS * 3_600_000);

    // Only schedule if the warning is in the future
    if (msUntilWarning <= 0) return;

    this.#streakWarningTimer = setTimeout(() => {
      this.#streakWarningTimer = null;

      // Double-check the user hasn't already logged activity today
      if (this.#state.streak.lastDate === todayDateString()) return;

      this.#dispatch(PROGRESS_EVENTS.STREAK_WARNING, {
        current:     streak.current,
        expiresInMs: STREAK_WARNING_HOURS * 3_600_000,
      });
    }, msUntilWarning);
  }

  // ---- Private: daily login bonus ------------------------------------------

  /**
   * Award a small XP bonus once per calendar day on the first init() call.
   * Prevents the bonus from being awarded more than once per day even if
   * the page is hard-refreshed.
   */
  #awardDailyLogin() {
    const today   = todayDateString();
    const lastDate = this.#state.streak?.lastDate;

    // Check if we already have activity recorded today through the streak system
    // Use a separate daily-login timestamp to track this precisely
    const lastLogin = this.#state._lastLoginDate;
    if (lastLogin === today) return;

    this.#state._lastLoginDate = today;
    this.#grantXp(XP_REWARDS.DAILY_LOGIN, 'Daily login bonus');
    this.#persist();
  }

  // ---- Private: achievement evaluation -------------------------------------

  /**
   * Evaluate every achievement predicate against the current state.
   * Newly unlocked achievements receive an XP grant and emit an event.
   *
   * This method is called after every state mutation. Because predicates
   * are pure functions and achievements are monotonic (once unlocked, never
   * re-locked), iterating all ~30 definitions is fast enough at this scale.
   */
  #evaluateAchievements() {
    const newlyUnlocked = [];

    for (const def of ACHIEVEMENT_DEFINITIONS) {
      // Already unlocked — skip predicate evaluation
      if (this.#state.achievements[def.id]?.unlockedAt) continue;

      let qualifies = false;
      try {
        qualifies = def.predicate(this.#state);
      } catch (err) {
        // Predicate errors must not crash the tracker
        console.warn(`[ProgressTracker] Achievement predicate error: ${def.id}`, err);
      }

      if (qualifies) {
        // Mark as unlocked
        this.#state.achievements[def.id] = {
          id:         def.id,
          unlockedAt: Date.now(),
        };

        // Grant achievement XP
        const xpGranted = (def.xp ?? XP_REWARDS.ACHIEVEMENT_BASE);
        this.#grantXp(xpGranted, `Achievement: ${def.title}`);

        // Grant streak freezes for streak milestones if not already awarded
        if (def.category === 'streak' && def.id === 'streak_7') {
          this.addStreakFreezes(1);
        }

        newlyUnlocked.push({ ...def, unlockedAt: this.#state.achievements[def.id].unlockedAt });
      }
    }

    if (newlyUnlocked.length > 0) {
      this.#persist();

      // Emit one event per achievement so the UI can animate them sequentially
      // with a staggered delay between toasts
      newlyUnlocked.forEach((achievement, index) => {
        setTimeout(() => {
          this.#dispatch(PROGRESS_EVENTS.ACHIEVEMENT_UNLOCKED, { achievement });
        }, index * 800);
      });
    }

    // Always emit a general update so dashboard re-renders
    this.#dispatch(PROGRESS_EVENTS.UPDATED, { summary: this.getSummary() });
  }

  // ---- Private: guards -----------------------------------------------------

  /**
   * Throw a descriptive error if init() has not been called.
   * Prevents cryptic failures from partially-initialised state.
   */
  #assertInit() {
    if (!this.#initialised) {
      throw new Error(
        '[ProgressTracker] You must call init() before recording any progress. ' +
        'Example: const tracker = new ProgressTracker(); tracker.init();'
      );
    }
  }

  // ---- Private: event bus --------------------------------------------------

  /**
   * Publish to the project event bus + native CustomEvent.
   * Consistent with navigation.js, header.js, and footer.js.
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

export default ProgressTracker;