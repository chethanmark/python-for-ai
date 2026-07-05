/**
 * =============================================================================
 * LESSON PLAYER MODULE
 * scripts/pages/lesson-player.js
 * -----------------------------------------------------------------------------
 * Central interactive learning interface for the Python for AI educational
 * platform. Delivers the full lesson experience: structured content rendering,
 * an embedded code editor, inline quiz integration, note-taking, bookmarking,
 * progress tracking, reading-progress indicators, and completion detection —
 * all in a single self-contained ES module.
 *
 * ARCHITECTURE:
 *   LessonPlayer (default export)
 *     ├─ EditorMount        — lightweight wrapper that creates/destroys a
 *     │                       CodeEditor instance inside each interactive
 *     │                       code block. Multiple editors can exist
 *     │                       simultaneously on a single lesson page.
 *     └─ ReadingProgress    — IntersectionObserver-based scroll tracker that
 *                             estimates reading progress and fires
 *                             lesson:progress events at 25 / 50 / 75 / 100%.
 *
 * SECTIONS (rendered in document order):
 *   1.  Lesson Header          — title, author, estimated time, completion badge
 *   2.  Breadcrumb Navigation  — course → chapter → lesson trail
 *   3.  Progress Indicator     — horizontal bar tracking section completion
 *   4.  Lesson Overview        — abstract and key-takeaway bullets
 *   5.  Learning Objectives    — ordered list of measurable outcomes
 *   6.  Video Placeholder      — responsive 16:9 iframe slot (URL from lesson data)
 *   7.  Lesson Content         — full MDX-style content blocks rendered as HTML:
 *                                  text, headings, code blocks, callouts, images
 *   8.  Interactive Code       — expandable code examples with syntax hooks
 *   9.  Embedded Code Editor   — live CodeEditor instance wired to Pyodide
 *  10.  Run Controls           — Run, Reset, Clear Output buttons + output panel
 *  11.  Quiz Section           — inline knowledge-check quiz (QuizEngine mount)
 *  12.  Notes Panel            — personal notes textarea with autosave
 *  13.  Resource Links         — further reading, docs, external links
 *  14.  Prev / Next Navigation — inter-lesson navigation with keyboard shortcut
 *  15.  Completion Banner      — celebratory UI rendered when all sections pass
 *
 * LESSON DATA CONTRACT:
 *   LessonPlayer accepts lesson data from three sources (priority order):
 *   1. Injected lesson object at construction time (config.lesson)
 *   2. Dynamic import from /data/lessons/{id}.js
 *   3. URL route parameter (:lessonId) parsed from router context
 *
 *   A lesson object must conform to the LessonData typedef (see below).
 *
 * PROGRESS TRACKING:
 *   Progress is reported to the platform through two mechanisms:
 *   1. ProgressTracker.recordTutorialProgress(id, { sectionIndex, timeOnPage })
 *      is called every time the user completes a content section.
 *   2. ProgressTracker.recordTutorialComplete(id, { timeOnPage }) is called
 *      when the completion detection algorithm determines that the user has
 *      read all required sections AND passed the inline quiz (if present).
 *
 * REACTIVE UPDATES:
 *   • router:afterNavigate → load a different lesson when the route changes
 *   • progress:updated     → refresh the completion badge and progress bar
 *   • quiz:submitted       → handle quiz completion; check for full completion
 *   • editor:run           → receive code output and render in the output panel
 *   • state:updated        → refresh user name / theme
 *   • theme:changed        → toggle dark-mode root class
 *
 * EVENT EMISSIONS:
 *   lesson:loaded      { id, title, totalSections }
 *   lesson:progress    { id, sectionIndex, pct, timeOnPage }
 *   lesson:completed   { id, title, timeOnPage, xp }
 *   lesson:noteSaved   { id, length }
 *   lesson:bookmark    { id, bookmarked }
 *   lesson:destroyed   { id }
 *
 * KEYBOARD SHORTCUTS (when focus is not inside an input/textarea):
 *   ArrowLeft / ← — navigate to previous lesson
 *   ArrowRight / → — navigate to next lesson
 *   Ctrl + B       — toggle bookmark
 *   Ctrl + Enter   — run code (if editor focused)
 *   F              — toggle fullscreen reading mode
 *   Escape         — exit fullscreen reading mode
 *
 * ACCESSIBILITY:
 *   • Every section has a landmark role and aria-labelledby
 *   • ARIA live region announces progress milestones and completion
 *   • Focus is moved to the lesson H1 on load
 *   • Reduced motion: progress bar animation and completion banner
 *     entrance are instant
 *   • High-contrast: all colours use CSS custom properties
 *   • Reading mode provides a focusable, dismissible overlay
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/tutorials/:lessonId',
 *     title:     (ctx) => `Lesson — ${ctx.params.lessonId}`,
 *     component: () => import('./pages/lesson-player.js'),
 *   }
 *
 * EXPORTS:
 *   LessonPlayer    — primary class (default export)
 *   LESSON_EVENTS   — event name constants
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
 * Event names emitted by the lesson player.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LESSON_EVENTS = Object.freeze({
  LOADED:     'lesson:loaded',
  PROGRESS:   'lesson:progress',
  COMPLETED:  'lesson:completed',
  NOTE_SAVED: 'lesson:noteSaved',
  BOOKMARK:   'lesson:bookmark',
  DESTROYED:  'lesson:destroyed',
});

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  // Root
  ROOT:               'lesson-player',
  ROOT_DARK:          'lesson-player--dark',
  ROOT_REDUCED:       'lesson-player--reduced-motion',
  ROOT_FULLSCREEN:    'lesson-player--fullscreen',
  ROOT_COMPLETE:      'lesson-player--complete',

  // Live region
  LIVE:               'lesson-player__live',

  // Layout
  LAYOUT:             'lesson-player__layout',
  MAIN:               'lesson-player__main',
  ASIDE:              'lesson-player__aside',

  // Lesson header
  HEADER:             'lesson-header',
  HEADER_INNER:       'lesson-header__inner',
  HEADER_META:        'lesson-header__meta',
  HEADER_BADGE:       'lesson-header__badge',
  HEADER_BADGE_DONE:  'lesson-header__badge--done',
  HEADER_TITLE:       'lesson-header__title',
  HEADER_AUTHOR:      'lesson-header__author',
  HEADER_STATS:       'lesson-header__stats',
  HEADER_STAT:        'lesson-header__stat',
  HEADER_ACTIONS:     'lesson-header__actions',
  HEADER_BTN:         'lesson-header__btn',
  HEADER_BTN_ACTIVE:  'lesson-header__btn--active',

  // Breadcrumb
  BREADCRUMB:         'lesson-breadcrumb',
  BREADCRUMB_LIST:    'lesson-breadcrumb__list',
  BREADCRUMB_ITEM:    'lesson-breadcrumb__item',
  BREADCRUMB_SEP:     'lesson-breadcrumb__sep',
  BREADCRUMB_LINK:    'lesson-breadcrumb__link',
  BREADCRUMB_CURRENT: 'lesson-breadcrumb__current',

  // Progress indicator
  PROGRESS:           'lesson-progress',
  PROGRESS_INNER:     'lesson-progress__inner',
  PROGRESS_BAR:       'lesson-progress__bar',
  PROGRESS_FILL:      'lesson-progress__fill',
  PROGRESS_LABEL:     'lesson-progress__label',
  PROGRESS_SECTIONS:  'lesson-progress__sections',
  PROGRESS_DOT:       'lesson-progress__dot',
  PROGRESS_DOT_DONE:  'lesson-progress__dot--done',
  PROGRESS_DOT_CUR:   'lesson-progress__dot--current',

  // Overview
  OVERVIEW:           'lesson-overview',
  OVERVIEW_ABSTRACT:  'lesson-overview__abstract',
  OVERVIEW_TAKEAWAYS: 'lesson-overview__takeaways',
  OVERVIEW_TAKEAWAY:  'lesson-overview__takeaway',

  // Learning objectives
  OBJECTIVES:         'lesson-objectives',
  OBJECTIVES_LIST:    'lesson-objectives__list',
  OBJECTIVES_ITEM:    'lesson-objectives__item',

  // Video placeholder
  VIDEO:              'lesson-video',
  VIDEO_WRAP:         'lesson-video__wrap',
  VIDEO_IFRAME:       'lesson-video__iframe',
  VIDEO_PLACEHOLDER:  'lesson-video__placeholder',
  VIDEO_PLAY_BTN:     'lesson-video__play-btn',

  // Content area
  CONTENT:            'lesson-content',
  CONTENT_SECTION:    'lesson-content__section',
  CONTENT_HEADING:    'lesson-content__heading',
  CONTENT_PARA:       'lesson-content__para',
  CONTENT_CALLOUT:    'lesson-content__callout',
  CONTENT_CALLOUT_INFO:   'lesson-content__callout--info',
  CONTENT_CALLOUT_TIP:    'lesson-content__callout--tip',
  CONTENT_CALLOUT_WARN:   'lesson-content__callout--warning',
  CONTENT_CALLOUT_DANGER: 'lesson-content__callout--danger',
  CONTENT_IMAGE:      'lesson-content__image',
  CONTENT_CAPTION:    'lesson-content__caption',

  // Code blocks (display only)
  CODE_BLOCK:         'lesson-code-block',
  CODE_BLOCK_HEADER:  'lesson-code-block__header',
  CODE_BLOCK_LANG:    'lesson-code-block__lang',
  CODE_BLOCK_ACTIONS: 'lesson-code-block__actions',
  CODE_BLOCK_BTN:     'lesson-code-block__btn',
  CODE_BLOCK_PRE:     'lesson-code-block__pre',
  CODE_BLOCK_EXPANDED:'lesson-code-block--expanded',
  CODE_BLOCK_COLLAPSED:'lesson-code-block--collapsed',

  // Embedded editor
  EDITOR_WRAP:        'lesson-editor',
  EDITOR_HEADER:      'lesson-editor__header',
  EDITOR_TITLE:       'lesson-editor__title',
  EDITOR_TABS:        'lesson-editor__tabs',
  EDITOR_TAB:         'lesson-editor__tab',
  EDITOR_TAB_ACTIVE:  'lesson-editor__tab--active',
  EDITOR_CONTAINER:   'lesson-editor__container',
  EDITOR_OUTPUT:      'lesson-editor__output',
  EDITOR_OUTPUT_LINE: 'lesson-editor__output-line',
  EDITOR_OUTPUT_ERR:  'lesson-editor__output-line--error',
  EDITOR_OUTPUT_EMPTY:'lesson-editor__output-empty',
  EDITOR_CONTROLS:    'lesson-editor__controls',
  EDITOR_BTN_RUN:     'lesson-editor__btn-run',
  EDITOR_BTN_RESET:   'lesson-editor__btn-reset',
  EDITOR_BTN_CLEAR:   'lesson-editor__btn-clear',
  EDITOR_STATUS:      'lesson-editor__status',

  // Quiz section
  QUIZ_WRAP:          'lesson-quiz',
  QUIZ_HEADING:       'lesson-quiz__heading',
  QUIZ_CONTAINER:     'lesson-quiz__container',

  // Notes panel
  NOTES:              'lesson-notes',
  NOTES_HEADER:       'lesson-notes__header',
  NOTES_TITLE:        'lesson-notes__title',
  NOTES_TEXTAREA:     'lesson-notes__textarea',
  NOTES_FOOTER:       'lesson-notes__footer',
  NOTES_COUNT:        'lesson-notes__count',
  NOTES_SAVED:        'lesson-notes__saved',

  // Resources
  RESOURCES:          'lesson-resources',
  RESOURCES_LIST:     'lesson-resources__list',
  RESOURCES_ITEM:     'lesson-resources__item',
  RESOURCES_LINK:     'lesson-resources__link',
  RESOURCES_ICON:     'lesson-resources__icon',

  // Prev / Next nav
  LESSON_NAV:         'lesson-nav',
  LESSON_NAV_PREV:    'lesson-nav__prev',
  LESSON_NAV_NEXT:    'lesson-nav__next',
  LESSON_NAV_BTN:     'lesson-nav__btn',
  LESSON_NAV_DIR:     'lesson-nav__dir',
  LESSON_NAV_TITLE:   'lesson-nav__title',

  // Completion banner
  COMPLETE_BANNER:    'lesson-complete',
  COMPLETE_ICON:      'lesson-complete__icon',
  COMPLETE_HEADING:   'lesson-complete__heading',
  COMPLETE_SUB:       'lesson-complete__sub',
  COMPLETE_XP:        'lesson-complete__xp',
  COMPLETE_ACTIONS:   'lesson-complete__actions',
  COMPLETE_BTN_NEXT:  'lesson-complete__btn-next',
  COMPLETE_BTN_QUIZ:  'lesson-complete__btn-quiz',
  COMPLETE_BTN_REVIEW:'lesson-complete__btn-review',

  // Table of contents (aside)
  TOC:                'lesson-toc',
  TOC_TITLE:          'lesson-toc__title',
  TOC_LIST:           'lesson-toc__list',
  TOC_ITEM:           'lesson-toc__item',
  TOC_LINK:           'lesson-toc__link',
  TOC_LINK_ACTIVE:    'lesson-toc__link--active',

  // Reading time
  READING_TIME:       'lesson-reading-time',
  READING_PROGRESS:   'lesson-reading-progress',

  // Skeleton
  SKELETON:           'lesson-skeleton',
  SKELETON_LINE:      'lesson-skeleton__line',
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Autosave debounce delay for notes (ms) */
const NOTE_AUTOSAVE_DELAY = 800;

/** Progress milestone percentages that trigger an announcement */
const PROGRESS_MILESTONES = Object.freeze([25, 50, 75, 100]);

/** Estimated words-per-minute for reading time calculation */
const WORDS_PER_MINUTE = 200;

/** localStorage key prefix for lesson notes */
const NOTES_KEY_PREFIX = 'pyai-lesson-notes-';

/** localStorage key prefix for bookmark state */
const BOOKMARK_KEY_PREFIX = 'pyai-lesson-bookmark-';

/** localStorage key prefix for lesson scroll position */
const SCROLL_KEY_PREFIX = 'pyai-lesson-scroll-';

// ---------------------------------------------------------------------------
// Lesson catalogue (static seed; in production fetched from /data/lessons/)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:               string,
 *   title:            string,
 *   description:      string,
 *   author:           string,
 *   course:           string,
 *   chapter:          string,
 *   difficulty:       'beginner'|'intermediate'|'advanced',
 *   estimatedMinutes: number,
 *   xpReward:         number,
 *   objectives:       string[],
 *   takeaways:        string[],
 *   videoUrl:         string|null,
 *   sections:         LessonSection[],
 *   starterCode:      string,
 *   quizId:           string|null,
 *   resources:        LessonResource[],
 *   prev:             { id: string, title: string } | null,
 *   next:             { id: string, title: string } | null,
 *   tags:             string[],
 *   publishedAt:      number,
 * }} LessonData
 */

/**
 * @typedef {{
 *   type:     'text'|'heading'|'code'|'callout'|'image'|'editor',
 *   content:  string,
 *   level?:   2|3|4,
 *   language?: string,
 *   variant?: 'info'|'tip'|'warning'|'danger',
 *   alt?:     string,
 *   caption?: string,
 *   id?:      string,
 * }} LessonSection
 */

/**
 * @typedef {{
 *   title: string,
 *   url:   string,
 *   type:  'doc'|'video'|'article'|'github'|'dataset',
 * }} LessonResource
 */

/**
 * Minimal in-memory lesson registry.
 * In production, each lesson is a separate JSON / JS data file that is
 * dynamically imported. This registry provides a realistic seed for the
 * development environment and for testing.
 *
 * @type {Map<string, LessonData>}
 */
const LESSON_REGISTRY = new Map([
  [
    'python-variables',
    {
      id:               'python-variables',
      title:            'Variables and Data Types',
      description:      'Understand how Python stores data in memory and learn to work with integers, floats, strings, and booleans confidently.',
      author:           'Python for AI Team',
      course:           'Python Basics',
      chapter:          'Getting Started',
      difficulty:       'beginner',
      estimatedMinutes: 20,
      xpReward:         50,
      objectives: [
        'Declare and reassign variables using correct Python syntax.',
        'Distinguish between int, float, str, and bool types.',
        'Use type() and isinstance() to inspect values.',
        'Apply basic type coercion with int(), float(), and str().',
      ],
      takeaways: [
        'Python is dynamically typed — variables can change type.',
        'Naming conventions: snake_case for variables, UPPER_CASE for constants.',
        'Everything in Python is an object with a type and an identity.',
      ],
      videoUrl: null,
      sections: [
        {
          type:    'heading',
          level:   2,
          content: 'What is a Variable?',
          id:      'what-is-a-variable',
        },
        {
          type:    'text',
          content: 'A variable is a named reference to a value stored in memory. In Python you do not need to declare a type — the interpreter infers it from the value you assign.',
        },
        {
          type:    'callout',
          variant: 'info',
          content: 'Python uses dynamic typing: the same variable can hold an integer on one line and a string on the next.',
        },
        {
          type:     'code',
          language: 'python',
          content:  'age = 25\nname = "Ada"\nlearning = True\npi = 3.14159\n\nprint(type(age))      # <class \'int\'>\nprint(type(name))     # <class \'str\'>\nprint(type(learning)) # <class \'bool\'>\nprint(type(pi))       # <class \'float\'>\n',
        },
        {
          type:    'heading',
          level:   2,
          content: 'Naming Rules',
          id:      'naming-rules',
        },
        {
          type:    'text',
          content: 'Variable names must start with a letter or underscore, may contain letters, digits, and underscores, and are case-sensitive. The PEP 8 style guide recommends lowercase_with_underscores for variable names.',
        },
        {
          type:    'callout',
          variant: 'tip',
          content: 'Use descriptive names: learning_rate is far more readable than lr when you revisit your code in three months.',
        },
        {
          type:     'code',
          language: 'python',
          content:  '# Good names\nlearning_rate = 0.001\nmax_epochs = 100\nmodel_name = "bert-base"\n\n# Python is case-sensitive\nvalue = 10\nValue = 20\nprint(value, Value)  # 10 20 — two different variables\n',
        },
        {
          type:    'heading',
          level:   2,
          content: 'Try It Yourself',
          id:      'try-it-yourself',
        },
        {
          type:    'text',
          content: 'Use the editor below to experiment. Assign your name, age, and whether you enjoy coding to variables, then print them all in a single formatted string.',
        },
        {
          type:     'editor',
          content:  '# Assign your own values\nyour_name = ""\nyour_age = 0\nyou_enjoy_coding = True\n\n# Print a formatted message\nprint(f"Hi, I\'m {your_name}, I\'m {your_age} years old.")\nprint(f"Enjoys coding: {you_enjoy_coding}")\n',
          id:       'lesson-editor-main',
        },
        {
          type:    'callout',
          variant: 'warning',
          content: 'Avoid using Python built-in names as variable names: list, dict, type, id, input, print. Shadowing a built-in will cause confusing bugs.',
        },
      ],
      starterCode:  '# Python Variables — Lesson Starter\nname = ""\nage = 0\n\nprint(name, age)\n',
      quizId:       'python-variables-quiz',
      resources: [
        { title: 'Python Docs — Variables', url: 'https://docs.python.org/3/reference/simple_stmts.html#assignment-statements', type: 'doc'     },
        { title: 'PEP 8 Style Guide',       url: 'https://peps.python.org/pep-0008/',                                          type: 'doc'     },
        { title: 'Built-in Types',          url: 'https://docs.python.org/3/library/stdtypes.html',                             type: 'doc'     },
      ],
      prev: null,
      next: { id: 'python-functions', title: 'Functions & Scope' },
      tags: ['python', 'variables', 'data-types', 'basics'],
      publishedAt: 1_700_000_000_000,
    },
  ],
  [
    'python-functions',
    {
      id:               'python-functions',
      title:            'Functions & Scope',
      description:      'Write reusable, well-structured functions and understand how Python resolves variable names through the LEGB rule.',
      author:           'Python for AI Team',
      course:           'Python Basics',
      chapter:          'Core Concepts',
      difficulty:       'beginner',
      estimatedMinutes: 25,
      xpReward:         50,
      objectives: [
        'Define functions with positional and keyword arguments.',
        'Use *args and **kwargs for flexible function signatures.',
        'Explain the LEGB scope resolution rule.',
        'Write and apply a simple decorator.',
      ],
      takeaways: [
        'Functions are first-class objects in Python.',
        'Default argument values are evaluated once at definition time.',
        'Closures capture variables from enclosing scopes.',
      ],
      videoUrl: null,
      sections: [
        {
          type:    'heading',
          level:   2,
          content: 'Defining a Function',
          id:      'defining-a-function',
        },
        {
          type:    'text',
          content: 'Functions are defined with the def keyword followed by the function name, parenthesised parameters, and a colon. The body is indented.',
        },
        {
          type:     'code',
          language: 'python',
          content:  'def greet(name, greeting="Hello"):\n    """Return a personalised greeting string."""\n    return f"{greeting}, {name}!"\n\nprint(greet("Ada"))              # Hello, Ada!\nprint(greet("Turing", "Hi"))     # Hi, Turing!\n',
        },
        {
          type:    'heading',
          level:   2,
          content: 'Scope and LEGB',
          id:      'scope-and-legb',
        },
        {
          type:    'text',
          content: 'Python resolves names in the order: Local → Enclosing → Global → Built-in (LEGB). The nonlocal and global keywords let you write to outer scopes.',
        },
        {
          type:     'editor',
          content:  'x = "global"\n\ndef outer():\n    x = "enclosing"\n    def inner():\n        x = "local"\n        print(x)  # local\n    inner()\n    print(x)  # enclosing\n\nouter()\nprint(x)  # global\n',
          id:       'lesson-editor-scope',
        },
      ],
      starterCode:  '# Functions — Lesson Starter\ndef add(a, b):\n    return a + b\n\nprint(add(3, 4))\n',
      quizId:       null,
      resources: [
        { title: 'Python Docs — Functions', url: 'https://docs.python.org/3/reference/compound_stmts.html#function-definitions', type: 'doc' },
      ],
      prev: { id: 'python-variables', title: 'Variables and Data Types' },
      next: { id: 'python-oop',       title: 'Object-Oriented Python'   },
      tags: ['python', 'functions', 'scope', 'decorators'],
      publishedAt: 1_700_100_000_000,
    },
  ],
]);

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
    timer = setTimeout(() => { timer = null; lastArgs = null; fn(...args); }, ms);
  };
  d.cancel = () => { clearTimeout(timer); timer = null; lastArgs = null; };
  d.flush  = () => {
    if (timer !== null) {
      clearTimeout(timer); timer = null;
      if (lastArgs) fn(...lastArgs); lastArgs = null;
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
 * Estimate reading time for a lesson in minutes.
 *
 * @param {LessonData} lesson
 * @returns {number}
 */
function estimateReadingMinutes(lesson) {
  const wordCount = lesson.sections
    .filter((s) => s.type === 'text' || s.type === 'heading')
    .reduce((sum, s) => sum + s.content.split(/\s+/).length, 0);
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/**
 * Format a number of minutes as a human-readable string.
 * @param {number} minutes
 * @returns {string}
 */
function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Determine the appropriate callout CSS class for a callout variant.
 * @param {string} variant
 * @returns {string}
 */
function calloutClass(variant) {
  return {
    info:    CSS.CONTENT_CALLOUT_INFO,
    tip:     CSS.CONTENT_CALLOUT_TIP,
    warning: CSS.CONTENT_CALLOUT_WARN,
    danger:  CSS.CONTENT_CALLOUT_DANGER,
  }[variant] ?? CSS.CONTENT_CALLOUT_INFO;
}

/**
 * Icon for a callout variant.
 * @param {string} variant
 * @returns {string}
 */
function calloutIcon(variant) {
  return { info: 'ℹ️', tip: '💡', warning: '⚠️', danger: '🚨' }[variant] ?? 'ℹ️';
}

/**
 * Icon for a resource type.
 * @param {string} type
 * @returns {string}
 */
function resourceIcon(type) {
  return { doc: '📄', video: '▶️', article: '📰', github: '🐙', dataset: '📦' }[type] ?? '🔗';
}

/**
 * Safe localStorage read.
 * @param {string} key
 * @returns {string|null}
 */
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Safe localStorage write.
 * @param {string} key
 * @param {string} value
 */
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota / blocked */ }
}

/**
 * Safe localStorage delete.
 * @param {string} key
 */
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// EditorMount — manages a single CodeEditor instance lifecycle
// ---------------------------------------------------------------------------

/**
 * Thin wrapper that mounts one CodeEditor into a designated container element
 * and tears it down cleanly on destroy().
 *
 * Designed so that multiple editors can coexist on a single lesson page
 * (one per 'editor' section block) without interfering with each other.
 */
class EditorMount {
  /** @type {import('../components/code-editor.js').CodeEditor|null} */
  #instance = null;

  /** @type {string} */
  #containerId;

  /** @type {string} */
  #storageKey;

  /**
   * @param {string} containerId  — ID of the DOM element to mount into
   * @param {string} storageKey   — localStorage draft key
   */
  constructor(containerId, storageKey) {
    this.#containerId = containerId;
    this.#storageKey  = storageKey;
  }

  /**
   * Dynamically import and mount the CodeEditor.
   * Fails gracefully if the import fails (e.g. during testing).
   *
   * @param {string} initialCode
   * @returns {Promise<void>}
   */
  async mount(initialCode = '') {
    try {
      const { default: CodeEditor } = await import('../components/code-editor.js');
      this.#instance = new CodeEditor({
        containerId:     this.#containerId,
        storageKey:      this.#storageKey,
        language:        'python',
        autosave:        true,
        autosaveDelay:   1500,
        showToolbar:     true,
        showLineNumbers: true,
        showStatusBar:   true,
        fontSize:        14,
        wordWrap:        false,
      });
      this.#instance.load(initialCode);
      this.#instance.mount();
    } catch (err) {
      console.warn('[LessonPlayer] CodeEditor import failed:', err);
    }
  }

  /**
   * Return the current value from the editor.
   * @returns {string}
   */
  getValue() {
    return this.#instance?.getValue() ?? '';
  }

  /**
   * Destroy the CodeEditor instance.
   */
  destroy() {
    try { this.#instance?.destroy(); } catch { /* swallow */ }
    this.#instance = null;
  }
}

// ---------------------------------------------------------------------------
// ReadingProgress — IntersectionObserver scroll tracker
// ---------------------------------------------------------------------------

/**
 * Watches content section elements and tracks which percentage of the
 * lesson content has been scrolled past.
 *
 * Emits a callback at configurable milestone percentages (25, 50, 75, 100).
 * Cleans up its observer on destroy().
 */
class ReadingProgress {
  /** @type {IntersectionObserver|null} */
  #observer = null;

  /** @type {Map<Element, boolean>} */
  #seen = new Map();

  /** @type {number} */
  #total = 0;

  /** @type {Set<number>} — milestones already fired */
  #fired = new Set();

  /** @type {(pct: number) => void} */
  #onMilestone;

  /**
   * @param {(pct: number) => void} onMilestone
   */
  constructor(onMilestone) {
    this.#onMilestone = onMilestone;
  }

  /**
   * Observe all section elements within the given root.
   *
   * @param {HTMLElement} root
   * @param {string}      sectionSelector — CSS selector for trackable elements
   */
  observe(root, sectionSelector) {
    const sections = [...root.querySelectorAll(sectionSelector)];
    this.#total    = sections.length;
    this.#seen     = new Map(sections.map((el) => [el, false]));
    this.#fired    = new Set();

    if (sections.length === 0) return;

    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#seen.set(entry.target, true);
          }
        }
        this.#checkMilestones();
      },
      { threshold: 0.25 }  // element is ≥25% visible before being counted
    );

    sections.forEach((s) => this.#observer?.observe(s));
  }

  /** Disconnect the observer and release references. */
  destroy() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#seen.clear();
  }

  /**
   * Compute the current percentage of sections seen and fire milestone callbacks.
   */
  #checkMilestones() {
    if (this.#total === 0) return;
    const seen   = [...this.#seen.values()].filter(Boolean).length;
    const pct    = Math.round((seen / this.#total) * 100);

    for (const milestone of PROGRESS_MILESTONES) {
      if (pct >= milestone && !this.#fired.has(milestone)) {
        this.#fired.add(milestone);
        this.#onMilestone(milestone);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LessonPlayer — primary class
// ---------------------------------------------------------------------------

/**
 * Lesson player page module.
 *
 * Lifecycle:
 *   1. constructor(config)   — no DOM side-effects
 *   2. initialize()          — read route param, resolve lesson data
 *   3. mount()               — render HTML, mount editors, attach events
 *   4. loadLesson(id)        — load and render a different lesson in place
 *   5. saveProgress()        — persist scroll position and tracker update
 *   6. markComplete()        — trigger completion banner, emit lesson:completed
 *   7. refresh()             — refresh progress-dependent UI regions
 *   8. destroy()             — clean up all state, editors, observers, listeners
 */
export default class LessonPlayer {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   containerId: string,
   *   tracker:     object|null,
   *   router:      object|null,
   *   store:       object|null,
   *   lesson:      LessonData|null,
   *   lessonId:    string|null,
   * }}
   */
  #config;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean}         */ #mounted     = false;
  /** @type {boolean}         */ #destroyed   = false;
  /** @type {string}          */ #theme       = 'light';
  /** @type {boolean}         */ #fullscreen  = false;
  /** @type {boolean}         */ #complete    = false;
  /** @type {boolean}         */ #bookmarked  = false;
  /** @type {boolean}         */ #quizPassed  = false;

  /** @type {LessonData|null} */ #lesson      = null;
  /** @type {number}          */ #startTime   = 0;
  /** @type {number}          */ #readingPct  = 0;
  /** @type {number}          */ #currentSection = 0;

  // ---- Sub-systems ---------------------------------------------------------

  /** @type {Map<string, EditorMount>} — containerId → EditorMount */
  #editors = new Map();

  /** @type {ReadingProgress|null} */
  #readingProgress = null;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}      */ #root        = null;
  /** @type {HTMLElement|null}      */ #liveRegion  = null;
  /** @type {HTMLTextAreaElement|null} */ #notesEl  = null;

  // ---- Debounced handlers --------------------------------------------------

  /** @type {Function & { cancel: () => void, flush: () => void }} */
  #debouncedNoteSave;

  /** @type {Function & { cancel: () => void }} */
  #debouncedProgress;

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
   *   lesson?:      LessonData|null,
   *   lessonId?:    string|null,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId: config.containerId ?? 'app-outlet',
      tracker:     config.tracker     ?? null,
      router:      config.router      ?? null,
      store:       config.store       ?? null,
      lesson:      config.lesson      ?? null,
      lessonId:    config.lessonId    ?? null,
    });

    this.#debouncedNoteSave = debounce(
      () => this.#persistNotes(),
      NOTE_AUTOSAVE_DELAY
    );

    this.#debouncedProgress = debounce(
      () => this.saveProgress(),
      1000
    );
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new LessonPlayer({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker  ?? null,
      router:      ctx?.meta?.router   ?? null,
      store:       ctx?.meta?.store    ?? null,
      lessonId:    ctx?.params?.lessonId ?? null,
    });
    outlet.__lessonPlayer = instance;
    instance.#root        = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__lessonPlayer?.destroy();
    delete outlet.__lessonPlayer;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve lesson data and read saved state from storage.
   *
   * @returns {LessonPlayer} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    // Resolve theme
    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    // Resolve lesson data (precedence: config.lesson > config.lessonId > URL param)
    this.#lesson = this.#config.lesson
      ?? this.#resolveLessonById(
           this.#config.lessonId
           ?? this.#extractLessonIdFromUrl()
         );

    if (!this.#lesson) return this;

    // Restore bookmark state
    const savedBookmark = lsGet(`${BOOKMARK_KEY_PREFIX}${this.#lesson.id}`);
    this.#bookmarked    = savedBookmark === 'true';

    return this;
  }

  /**
   * Render the lesson into the container and attach all event listeners.
   *
   * @returns {LessonPlayer} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[LessonPlayer] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.#startTime = Date.now();

    if (!this.#lesson) {
      this.#renderErrorState('Lesson not found.');
      return this;
    }

    this.render();
    this.#attachEventListeners();
    this.#mountEditors();
    this.#startReadingProgress();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(LESSON_EVENTS.LOADED, {
      id:            this.#lesson.id,
      title:         this.#lesson.title,
      totalSections: this.#lesson.sections.length,
    });

    this.#announce(`Lesson loaded: ${this.#lesson.title}`);
    return this;
  }

  /**
   * Generate and inject the complete lesson page HTML.
   *
   * @returns {LessonPlayer} this
   */
  render() {
    if (!this.#root || !this.#lesson) return this;

    const lesson      = this.#lesson;
    const isDark      = this.#theme === 'dark';
    const reduced     = prefersReducedMotion();

    this.#root.className = [
      CSS.ROOT,
      isDark   ? CSS.ROOT_DARK     : '',
      reduced  ? CSS.ROOT_REDUCED  : '',
      this.#complete ? CSS.ROOT_COMPLETE : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', `Lesson: ${lesson.title}`);

    const readMinutes = estimateReadingMinutes(lesson);

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      ${this.#renderHeader(lesson, readMinutes)}
      ${this.#renderBreadcrumb(lesson)}
      ${this.#renderProgress(lesson)}
      ${this.#renderLayout(lesson)}
      ${this.#renderLessonNav(lesson)}
      ${this.#complete ? this.#renderCompleteBanner(lesson) : ''}
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);
    this.#notesEl    = this.#root.querySelector(`.${CSS.NOTES_TEXTAREA}`);

    this.#restoreNotes(lesson.id);

    return this;
  }

  /**
   * Load a different lesson by ID, re-rendering the entire player.
   *
   * @param {string} id
   * @returns {LessonPlayer} this
   */
  loadLesson(id) {
    if (this.#destroyed) return this;

    this.saveProgress();
    this.#destroyEditors();
    this.#readingProgress?.destroy();
    this.#readingProgress = null;

    const newLesson = this.#resolveLessonById(id);
    if (!newLesson) {
      this.#renderErrorState(`Lesson "${id}" not found.`);
      return this;
    }

    this.#lesson      = newLesson;
    this.#complete    = false;
    this.#quizPassed  = false;
    this.#readingPct  = 0;
    this.#startTime   = Date.now();
    this.#bookmarked  = lsGet(`${BOOKMARK_KEY_PREFIX}${id}`) === 'true';

    this.render();
    this.#mountEditors();
    this.#startReadingProgress();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#dispatch(LESSON_EVENTS.LOADED, {
      id:            newLesson.id,
      title:         newLesson.title,
      totalSections: newLesson.sections.length,
    });

    this.#announce(`Lesson loaded: ${newLesson.title}`);
    return this;
  }

  /**
   * Persist the current lesson progress (scroll position, section index,
   * and time-on-page) to the ProgressTracker and sessionStorage.
   *
   * @returns {LessonPlayer} this
   */
  saveProgress() {
    if (!this.#lesson) return this;

    const timeOnPage = Math.floor((Date.now() - this.#startTime) / 1000);

    if (this.#config.tracker) {
      try {
        this.#config.tracker.recordTutorialProgress(this.#lesson.id, {
          sectionIndex: this.#currentSection,
          timeOnPage,
        });
      } catch { /* ignore */ }
    }

    lsSet(`${SCROLL_KEY_PREFIX}${this.#lesson.id}`, String(window.scrollY));

    return this;
  }

  /**
   * Mark the current lesson as complete.
   * Updates the ProgressTracker, renders the completion banner, and emits
   * lesson:completed.
   *
   * @returns {LessonPlayer} this
   */
  markComplete() {
    if (this.#complete || !this.#lesson) return this;

    this.#complete = true;
    const timeOnPage = Math.floor((Date.now() - this.#startTime) / 1000);

    if (this.#config.tracker) {
      try {
        this.#config.tracker.recordTutorialComplete(this.#lesson.id, {
          title:       this.#lesson.title,
          timeOnPage,
        });
      } catch { /* ignore */ }
    }

    this.#root?.classList.add(CSS.ROOT_COMPLETE);
    this.#updateProgressBar(100);

    // Append completion banner without re-rendering the entire page
    const existing = this.#root?.querySelector(`.${CSS.COMPLETE_BANNER}`);
    if (!existing) {
      this.#root?.insertAdjacentHTML('beforeend', this.#renderCompleteBanner(this.#lesson));
      this.#attachCompleteBannerEvents();
    }

    this.#dispatch(LESSON_EVENTS.COMPLETED, {
      id:          this.#lesson.id,
      title:       this.#lesson.title,
      timeOnPage,
      xp:          this.#lesson.xpReward,
    });

    this.#announce(`Lesson complete! You earned ${this.#lesson.xpReward} XP.`);
    return this;
  }

  /**
   * Refresh the progress bar and completion badge without re-rendering content.
   *
   * @returns {LessonPlayer} this
   */
  refresh() {
    if (!this.#mounted || !this.#lesson) return this;

    if (this.#config.tracker) {
      try {
        const summary = this.#config.tracker.getSummary();
        const record  = summary?.tutorials?.records?.[this.#lesson.id];
        if (record?.completedAt && !this.#complete) {
          this.markComplete();
        }
      } catch { /* ignore */ }
    }

    this.#refreshHeaderBadge();
    return this;
  }

  /**
   * Tear down all editors, observers, timers, listeners, and DOM content.
   *
   * @returns {LessonPlayer} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedNoteSave.flush();
    this.#debouncedNoteSave.cancel();
    this.#debouncedProgress.cancel();

    this.saveProgress();
    this.#destroyEditors();

    this.#readingProgress?.destroy();
    this.#readingProgress = null;

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

    if (this.#lesson) {
      this.#dispatch(LESSON_EVENTS.DESTROYED, { id: this.#lesson.id });
    }

    return this;
  }

  // ---- Private: rendering --------------------------------------------------

  /**
   * @param {LessonData} lesson
   * @param {number}     readMinutes
   * @returns {string}
   */
  #renderHeader(lesson, readMinutes) {
    const totalMinutes = Math.max(readMinutes, lesson.estimatedMinutes);
    const diffLabel    = lesson.difficulty.charAt(0).toUpperCase() + lesson.difficulty.slice(1);

    return `
      <header class="${CSS.HEADER}" aria-labelledby="lesson-title">
        <div class="${CSS.HEADER_INNER}">
          <div class="${CSS.HEADER_META}">
            <span class="${CSS.HEADER_BADGE} ${this.#complete ? CSS.HEADER_BADGE_DONE : ''}"
                  id="lesson-completion-badge"
                  aria-label="${this.#complete ? 'Completed' : diffLabel + ' difficulty'}">
              ${this.#complete ? '✅ Completed' : escapeHtml(diffLabel)}
            </span>
          </div>
          <h1 class="${CSS.HEADER_TITLE}" id="lesson-title" tabindex="-1">
            ${escapeHtml(lesson.title)}
          </h1>
          <p class="${CSS.HEADER_AUTHOR}">
            By ${escapeHtml(lesson.author)} · ${escapeHtml(lesson.course)}
          </p>
          <div class="${CSS.HEADER_STATS}" role="list" aria-label="Lesson details">
            <span class="${CSS.HEADER_STAT}" role="listitem">
              🕐 ${escapeHtml(formatMinutes(totalMinutes))}
            </span>
            <span class="${CSS.HEADER_STAT}" role="listitem">
              ⭐ +${lesson.xpReward} XP
            </span>
            <span class="${CSS.HEADER_STAT}" role="listitem">
              📝 ${lesson.sections.filter((s) => s.type !== 'editor').length} sections
            </span>
            ${lesson.quizId ? `
              <span class="${CSS.HEADER_STAT}" role="listitem">
                ✏️ Quiz included
              </span>
            ` : ''}
          </div>
          <div class="${CSS.HEADER_ACTIONS}">
            <button class="${CSS.HEADER_BTN} ${this.#bookmarked ? CSS.HEADER_BTN_ACTIVE : ''}"
                    type="button"
                    id="lesson-bookmark-btn"
                    data-action="toggle-bookmark"
                    aria-pressed="${this.#bookmarked}"
                    aria-label="${this.#bookmarked ? 'Remove bookmark' : 'Bookmark this lesson'}">
              🔖 ${this.#bookmarked ? 'Bookmarked' : 'Bookmark'}
            </button>
            <button class="${CSS.HEADER_BTN} ${this.#fullscreen ? CSS.HEADER_BTN_ACTIVE : ''}"
                    type="button"
                    id="lesson-fullscreen-btn"
                    data-action="toggle-fullscreen"
                    aria-pressed="${this.#fullscreen}"
                    aria-label="${this.#fullscreen ? 'Exit full-screen reading mode' : 'Enter full-screen reading mode'}">
              📖 Reading Mode
            </button>
            ${this.#complete ? '' : `
              <button class="btn btn--primary"
                      type="button"
                      data-action="mark-complete"
                      aria-label="Mark this lesson as complete">
                ✅ Mark Complete
              </button>
            `}
          </div>
        </div>
      </header>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderBreadcrumb(lesson) {
    const crumbs = [
      { label: 'Tutorials', path: '/tutorials' },
      { label: lesson.course,  path: `/tutorials?course=${encodeURIComponent(lesson.course)}`  },
      { label: lesson.chapter, path: `/tutorials?chapter=${encodeURIComponent(lesson.chapter)}` },
      { label: lesson.title,   path: null },
    ];

    const items = crumbs.map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      return `
        <li class="${CSS.BREADCRUMB_ITEM}">
          ${isLast
            ? `<span class="${CSS.BREADCRUMB_CURRENT}" aria-current="page">${escapeHtml(crumb.label)}</span>`
            : `<a class="${CSS.BREADCRUMB_LINK}"
                  href="${escapeAttr(crumb.path)}"
                  data-action="navigate"
                  data-path="${escapeAttr(crumb.path)}"
                  aria-label="Go to ${escapeAttr(crumb.label)}">
                 ${escapeHtml(crumb.label)}
               </a>
               <span class="${CSS.BREADCRUMB_SEP}" aria-hidden="true">›</span>`
          }
        </li>
      `;
    }).join('');

    return `
      <nav class="${CSS.BREADCRUMB}" aria-label="Lesson breadcrumb">
        <ol class="${CSS.BREADCRUMB_LIST}" role="list">
          ${items}
        </ol>
      </nav>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderProgress(lesson) {
    const pct      = this.#complete ? 100 : 0;
    const sections = lesson.sections.filter((s) => s.type !== 'editor');
    const dots     = sections.map((_, i) => `
      <span class="${CSS.PROGRESS_DOT} ${i === 0 ? CSS.PROGRESS_DOT_CUR : ''}"
            aria-hidden="true"></span>
    `).join('');

    return `
      <div class="${CSS.PROGRESS}" aria-label="Lesson progress">
        <div class="${CSS.PROGRESS_INNER}">
          <div class="${CSS.PROGRESS_BAR}"
               role="progressbar"
               aria-valuenow="${pct}"
               aria-valuemin="0"
               aria-valuemax="100"
               aria-label="Lesson progress: ${pct}%"
               id="lesson-progress-bar-wrap">
            <div class="${CSS.PROGRESS_FILL}"
                 id="lesson-progress-fill"
                 style="width:${pct}%;transition:${prefersReducedMotion() ? 'none' : 'width 0.4s ease-out'}">
            </div>
          </div>
          <span class="${CSS.PROGRESS_LABEL}" id="lesson-progress-label" aria-live="polite">
            ${pct}% complete
          </span>
          <div class="${CSS.PROGRESS_SECTIONS}" aria-hidden="true">${dots}</div>
        </div>
      </div>
    `;
  }

  /**
   * Main two-column layout: left = lesson content; right = aside (TOC + notes + resources).
   *
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderLayout(lesson) {
    return `
      <div class="${CSS.LAYOUT}">
        <main class="${CSS.MAIN}" id="lesson-main-content">
          ${this.#renderOverview(lesson)}
          ${this.#renderObjectives(lesson)}
          ${lesson.videoUrl ? this.#renderVideo(lesson) : ''}
          ${this.#renderContent(lesson)}
          ${lesson.quizId  ? this.#renderQuizSection(lesson) : ''}
        </main>
        <aside class="${CSS.ASIDE}" aria-label="Lesson resources">
          ${this.#renderTOC(lesson)}
          ${this.#renderNotes(lesson)}
          ${lesson.resources.length > 0 ? this.#renderResources(lesson) : ''}
        </aside>
      </div>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderOverview(lesson) {
    const takeaways = lesson.takeaways.map((t) => `
      <li class="${CSS.OVERVIEW_TAKEAWAY}">${escapeHtml(t)}</li>
    `).join('');

    return `
      <section class="${CSS.OVERVIEW}"
               aria-labelledby="overview-heading">
        <h2 id="overview-heading" class="sr-only">Overview</h2>
        <p class="${CSS.OVERVIEW_ABSTRACT}">${escapeHtml(lesson.description)}</p>
        ${takeaways ? `
          <ul class="${CSS.OVERVIEW_TAKEAWAYS}" aria-label="Key takeaways">
            ${takeaways}
          </ul>
        ` : ''}
      </section>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderObjectives(lesson) {
    if (!lesson.objectives?.length) return '';

    const items = lesson.objectives.map((o) => `
      <li class="${CSS.OBJECTIVES_ITEM}">${escapeHtml(o)}</li>
    `).join('');

    return `
      <section class="${CSS.OBJECTIVES}"
               aria-labelledby="objectives-heading">
        <h2 id="objectives-heading">Learning Objectives</h2>
        <ol class="${CSS.OBJECTIVES_LIST}" aria-label="Learning objectives">
          ${items}
        </ol>
      </section>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderVideo(lesson) {
    return `
      <section class="${CSS.VIDEO}"
               aria-labelledby="video-heading">
        <h2 id="video-heading">Video Lesson</h2>
        <div class="${CSS.VIDEO_WRAP}">
          <iframe class="${CSS.VIDEO_IFRAME}"
                  src="${escapeAttr(lesson.videoUrl)}"
                  title="${escapeAttr(lesson.title)} — video lesson"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
                  loading="lazy">
          </iframe>
        </div>
      </section>
    `;
  }

  /**
   * Render all lesson content sections in order.
   *
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderContent(lesson) {
    let editorIndex = 0;
    const blocks = lesson.sections.map((section) => {
      switch (section.type) {
        case 'heading':
          return this.#renderHeading(section);
        case 'text':
          return this.#renderText(section);
        case 'code':
          return this.#renderCodeBlock(section);
        case 'callout':
          return this.#renderCallout(section);
        case 'image':
          return this.#renderImage(section);
        case 'editor':
          return this.#renderEditor(section, editorIndex++);
        default:
          return '';
      }
    }).join('');

    return `
      <section class="${CSS.CONTENT}"
               id="lesson-content-area"
               aria-label="Lesson content">
        ${blocks}
      </section>
    `;
  }

  /**
   * @param {LessonSection} section
   * @returns {string}
   */
  #renderHeading(section) {
    const tag = `h${section.level ?? 2}`;
    const id  = section.id
      ? escapeAttr(section.id)
      : escapeAttr(section.content.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));

    return `
      <div class="${CSS.CONTENT_SECTION}" data-section-type="heading">
        <${tag} class="${CSS.CONTENT_HEADING}" id="${id}">
          ${escapeHtml(section.content)}
        </${tag}>
      </div>
    `;
  }

  /**
   * @param {LessonSection} section
   * @returns {string}
   */
  #renderText(section) {
    return `
      <div class="${CSS.CONTENT_SECTION}" data-section-type="text">
        <p class="${CSS.CONTENT_PARA}">${escapeHtml(section.content)}</p>
      </div>
    `;
  }

  /**
   * @param {LessonSection} section
   * @returns {string}
   */
  #renderCodeBlock(section) {
    const lang = section.language ?? 'python';
    const id   = `code-block-${Math.random().toString(36).slice(2, 8)}`;

    return `
      <div class="${CSS.CODE_BLOCK} ${CSS.CODE_BLOCK_COLLAPSED}"
           id="${id}"
           data-section-type="code">
        <div class="${CSS.CODE_BLOCK_HEADER}">
          <span class="${CSS.CODE_BLOCK_LANG}">${escapeHtml(lang)}</span>
          <div class="${CSS.CODE_BLOCK_ACTIONS}">
            <button class="${CSS.CODE_BLOCK_BTN}"
                    type="button"
                    data-action="copy-code"
                    data-target="${escapeAttr(id)}"
                    aria-label="Copy code to clipboard">
              📋 Copy
            </button>
            <button class="${CSS.CODE_BLOCK_BTN}"
                    type="button"
                    data-action="toggle-expand"
                    data-target="${escapeAttr(id)}"
                    aria-expanded="false"
                    aria-label="Expand code block">
              ⤢ Expand
            </button>
          </div>
        </div>
        <pre class="${CSS.CODE_BLOCK_PRE}"
             tabindex="0"
             aria-label="${escapeAttr(lang)} code example"><code>${escapeHtml(section.content)}</code></pre>
      </div>
    `;
  }

  /**
   * @param {LessonSection} section
   * @returns {string}
   */
  #renderCallout(section) {
    const variant = section.variant ?? 'info';
    return `
      <div class="${CSS.CONTENT_SECTION} ${CSS.CONTENT_CALLOUT} ${calloutClass(variant)}"
           role="note"
           data-section-type="callout">
        <span aria-hidden="true">${calloutIcon(variant)}</span>
        <span>${escapeHtml(section.content)}</span>
      </div>
    `;
  }

  /**
   * @param {LessonSection} section
   * @returns {string}
   */
  #renderImage(section) {
    return `
      <div class="${CSS.CONTENT_SECTION}" data-section-type="image">
        <figure>
          <img class="${CSS.CONTENT_IMAGE}"
               src="${escapeAttr(section.content)}"
               alt="${escapeAttr(section.alt ?? '')}"
               loading="lazy">
          ${section.caption ? `
            <figcaption class="${CSS.CONTENT_CAPTION}">${escapeHtml(section.caption)}</figcaption>
          ` : ''}
        </figure>
      </div>
    `;
  }

  /**
   * Render the placeholder shell for a CodeEditor.
   * The actual CodeEditor is mounted asynchronously in #mountEditors().
   *
   * @param {LessonSection} section
   * @param {number}        index
   * @returns {string}
   */
  #renderEditor(section, index) {
    const containerId = section.id ?? `lesson-editor-${index}`;
    const editorId    = `editor-container-${containerId}`;
    const outputId    = `editor-output-${containerId}`;
    const statusId    = `editor-status-${containerId}`;

    return `
      <div class="${CSS.EDITOR_WRAP}"
           data-section-type="editor"
           data-editor-id="${escapeAttr(containerId)}">
        <div class="${CSS.EDITOR_HEADER}">
          <span class="${CSS.EDITOR_TITLE}">⌨️ Interactive Editor</span>
          <div class="${CSS.EDITOR_TABS}">
            <button class="${CSS.EDITOR_TAB} ${CSS.EDITOR_TAB_ACTIVE}"
                    type="button"
                    data-action="editor-tab"
                    data-tab="code"
                    data-editor="${escapeAttr(containerId)}"
                    aria-pressed="true">
              Code
            </button>
            <button class="${CSS.EDITOR_TAB}"
                    type="button"
                    data-action="editor-tab"
                    data-tab="output"
                    data-editor="${escapeAttr(containerId)}"
                    aria-pressed="false">
              Output
            </button>
          </div>
        </div>

        <!-- CodeEditor mounts here -->
        <div class="${CSS.EDITOR_CONTAINER}"
             id="${escapeAttr(editorId)}"
             data-initial-code="${escapeAttr(section.content)}"
             aria-label="Python code editor">
        </div>

        <!-- Output panel -->
        <div class="${CSS.EDITOR_OUTPUT}"
             id="${escapeAttr(outputId)}"
             role="log"
             aria-label="Code output"
             aria-live="polite"
             hidden>
          <span class="${CSS.EDITOR_OUTPUT_EMPTY}">Run your code to see output here.</span>
        </div>

        <!-- Controls -->
        <div class="${CSS.EDITOR_CONTROLS}">
          <button class="${CSS.EDITOR_BTN_RUN}"
                  type="button"
                  data-action="run-code"
                  data-editor="${escapeAttr(containerId)}"
                  aria-label="Run code (Ctrl+Enter)">
            ▶ Run
          </button>
          <button class="${CSS.EDITOR_BTN_RESET}"
                  type="button"
                  data-action="reset-code"
                  data-editor="${escapeAttr(containerId)}"
                  aria-label="Reset code to starter">
            ↺ Reset
          </button>
          <button class="${CSS.EDITOR_BTN_CLEAR}"
                  type="button"
                  data-action="clear-output"
                  data-editor="${escapeAttr(containerId)}"
                  data-output="${escapeAttr(outputId)}"
                  aria-label="Clear output panel">
            🗑 Clear
          </button>
          <span class="${CSS.EDITOR_STATUS}"
                id="${escapeAttr(statusId)}"
                aria-live="polite">Ready</span>
        </div>
      </div>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderQuizSection(lesson) {
    return `
      <section class="${CSS.QUIZ_WRAP}"
               aria-labelledby="quiz-section-heading">
        <h2 class="${CSS.QUIZ_HEADING}" id="quiz-section-heading">
          ✏️ Knowledge Check
        </h2>
        <div class="${CSS.QUIZ_CONTAINER}"
             id="lesson-quiz-container"
             data-quiz-id="${escapeAttr(lesson.quizId ?? '')}"
             aria-label="Lesson quiz">
          <p style="color:var(--color-text-secondary)">
            Loading quiz…
          </p>
        </div>
      </section>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderTOC(lesson) {
    const headings = lesson.sections.filter((s) => s.type === 'heading');
    if (headings.length === 0) return '';

    const items = headings.map((s) => {
      const id  = s.id ?? s.content.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const pad = s.level === 3 ? 'padding-left:1rem;' : s.level === 4 ? 'padding-left:2rem;' : '';
      return `
        <li class="${CSS.TOC_ITEM}" style="${pad}">
          <a class="${CSS.TOC_LINK}"
             href="#${escapeAttr(id)}"
             data-action="toc-scroll"
             data-target="${escapeAttr(id)}"
             aria-label="Jump to: ${escapeAttr(s.content)}">
            ${escapeHtml(s.content)}
          </a>
        </li>
      `;
    }).join('');

    return `
      <nav class="${CSS.TOC}" aria-labelledby="toc-heading">
        <h3 class="${CSS.TOC_TITLE}" id="toc-heading">Contents</h3>
        <ul class="${CSS.TOC_LIST}" role="list">
          ${items}
        </ul>
      </nav>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderNotes(lesson) {
    const savedNotes = lsGet(`${NOTES_KEY_PREFIX}${lesson.id}`) ?? '';
    const charCount  = savedNotes.length;

    return `
      <aside class="${CSS.NOTES}" aria-labelledby="notes-heading">
        <div class="${CSS.NOTES_HEADER}">
          <h3 class="${CSS.NOTES_TITLE}" id="notes-heading">📝 My Notes</h3>
        </div>
        <label for="lesson-notes-textarea" class="sr-only">
          Personal notes for this lesson
        </label>
        <textarea class="${CSS.NOTES_TEXTAREA}"
                  id="lesson-notes-textarea"
                  name="notes"
                  placeholder="Add your notes here… they are saved automatically."
                  aria-label="Personal notes — auto-saved"
                  autocomplete="off"
                  spellcheck="true"
                  rows="6"
                  maxlength="10000">${escapeHtml(savedNotes)}</textarea>
        <div class="${CSS.NOTES_FOOTER}">
          <span class="${CSS.NOTES_COUNT}"
                id="lesson-notes-count"
                aria-live="polite"
                aria-label="Character count">${charCount} / 10000</span>
          <span class="${CSS.NOTES_SAVED}"
                id="lesson-notes-saved"
                aria-live="polite"
                style="opacity:0">Saved ✓</span>
        </div>
      </aside>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderResources(lesson) {
    const items = lesson.resources.map((r) => `
      <li class="${CSS.RESOURCES_ITEM}">
        <a class="${CSS.RESOURCES_LINK}"
           href="${escapeAttr(r.url)}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="${escapeAttr(r.title)} (opens in new tab)">
          <span class="${CSS.RESOURCES_ICON}" aria-hidden="true">
            ${resourceIcon(r.type)}
          </span>
          ${escapeHtml(r.title)}
        </a>
      </li>
    `).join('');

    return `
      <section class="${CSS.RESOURCES}"
               aria-labelledby="resources-heading">
        <h3 id="resources-heading">📚 Further Reading</h3>
        <ul class="${CSS.RESOURCES_LIST}" role="list" aria-label="External resources">
          ${items}
        </ul>
      </section>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderLessonNav(lesson) {
    const prevHtml = lesson.prev ? `
      <button class="${CSS.LESSON_NAV_BTN}"
              type="button"
              data-action="lesson-prev"
              data-id="${escapeAttr(lesson.prev.id)}"
              aria-label="Previous lesson: ${escapeAttr(lesson.prev.title)}">
        <span class="${CSS.LESSON_NAV_DIR}">← Previous</span>
        <span class="${CSS.LESSON_NAV_TITLE}">${escapeHtml(lesson.prev.title)}</span>
      </button>
    ` : '<span></span>';

    const nextHtml = lesson.next ? `
      <button class="${CSS.LESSON_NAV_BTN}"
              type="button"
              data-action="lesson-next"
              data-id="${escapeAttr(lesson.next.id)}"
              aria-label="Next lesson: ${escapeAttr(lesson.next.title)}">
        <span class="${CSS.LESSON_NAV_DIR}">Next →</span>
        <span class="${CSS.LESSON_NAV_TITLE}">${escapeHtml(lesson.next.title)}</span>
      </button>
    ` : '<span></span>';

    return `
      <nav class="${CSS.LESSON_NAV}"
           aria-label="Lesson navigation">
        <div class="${CSS.LESSON_NAV_PREV}">${prevHtml}</div>
        <div class="${CSS.LESSON_NAV_NEXT}">${nextHtml}</div>
      </nav>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderCompleteBanner(lesson) {
    return `
      <div class="${CSS.COMPLETE_BANNER}"
           role="alert"
           aria-labelledby="complete-heading"
           tabindex="-1"
           id="lesson-complete-banner">
        <span class="${CSS.COMPLETE_ICON}" aria-hidden="true">🎉</span>
        <h2 class="${CSS.COMPLETE_HEADING}" id="complete-heading">
          Lesson Complete!
        </h2>
        <p class="${CSS.COMPLETE_SUB}">
          You finished <strong>${escapeHtml(lesson.title)}</strong>.
        </p>
        <div class="${CSS.COMPLETE_XP}"
             aria-label="${lesson.xpReward} XP earned">
          ⭐ +${lesson.xpReward} XP earned
        </div>
        <div class="${CSS.COMPLETE_ACTIONS}">
          ${lesson.next ? `
            <button class="btn btn--primary ${CSS.COMPLETE_BTN_NEXT}"
                    type="button"
                    data-action="lesson-next"
                    data-id="${escapeAttr(lesson.next.id)}"
                    aria-label="Continue to next lesson: ${escapeAttr(lesson.next.title)}">
              Next Lesson →
            </button>
          ` : ''}
          ${lesson.quizId && !this.#quizPassed ? `
            <button class="btn ${CSS.COMPLETE_BTN_QUIZ}"
                    type="button"
                    data-action="scroll-to-quiz"
                    aria-label="Take the lesson quiz">
              ✏️ Take Quiz
            </button>
          ` : ''}
          <button class="btn ${CSS.COMPLETE_BTN_REVIEW}"
                  type="button"
                  data-action="navigate"
                  data-path="/tutorials"
                  aria-label="Browse more tutorials">
            📚 Browse Tutorials
          </button>
        </div>
      </div>
    `;
  }

  /**
   * @param {string} message
   * @returns {void}
   */
  #renderErrorState(message) {
    if (!this.#root) return;

    this.#root.className = CSS.ROOT;
    this.#root.setAttribute('role', 'main');
    this.#root.innerHTML = `
      <div role="alert"
           style="padding:var(--space-16);text-align:center">
        <p style="font-size:var(--text-lg);font-weight:var(--font-semibold)">
          ${escapeHtml(message)}
        </p>
        <button type="button"
                class="btn btn--primary"
                data-action="navigate"
                data-path="/tutorials"
                style="margin-top:var(--space-4)">
          Back to Tutorials
        </button>
      </div>
    `;
  }

  // ---- Private: editor lifecycle -------------------------------------------

  /**
   * Mount a CodeEditor instance for each 'editor' section block.
   * Called after render() so that the container elements exist in the DOM.
   */
  async #mountEditors() {
    if (!this.#lesson) return;

    let editorIndex = 0;
    for (const section of this.#lesson.sections) {
      if (section.type !== 'editor') continue;

      const sectionId   = section.id ?? `lesson-editor-${editorIndex}`;
      const editorId    = `editor-container-${sectionId}`;
      const storageKey  = `pyai-editor-draft-${this.#lesson.id}-${sectionId}`;

      const mount       = new EditorMount(editorId, storageKey);
      await mount.mount(section.content);
      this.#editors.set(sectionId, mount);
      editorIndex++;
    }
  }

  /**
   * Destroy all mounted editor instances.
   */
  #destroyEditors() {
    for (const mount of this.#editors.values()) {
      mount.destroy();
    }
    this.#editors.clear();
  }

  // ---- Private: reading progress ------------------------------------------

  /**
   * Start the IntersectionObserver that tracks content section visibility.
   */
  #startReadingProgress() {
    this.#readingProgress = new ReadingProgress((pct) => {
      this.#readingPct = pct;
      this.#updateProgressBar(pct);

      this.#dispatch(LESSON_EVENTS.PROGRESS, {
        id:          this.#lesson?.id,
        sectionIndex: this.#currentSection,
        pct,
        timeOnPage:  Math.floor((Date.now() - this.#startTime) / 1000),
      });

      if (pct === 100 && !this.#complete) {
        this.#checkCompletionConditions();
      }

      this.#debouncedProgress();
    });

    const root = this.#root?.querySelector(`#lesson-content-area`);
    if (root) {
      this.#readingProgress.observe(root, `[data-section-type]`);
    }
  }

  // ---- Private: completion detection -------------------------------------

  /**
   * Check whether all completion conditions are met:
   *   1. 100% of content sections have been seen (via ReadingProgress)
   *   2. If a quiz is present, the quiz must have been submitted
   *
   * Calls markComplete() when all conditions are satisfied.
   */
  #checkCompletionConditions() {
    if (this.#complete) return;

    const hasQuiz    = Boolean(this.#lesson?.quizId);
    const quizOk     = !hasQuiz || this.#quizPassed;
    const contentOk  = this.#readingPct >= 100;

    if (contentOk && quizOk) {
      this.markComplete();
    }
  }

  // ---- Private: progress bar update ---------------------------------------

  /**
   * Update the horizontal progress bar and label.
   *
   * @param {number} pct — 0–100
   */
  #updateProgressBar(pct) {
    const fill  = this.#root?.querySelector(`#lesson-progress-fill`);
    const label = this.#root?.querySelector(`#lesson-progress-label`);
    const bar   = this.#root?.querySelector(`#lesson-progress-bar-wrap`);

    if (fill) fill.style.width = `${pct}%`;
    if (bar)  bar.setAttribute('aria-valuenow', String(pct));
    if (label) label.textContent = `${pct}% complete`;
  }

  // ---- Private: header badge refresh -------------------------------------

  /**
   * Update only the completion badge in the header without re-rendering the header.
   */
  #refreshHeaderBadge() {
    const badge = this.#root?.querySelector(`#lesson-completion-badge`);
    if (!badge || !this.#lesson) return;

    if (this.#complete) {
      badge.textContent = '✅ Completed';
      badge.classList.add(CSS.HEADER_BADGE_DONE);
      badge.setAttribute('aria-label', 'Completed');
    }
  }

  // ---- Private: notes ----------------------------------------------------

  /**
   * Restore saved notes into the textarea.
   *
   * @param {string} lessonId
   */
  #restoreNotes(lessonId) {
    if (!this.#notesEl) return;
    const saved = lsGet(`${NOTES_KEY_PREFIX}${lessonId}`);
    if (saved !== null) {
      this.#notesEl.value = saved;
      this.#updateNotesCount(saved.length);
    }
  }

  /**
   * Persist the current notes textarea value to localStorage.
   */
  #persistNotes() {
    if (!this.#lesson || !this.#notesEl) return;
    const value = this.#notesEl.value;
    lsSet(`${NOTES_KEY_PREFIX}${this.#lesson.id}`, value);
    this.#updateNotesCount(value.length);
    this.#showNotesSaved();
    this.#dispatch(LESSON_EVENTS.NOTE_SAVED, { id: this.#lesson.id, length: value.length });
  }

  /**
   * @param {number} count
   */
  #updateNotesCount(count) {
    const el = this.#root?.querySelector(`#lesson-notes-count`);
    if (el) el.textContent = `${count} / 10000`;
  }

  /**
   * Flash the "Saved ✓" indicator briefly.
   */
  #showNotesSaved() {
    const el = this.#root?.querySelector(`#lesson-notes-saved`);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2000);
  }

  // ---- Private: scroll position -------------------------------------------

  /**
   * Restore the saved scroll position for the current lesson.
   */
  #restoreScrollPosition() {
    if (!this.#lesson) return;
    const saved = lsGet(`${SCROLL_KEY_PREFIX}${this.#lesson.id}`);
    if (saved) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: Number(saved), behavior: 'instant' });
      });
    }
  }

  // ---- Private: tracker integration ---------------------------------------

  /**
   * Record that the user has started this lesson (idempotent).
   */
  #recordStart() {
    if (!this.#lesson || !this.#config.tracker) return;
    try {
      this.#config.tracker.recordTutorialStart(this.#lesson.id, {
        title: this.#lesson.title,
      });
    } catch { /* ignore */ }
  }

  // ---- Private: event listeners -------------------------------------------

  /**
   * Attach all external event subscriptions and DOM event delegation.
   */
  #attachEventListeners() {
    // ── DOM click delegation ──────────────────────────────────────────────
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    // ── Notes textarea ────────────────────────────────────────────────────
    const onNotesInput = (e) => {
      if (!e.target.classList.contains(CSS.NOTES_TEXTAREA)) return;
      this.#updateNotesCount(e.target.value.length);
      this.#debouncedNoteSave();
    };
    this.#root?.addEventListener('input', onNotesInput);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('input', onNotesInput));

    // ── Global keyboard shortcuts ─────────────────────────────────────────
    const onKeydown = (e) => this.#handleKeydown(e);
    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));

    // ── progress:updated ─────────────────────────────────────────────────
    const onProgressUpdated = () => this.refresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated)
    );

    // ── quiz:submitted ────────────────────────────────────────────────────
    const onQuizSubmitted = (e) => {
      const { passed } = e.detail ?? {};
      if (passed) {
        this.#quizPassed = true;
        this.#checkCompletionConditions();
      }
    };
    document.addEventListener('quiz:submitted', onQuizSubmitted);
    this.#cleanupFns.push(() =>
      document.removeEventListener('quiz:submitted', onQuizSubmitted)
    );

    // ── editor:run → populate output panel ───────────────────────────────
    const onEditorRun = (e) => {
      const { value } = e.detail ?? {};
      if (value === undefined) return;
      // Output rendering is handled by the Pyodide layer in main.js.
      // Here we update the status indicator of the focused editor.
      this.#setActiveEditorStatus('Running…');
    };
    document.addEventListener('editor:run', onEditorRun);
    this.#cleanupFns.push(() =>
      document.removeEventListener('editor:run', onEditorRun)
    );

    // ── router:afterNavigate ──────────────────────────────────────────────
    const onRouterNavigate = (e) => {
      const params    = e.detail?.params ?? {};
      const lessonId  = params.lessonId;
      if (lessonId && lessonId !== this.#lesson?.id) {
        this.loadLesson(lessonId);
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() =>
      document.removeEventListener('router:afterNavigate', onRouterNavigate)
    );

    // ── state:updated ─────────────────────────────────────────────────────
    const onStateUpdated = (e) => {
      if (e.detail?.path === 'theme') {
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

    // ── theme:changed ─────────────────────────────────────────────────────
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

    // ── Page visibility: save progress when tab becomes hidden ───────────
    const onVisibilityChange = () => {
      if (document.hidden) this.saveProgress();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.#cleanupFns.push(() =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
    );

    // ── TOC active link tracking via IntersectionObserver ────────────────
    this.#attachTocObserver();
  }

  /**
   * Attach completion banner click events (called after the banner is
   * inserted into the DOM outside the initial render pass).
   */
  #attachCompleteBannerEvents() {
    const banner = this.#root?.querySelector(`#lesson-complete-banner`);
    if (!banner) return;

    // Move focus to the banner for screen reader users
    requestAnimationFrame(() => {
      banner.focus({ preventScroll: true });
    });
  }

  /**
   * Observe heading elements to highlight the active TOC link during scroll.
   */
  #attachTocObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    const headings = this.#root?.querySelectorAll(`[data-section-type="heading"] h2,
      [data-section-type="heading"] h3, [data-section-type="heading"] h4`);

    if (!headings?.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id   = entry.target.id;
            const link = this.#root?.querySelector(`[data-target="${CSS.escape ? CSS.escape(id) : id}"].${CSS.TOC_LINK}`);
            if (link) {
              this.#root?.querySelectorAll(`.${CSS.TOC_LINK}`).forEach((l) => l.classList.remove(CSS.TOC_LINK_ACTIVE));
              link.classList.add(CSS.TOC_LINK_ACTIVE);
              link.setAttribute('aria-current', 'true');
            }
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    headings.forEach((h) => observer.observe(h));
    this.#cleanupFns.push(() => observer.disconnect());
  }

  // ---- Private: click handler ---------------------------------------------

  /**
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'toggle-bookmark': {
        this.#bookmarked = !this.#bookmarked;
        if (this.#lesson) {
          lsSet(`${BOOKMARK_KEY_PREFIX}${this.#lesson.id}`, String(this.#bookmarked));
        }
        const btn = this.#root?.querySelector(`#lesson-bookmark-btn`);
        if (btn) {
          btn.classList.toggle(CSS.HEADER_BTN_ACTIVE, this.#bookmarked);
          btn.setAttribute('aria-pressed', String(this.#bookmarked));
          btn.textContent = this.#bookmarked ? '🔖 Bookmarked' : '🔖 Bookmark';
        }
        this.#dispatch(LESSON_EVENTS.BOOKMARK, { id: this.#lesson?.id, bookmarked: this.#bookmarked });
        this.#announce(this.#bookmarked ? 'Lesson bookmarked.' : 'Bookmark removed.');
        break;
      }

      case 'toggle-fullscreen': {
        this.#fullscreen = !this.#fullscreen;
        this.#root?.classList.toggle(CSS.ROOT_FULLSCREEN, this.#fullscreen);
        if (this.#fullscreen) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = '';
        }
        const fsBtn = this.#root?.querySelector(`#lesson-fullscreen-btn`);
        if (fsBtn) {
          fsBtn.setAttribute('aria-pressed', String(this.#fullscreen));
          fsBtn.setAttribute('aria-label', this.#fullscreen ? 'Exit full-screen reading mode' : 'Enter full-screen reading mode');
          fsBtn.classList.toggle(CSS.HEADER_BTN_ACTIVE, this.#fullscreen);
        }
        this.#announce(this.#fullscreen ? 'Full-screen reading mode active.' : 'Exited reading mode.');
        break;
      }

      case 'mark-complete':
        this.markComplete();
        break;

      case 'navigate': {
        const path = actionEl.dataset.path;
        if (path) this.#navigate(path);
        break;
      }

      case 'lesson-prev': {
        const prevId = actionEl.dataset.id;
        if (prevId) this.#navigate(`/tutorials/${encodeURIComponent(prevId)}`);
        break;
      }

      case 'lesson-next': {
        const nextId = actionEl.dataset.id;
        if (nextId) this.#navigate(`/tutorials/${encodeURIComponent(nextId)}`);
        break;
      }

      case 'copy-code': {
        const targetId = actionEl.dataset.target;
        const block    = this.#root?.querySelector(`#${targetId}`);
        const code     = block?.querySelector('code')?.textContent ?? '';
        this.#copyToClipboard(code, actionEl);
        break;
      }

      case 'toggle-expand': {
        const targetId = actionEl.dataset.target;
        const block    = this.#root?.querySelector(`#${targetId}`);
        if (!block) break;
        const isExpanded = block.classList.toggle(CSS.CODE_BLOCK_EXPANDED);
        block.classList.toggle(CSS.CODE_BLOCK_COLLAPSED, !isExpanded);
        actionEl.setAttribute('aria-expanded', String(isExpanded));
        actionEl.textContent = isExpanded ? '⤡ Collapse' : '⤢ Expand';
        break;
      }

      case 'run-code': {
        const editorId = actionEl.dataset.editor;
        const mount    = this.#editors.get(editorId);
        if (mount) {
          const code = mount.getValue();
          this.#dispatch('editor:run', { value: code });
          this.#setEditorStatus(editorId, 'Running…');
        }
        break;
      }

      case 'reset-code': {
        const editorId = actionEl.dataset.editor;
        const lesson   = this.#lesson;
        if (!editorId || !lesson) break;
        const section  = lesson.sections.find((s) => s.type === 'editor' && (s.id ?? '') === editorId);
        const mount    = this.#editors.get(editorId);
        if (mount && section?.content) {
          this.#dispatch('editor:reset', { value: section.content });
        }
        break;
      }

      case 'clear-output': {
        const outputId = actionEl.dataset.output;
        const outputEl = this.#root?.querySelector(`#${outputId}`);
        if (outputEl) {
          outputEl.innerHTML = `<span class="${CSS.EDITOR_OUTPUT_EMPTY}">Run your code to see output here.</span>`;
        }
        break;
      }

      case 'editor-tab': {
        const editorId  = actionEl.dataset.editor;
        const tab       = actionEl.dataset.tab;
        const wrap      = actionEl.closest(`.${CSS.EDITOR_WRAP}`);
        if (!wrap) break;

        wrap.querySelectorAll(`.${CSS.EDITOR_TAB}`).forEach((t) => {
          t.classList.remove(CSS.EDITOR_TAB_ACTIVE);
          t.setAttribute('aria-pressed', 'false');
        });
        actionEl.classList.add(CSS.EDITOR_TAB_ACTIVE);
        actionEl.setAttribute('aria-pressed', 'true');

        const container = wrap.querySelector(`.${CSS.EDITOR_CONTAINER}`);
        const output    = wrap.querySelector(`.${CSS.EDITOR_OUTPUT}`);
        if (container) container.hidden = tab === 'output';
        if (output)    output.hidden    = tab === 'code';
        break;
      }

      case 'scroll-to-quiz': {
        const quizEl = this.#root?.querySelector(`.${CSS.QUIZ_WRAP}`);
        quizEl?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'start' });
        break;
      }

      case 'toc-scroll': {
        e.preventDefault();
        const targetId = actionEl.dataset.target;
        const el       = this.#root?.querySelector(`#${targetId}`);
        if (el) {
          el.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'start' });
          // Move focus to the heading for keyboard users
          const heading = el.querySelector('h2, h3, h4');
          if (heading) {
            if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // ---- Private: keyboard shortcuts ----------------------------------------

  /**
   * @param {KeyboardEvent} e
   */
  #handleKeydown(e) {
    // Do not intercept when focus is inside a textarea or input
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl + B — toggle bookmark
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      this.#root?.querySelector(`#lesson-bookmark-btn`)?.click();
      return;
    }

    // F — toggle full-screen reading mode
    if (!ctrl && e.key === 'f') {
      e.preventDefault();
      this.#root?.querySelector(`#lesson-fullscreen-btn`)?.click();
      return;
    }

    // Escape — exit fullscreen
    if (e.key === 'Escape' && this.#fullscreen) {
      e.preventDefault();
      this.#root?.querySelector(`#lesson-fullscreen-btn`)?.click();
      return;
    }

    // ArrowLeft — previous lesson
    if (e.key === 'ArrowLeft' && this.#lesson?.prev) {
      e.preventDefault();
      this.#navigate(`/tutorials/${encodeURIComponent(this.#lesson.prev.id)}`);
      return;
    }

    // ArrowRight — next lesson
    if (e.key === 'ArrowRight' && this.#lesson?.next) {
      e.preventDefault();
      this.#navigate(`/tutorials/${encodeURIComponent(this.#lesson.next.id)}`);
    }
  }

  // ---- Private: helpers ---------------------------------------------------

  /**
   * Copy a string to the clipboard with visual button feedback.
   *
   * @param {string}      text
   * @param {HTMLElement} btn — The copy button element
   */
  #copyToClipboard(text, btn) {
    const succeed = () => {
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = original; }, 2000);
      this.#announce('Code copied to clipboard.');
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(succeed).catch(() => {
        this.#announce('Copy failed. Please select and copy manually.');
      });
    } else {
      const ta      = document.createElement('textarea');
      ta.value      = text;
      ta.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        succeed();
      } catch {
        this.#announce('Copy failed. Please select and copy manually.');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  /**
   * Update the status indicator for the focused/most-recently-run editor.
   * @param {string} message
   */
  #setActiveEditorStatus(message) {
    const statuses = this.#root?.querySelectorAll(`.${CSS.EDITOR_STATUS}`);
    statuses?.forEach((s) => { s.textContent = message; });
  }

  /**
   * Update the status indicator for a specific editor by its section ID.
   *
   * @param {string} editorId
   * @param {string} message
   */
  #setEditorStatus(editorId, message) {
    const wrap     = this.#root?.querySelector(`[data-editor-id="${editorId}"]`);
    const statusEl = wrap?.querySelector(`.${CSS.EDITOR_STATUS}`);
    if (statusEl) statusEl.textContent = message;
  }

  /**
   * Resolve lesson data from the registry by ID.
   *
   * @param {string|null} id
   * @returns {LessonData|null}
   */
  #resolveLessonById(id) {
    if (!id) return null;
    return LESSON_REGISTRY.get(id) ?? null;
  }

  /**
   * Extract the lesson ID from the current URL path.
   * Expects /tutorials/:lessonId
   *
   * @returns {string|null}
   */
  #extractLessonIdFromUrl() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] === 'tutorials') return parts[1];
      return null;
    } catch {
      return null;
    }
  }

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

  // ---- Private: accessibility --------------------------------------------

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

  // ---- Private: event bus ------------------------------------------------

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