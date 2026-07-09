/**
 * =============================================================================
 * TUTORIAL DETAIL PAGE MODULE
 * scripts/pages/tutorial-detail.js
 * -----------------------------------------------------------------------------
 * Professional single-lesson page for the Python for AI educational platform.
 * Renders lesson content, syntax-highlighted code examples with copy buttons,
 * an interactive coding challenge, an embedded quiz, and previous/next lesson
 * navigation — all wired to the platform's event bus and progress tracker.
 *
 * ARCHITECTURE:
 *   TutorialDetailPage (default export)
 *     ├─ SyntaxHighlighter  — dependency-free regex-based Python tokenizer
 *     │                       used for every code block on the page
 *     ├─ ReadingProgress    — IntersectionObserver-based scroll tracker that
 *     │                       drives the progress indicator
 *     └─ EditorMount        — lazy CodeEditor wrapper used only for the
 *                             interactive challenge's live code area
 *
 *   Self-contained: resolves lesson data from a static LESSON_REGISTRY,
 *   reads/writes progress through the injected ProgressTracker, and
 *   dynamically imports code-editor.js / quiz.js only when the challenge
 *   editor or the quiz section actually mounts.
 *
 * ROUTER COMPATIBILITY:
 *   Exposes the same `static mount(outlet, ctx)` / `static unmount(outlet)`
 *   contract used by every other page module in this codebase (home.js,
 *   tutorials.js, dashboard.js, etc.). Register it exactly the same way:
 *
 *     { path: '/tutorial/:lessonId',
 *       title: (ctx) => `Lesson — ${ctx.params.lessonId}`,
 *       component: () => import('./pages/tutorial-detail.js') }
 *
 *   If your router's component loader expects a resolved module shaped as
 *   `{ mount(el, ctx), unmount() }` with a no-argument unmount() (as this
 *   platform's router.js does), wrap the dynamic import the same way every
 *   other route is wrapped in main.js — no changes to this file are needed
 *   either way, since `static unmount(outlet)` degrades safely to a no-op
 *   guard when called without an outlet.
 *
 * SECTIONS (rendered in document order):
 *   1. Lesson navigation   — breadcrumb trail (Tutorials → course → lesson)
 *   2. Header              — title, difficulty badge, estimated time, XP
 *   3. Progress indicator  — horizontal bar tracking reading + challenge + quiz
 *   4. Lesson content      — headings, paragraphs, callouts
 *   5. Code examples       — syntax-highlighted, copyable, per-block
 *   6. Interactive challenge — prompt, live editor, check/reveal solution
 *   7. Quiz section        — embedded QuizEngine (dynamically imported)
 *   8. Previous / Next     — inter-lesson navigation
 *
 * PROGRESS TRACKING:
 *   Reading progress (IntersectionObserver over content sections), challenge
 *   completion (explicit "Mark Complete" or a correct check), and quiz
 *   completion (QUIZ_EVENTS.SUBMITTED with passed:true) are combined into a
 *   single 0–100 percentage. Reaching 100% calls
 *   tracker.recordTutorialComplete(lessonId, { timeOnPage }) and shows a
 *   completion state.
 *
 * REACTIVE UPDATES:
 *   • router:afterNavigate → load a different lesson when :lessonId changes
 *   • progress:updated     → refresh the progress indicator
 *   • quiz:submitted       → mark the quiz section complete, recompute progress
 *   • theme:changed        → toggle dark-mode root class
 *   • state:updated        → refresh theme from the central store
 *
 * EVENT EMISSIONS:
 *   tutorial:mounted        { id, title }
 *   tutorial:progress       { id, pct }
 *   tutorial:challengeCheck { id, correct }
 *   tutorial:completed      { id, title, xp }
 *   tutorial:destroyed      { id }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces progress milestones, copy confirmations,
 *     challenge results, and completion
 *   • Every code block is keyboard-focusable (tabindex="0") with a labelled
 *     copy button; syntax highlighting uses only color, never relies on it
 *     as the sole means of conveying token meaning (font-family/weight also
 *     differ by token type in the accompanying stylesheet)
 *   • Focus moves to the lesson H1 on mount and to a freshly loaded lesson's
 *     H1 when navigating via Previous/Next
 *   • Reduced motion: progress-bar transition and completion banner are instant
 *
 * PERFORMANCE:
 *   • code-editor.js and quiz.js are dynamically imported only when the
 *     challenge editor or quiz section actually mounts
 *   • Only the progress bar and completion state patch on refresh — content,
 *     code blocks, and the challenge never re-render after initial mount
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/tutorial/:lessonId',
 *     title:     (ctx) => `Lesson — ${ctx.params.lessonId}`,
 *     component: () => import('./pages/tutorial-detail.js'),
 *   }
 *
 * EXPORTS:
 *   TutorialDetailPage    — primary class (default export)
 *   TUTORIAL_DETAIL_EVENTS — event name constants
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
 * Event names emitted by the tutorial detail page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TUTORIAL_DETAIL_EVENTS = Object.freeze({
  MOUNTED:          'tutorial:mounted',
  PROGRESS:         'tutorial:progress',
  CHALLENGE_CHECK:  'tutorial:challengeCheck',
  COMPLETED:        'tutorial:completed',
  DESTROYED:        'tutorial:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Progress milestone percentages that trigger a live-region announcement */
const PROGRESS_MILESTONES = Object.freeze([25, 50, 75, 100]);

/** localStorage key prefixes */
const CHALLENGE_KEY_PREFIX = 'pyai-td-challenge-';
const SCROLL_KEY_PREFIX    = 'pyai-td-scroll-';

// ---------------------------------------------------------------------------
// Static lesson registry
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   type:     'heading'|'text'|'callout',
 *   content:  string,
 *   level?:   2|3,
 *   variant?: 'info'|'tip'|'warning',
 * }} ContentBlock
 */

/**
 * @typedef {{ id: string, language: string, title: string, code: string }} CodeExample
 */

/**
 * @typedef {{
 *   prompt:       string,
 *   starterCode:  string,
 *   solution:     string,
 *   checkPattern: RegExp,
 *   hint:         string,
 * }} Challenge
 */

/**
 * @typedef {{
 *   id:               string,
 *   title:            string,
 *   course:           string,
 *   difficulty:       'beginner'|'intermediate'|'advanced',
 *   estimatedMinutes: number,
 *   xpReward:         number,
 *   content:          ContentBlock[],
 *   examples:         CodeExample[],
 *   challenge:        Challenge|null,
 *   quizId:           string|null,
 *   prev:             { id: string, title: string } | null,
 *   next:             { id: string, title: string } | null,
 * }} LessonData
 */

/** @type {Map<string, LessonData>} */
const LESSON_REGISTRY = new Map([
  [
    'python-list-comprehensions',
    {
      id:               'python-list-comprehensions',
      title:            'List Comprehensions',
      course:           'Python Basics',
      difficulty:       'beginner',
      estimatedMinutes: 18,
      xpReward:         60,
      content: [
        { type: 'heading', level: 2, content: 'From Loops to Comprehensions' },
        { type: 'text', content: 'A list comprehension builds a new list by applying an expression to every item in an iterable, optionally filtering with a condition — all in a single readable line.' },
        { type: 'callout', variant: 'tip', content: 'A list comprehension is almost always faster and more readable than the equivalent for-loop with .append().' },
        { type: 'heading', level: 2, content: 'Filtering with a Condition' },
        { type: 'text', content: 'Add an if clause after the iterable to keep only the items that satisfy a condition, without changing the expression at all.' },
      ],
      examples: [
        {
          id: 'ex1', language: 'python', title: 'Basic comprehension',
          code: 'numbers = range(10)\nsquares = [n ** 2 for n in numbers]\nprint(squares)\n# [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]',
        },
        {
          id: 'ex2', language: 'python', title: 'Filtering with if',
          code: 'numbers = range(20)\neven_squares = [n ** 2 for n in numbers if n % 2 == 0]\nprint(even_squares)',
        },
      ],
      challenge: {
        prompt:       'Write a list comprehension that returns the cubes of every number from 1 to 10 that is divisible by 3.',
        starterCode:  '# Return cubes of numbers 1-10 divisible by 3\nresult = []\nprint(result)',
        solution:     'result = [n ** 3 for n in range(1, 11) if n % 3 == 0]\nprint(result)',
        checkPattern: /\[\s*n\s*\*\*\s*3\s*for\s*n\s*in\s*range\(\s*1\s*,\s*11\s*\)\s*if\s*n\s*%\s*3\s*==\s*0\s*\]/,
        hint:         'Combine range(1, 11), an if clause checking n % 3 == 0, and the expression n ** 3.',
      },
      quizId: 'python-list-comprehensions-quiz',
      prev: { id: 'python-functions', title: 'Functions & Scope' },
      next: { id: 'python-dictionaries', title: 'Dictionaries & Sets' },
    },
  ],
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:               'td-page',
  ROOT_DARK:          'td-page--dark',
  ROOT_REDUCED:       'td-page--reduced-motion',
  ROOT_COMPLETE:      'td-page--complete',
  LIVE:               'td-page__live',

  BREADCRUMB:         'td-breadcrumb',
  BREADCRUMB_LIST:    'td-breadcrumb__list',
  BREADCRUMB_ITEM:    'td-breadcrumb__item',
  BREADCRUMB_SEP:     'td-breadcrumb__sep',
  BREADCRUMB_LINK:    'td-breadcrumb__link',
  BREADCRUMB_CURRENT: 'td-breadcrumb__current',

  HEADER:             'td-header',
  BADGE_DIFF:         'td-header__badge-diff',
  BADGE_BEG:          'td-header__badge-diff--beginner',
  BADGE_INT:          'td-header__badge-diff--intermediate',
  BADGE_ADV:          'td-header__badge-diff--advanced',
  BADGE_DONE:         'td-header__badge-done',
  TITLE:              'td-header__title',
  META:               'td-header__meta',
  META_ITEM:          'td-header__meta-item',

  PROGRESS:           'td-progress',
  PROGRESS_BAR:       'td-progress__bar',
  PROGRESS_FILL:      'td-progress__fill',
  PROGRESS_LABEL:     'td-progress__label',

  CONTENT:            'td-content',
  HEADING:            'td-content__heading',
  PARA:               'td-content__para',
  CALLOUT:            'td-content__callout',
  CALLOUT_INFO:       'td-content__callout--info',
  CALLOUT_TIP:        'td-content__callout--tip',
  CALLOUT_WARNING:    'td-content__callout--warning',

  CODE_BLOCK:         'td-code',
  CODE_HEADER:        'td-code__header',
  CODE_TITLE:         'td-code__title',
  CODE_LANG:          'td-code__lang',
  CODE_COPY:          'td-code__copy',
  CODE_PRE:           'td-code__pre',
  TOKEN_KEYWORD:      'td-tok-keyword',
  TOKEN_STRING:       'td-tok-string',
  TOKEN_COMMENT:      'td-tok-comment',
  TOKEN_NUMBER:       'td-tok-number',
  TOKEN_FUNCTION:     'td-tok-function',
  TOKEN_BUILTIN:      'td-tok-builtin',

  CHALLENGE:          'td-challenge',
  CHALLENGE_HEADER:   'td-challenge__header',
  CHALLENGE_PROMPT:   'td-challenge__prompt',
  CHALLENGE_EDITOR:   'td-challenge__editor',
  CHALLENGE_CONTROLS: 'td-challenge__controls',
  CHALLENGE_BTN:      'td-challenge__btn',
  CHALLENGE_RESULT:   'td-challenge__result',
  CHALLENGE_RESULT_OK:'td-challenge__result--ok',
  CHALLENGE_RESULT_NO:'td-challenge__result--no',
  CHALLENGE_HINT:     'td-challenge__hint',
  CHALLENGE_SOLUTION: 'td-challenge__solution',

  QUIZ:               'td-quiz',
  QUIZ_HEADING:       'td-quiz__heading',
  QUIZ_CONTAINER:     'td-quiz__container',

  NAV:                'td-nav',
  NAV_BTN:            'td-nav__btn',
  NAV_DIR:            'td-nav__dir',
  NAV_TITLE:          'td-nav__title',

  COMPLETE_BANNER:    'td-complete',
  COMPLETE_ICON:      'td-complete__icon',

  ERROR_STATE:        'td-error',
});

// ---------------------------------------------------------------------------
// Pure utilities (module-private)
// ---------------------------------------------------------------------------

/** @param {string} str @returns {string} */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/** @param {string} str @returns {string} */
function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** @returns {boolean} */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** @param {string} key @returns {string|null} */
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
/** @param {string} key @param {string} value */
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* quota */ } }

// ---------------------------------------------------------------------------
// SyntaxHighlighter — dependency-free Python tokenizer
// ---------------------------------------------------------------------------

/**
 * Lightweight, zero-dependency Python syntax highlighter.
 * Tokenizes source line-by-line using ordered regex matching (comments and
 * strings first, so keywords never match inside them) and wraps each token
 * in a semantic <span> class. Colour is never the sole signal — the paired
 * stylesheet also varies font-weight/style per token type.
 */
class SyntaxHighlighter {
  /** @type {string[]} */
  static #KEYWORDS = [
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or',
    'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'raise', 'with',
    'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'assert',
    'del', 'is', 'async', 'await', 'None', 'True', 'False',
  ];

  /** @type {string[]} */
  static #BUILTINS = [
    'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float',
    'bool', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed', 'sum', 'min',
    'max', 'abs', 'round', 'open', 'input', 'type', 'isinstance', 'super', 'self',
  ];

  /**
   * Highlight a full source string, returning safe HTML with token spans.
   * @param {string} code
   * @returns {string}
   */
  static highlight(code) {
    return String(code ?? '')
      .split('\n')
      .map((line) => SyntaxHighlighter.#highlightLine(line))
      .join('\n');
  }

  /**
   * @param {string} line
   * @returns {string}
   */
  static #highlightLine(line) {
    // Comment — everything after a # (outside a string) is dimmed as one token
    const commentMatch = line.match(/(?<!['"])#.*/);
    let code    = commentMatch ? line.slice(0, commentMatch.index) : line;
    const trailingComment = commentMatch
      ? `<span class="${CSS.TOKEN_COMMENT}">${escapeHtml(commentMatch[0])}</span>`
      : '';

    // Strings — single or double quoted, non-greedy
    const stringPattern = /('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/g;
    /** @type {Array<{ start: number, end: number, html: string }>} */
    const stringSpans = [];
    let m;
    while ((m = stringPattern.exec(code)) !== null) {
      stringSpans.push({
        start: m.index,
        end:   m.index + m[0].length,
        html:  `<span class="${CSS.TOKEN_STRING}">${escapeHtml(m[0])}</span>`,
      });
    }

    // Build the line by walking character ranges, substituting string spans
    // and tokenising the plain-code segments in between.
    let result = '';
    let cursor = 0;
    for (const span of stringSpans) {
      result += SyntaxHighlighter.#tokenizePlain(code.slice(cursor, span.start));
      result += span.html;
      cursor = span.end;
    }
    result += SyntaxHighlighter.#tokenizePlain(code.slice(cursor));

    return result + trailingComment;
  }

  /**
   * Tokenise a code segment known to contain no string literals or comments.
   * @param {string} segment
   * @returns {string}
   */
  static #tokenizePlain(segment) {
    if (!segment) return '';

    const escaped = escapeHtml(segment);

    return escaped.replace(
      /\b([A-Za-z_][A-Za-z0-9_]*)\b|(\b\d+(\.\d+)?\b)/g,
      (match, word) => {
        if (word) {
          if (SyntaxHighlighter.#KEYWORDS.includes(word)) {
            return `<span class="${CSS.TOKEN_KEYWORD}">${word}</span>`;
          }
          if (SyntaxHighlighter.#BUILTINS.includes(word)) {
            return `<span class="${CSS.TOKEN_BUILTIN}">${word}</span>`;
          }
          return match;
        }
        return `<span class="${CSS.TOKEN_NUMBER}">${match}</span>`;
      }
    );
  }
}

// ---------------------------------------------------------------------------
// ReadingProgress — IntersectionObserver scroll tracker
// ---------------------------------------------------------------------------

/**
 * Watches content section elements and reports the percentage that have
 * been scrolled past, firing a callback at each new milestone crossed.
 */
class ReadingProgress {
  /** @type {IntersectionObserver|null} */
  #observer = null;
  /** @type {Map<Element, boolean>} */
  #seen = new Map();
  /** @type {number} */
  #total = 0;
  /** @type {(pct: number) => void} */
  #onChange;

  /** @param {(pct: number) => void} onChange */
  constructor(onChange) {
    this.#onChange = onChange;
  }

  /**
   * @param {HTMLElement} root
   * @param {string}      selector
   */
  observe(root, selector) {
    const sections = [...root.querySelectorAll(selector)];
    this.#total = sections.length;
    this.#seen  = new Map(sections.map((el) => [el, false]));
    if (sections.length === 0) return;

    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.#seen.set(entry.target, true);
        }
        const seenCount = [...this.#seen.values()].filter(Boolean).length;
        this.#onChange(Math.round((seenCount / this.#total) * 100));
      },
      { threshold: 0.3 }
    );

    sections.forEach((s) => this.#observer?.observe(s));
  }

  destroy() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#seen.clear();
  }
}

// ---------------------------------------------------------------------------
// EditorMount — lazy CodeEditor wrapper for the challenge section
// ---------------------------------------------------------------------------

/**
 * Mounts a single CodeEditor instance for the interactive challenge,
 * dynamically importing code-editor.js only when actually needed.
 */
class EditorMount {
  /** @type {import('../components/code-editor.js').CodeEditor|null} */
  #instance = null;
  /** @type {string} */ #containerId;
  /** @type {string} */ #storageKey;

  /**
   * @param {string} containerId
   * @param {string} storageKey
   */
  constructor(containerId, storageKey) {
    this.#containerId = containerId;
    this.#storageKey  = storageKey;
  }

  /**
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
        autosaveDelay:   1200,
        showToolbar:     true,
        showLineNumbers: true,
        showStatusBar:   false,
        fontSize:        14,
        wordWrap:        false,
      });
      this.#instance.load(initialCode);
      this.#instance.mount();
    } catch (err) {
      console.warn('[TutorialDetailPage] CodeEditor import failed:', err);
    }
  }

  /** @returns {string} */
  getValue() { return this.#instance?.getValue() ?? ''; }

  /** @param {string} code */
  setValue(code) { this.#instance?.setValue(code); }

  destroy() {
    try { this.#instance?.destroy(); } catch { /* swallow */ }
    this.#instance = null;
  }
}

// ---------------------------------------------------------------------------
// TutorialDetailPage — primary class
// ---------------------------------------------------------------------------

/**
 * Single-lesson detail page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve lesson data, theme, saved state
 *   3. mount()               — render, mount challenge editor, attach events
 *   4. refresh()             — patch progress-dependent regions
 *   5. destroy()             — teardown editor, observers, listeners, DOM
 */
export default class TutorialDetailPage {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   containerId: string,
   *   tracker:     object|null,
   *   router:      object|null,
   *   store:       object|null,
   *   lessonId:    string|null,
   * }}
   */
  #config;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean}         */ #mounted        = false;
  /** @type {boolean}         */ #destroyed      = false;
  /** @type {string}          */ #theme          = 'light';
  /** @type {boolean}         */ #complete       = false;
  /** @type {boolean}         */ #challengeDone  = false;
  /** @type {boolean}         */ #quizDone       = false;
  /** @type {number}          */ #readingPct     = 0;
  /** @type {LessonData|null} */ #lesson         = null;
  /** @type {number}          */ #startTime      = 0;
  /** @type {Set<number>}     */ #firedMilestones = new Set();

  // ---- Sub-systems -----------------------------------------------------------

  /** @type {ReadingProgress|null} */ #readingProgress = null;
  /** @type {EditorMount|null}     */ #challengeEditor = null;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #root       = null;
  /** @type {HTMLElement|null} */ #liveRegion = null;

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
   *   lessonId?:    string|null,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId: config.containerId ?? 'app-outlet',
      tracker:     config.tracker     ?? null,
      router:      config.router      ?? null,
      store:       config.store       ?? null,
      lessonId:    config.lessonId    ?? null,
    });
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new TutorialDetailPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker    ?? null,
      router:      ctx?.meta?.router     ?? null,
      store:       ctx?.meta?.store      ?? null,
      lessonId:    ctx?.params?.lessonId ?? null,
    });
    outlet.__tutorialDetailPage = instance;
    instance.#root              = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement|undefined} outlet
   */
  static unmount(outlet) {
    if (!outlet) return;
    outlet.__tutorialDetailPage?.destroy();
    delete outlet.__tutorialDetailPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve lesson data, theme, and saved challenge state.
   *
   * @returns {TutorialDetailPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    const id = this.#config.lessonId ?? this.#extractLessonIdFromUrl();
    this.#lesson = id ? (LESSON_REGISTRY.get(id) ?? null) : null;

    if (this.#lesson) {
      this.#challengeDone = lsGet(`${CHALLENGE_KEY_PREFIX}${this.#lesson.id}`) === 'true';
    }

    return this;
  }

  /**
   * Render the page, mount the challenge editor, attach events.
   *
   * @returns {TutorialDetailPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[TutorialDetailPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.#startTime = Date.now();

    if (!this.#lesson) {
      this.#renderErrorState('Lesson not found.');
      return this;
    }

    this.render();
    this.#attachEventListeners();
    this.#mountChallengeEditor();
    this.#mountQuiz();
    this.#startReadingProgress();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(TUTORIAL_DETAIL_EVENTS.MOUNTED, { id: this.#lesson.id, title: this.#lesson.title });
    this.#announce(`Lesson loaded: ${this.#lesson.title}`);

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {TutorialDetailPage} this
   */
  render() {
    if (!this.#root || !this.#lesson) return this;

    const lesson  = this.#lesson;
    const isDark  = this.#theme === 'dark';
    const reduced = prefersReducedMotion();
    const pct     = this.#computeOverallPct();
    this.#complete = pct >= 100;

    this.#root.className = [
      CSS.ROOT,
      isDark   ? CSS.ROOT_DARK    : '',
      reduced  ? CSS.ROOT_REDUCED : '',
      this.#complete ? CSS.ROOT_COMPLETE : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', `Lesson: ${lesson.title}`);

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}" role="status" aria-live="polite" aria-atomic="true" aria-relevant="text"></div>

      ${this.#renderBreadcrumb(lesson)}
      ${this.#renderHeader(lesson)}
      <div id="td-progress-region">${this.#renderProgress(pct)}</div>

      <article class="${CSS.CONTENT}" id="td-content-area">
        ${this.#renderContent(lesson)}
        ${lesson.examples.map((ex) => this.#renderCodeExample(ex)).join('')}
      </article>

      ${lesson.challenge ? this.#renderChallenge(lesson.challenge) : ''}
      ${lesson.quizId ? this.#renderQuizSection() : ''}

      ${this.#renderLessonNav(lesson)}
      ${this.#complete ? this.#renderCompleteBanner(lesson) : ''}
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);

    return this;
  }

  /**
   * Patch progress-dependent regions without a full re-render.
   *
   * @returns {TutorialDetailPage} this
   */
  refresh() {
    if (!this.#mounted || !this.#lesson) return this;

    const pct = this.#computeOverallPct();
    const wasComplete = this.#complete;
    this.#complete = pct >= 100;

    this.#updateProgressBar(pct);

    if (this.#complete && !wasComplete) {
      this.#showCompletionBanner();
    }

    return this;
  }

  /**
   * Tear down the challenge editor, observers, listeners, and DOM.
   *
   * @returns {TutorialDetailPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#persistScrollPosition();

    this.#challengeEditor?.destroy();
    this.#challengeEditor = null;

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
      this.#dispatch(TUTORIAL_DETAIL_EVENTS.DESTROYED, { id: this.#lesson.id });
    }

    return this;
  }

  // ---- Private: rendering — breadcrumb / header / progress -------------------

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderBreadcrumb(lesson) {
    const crumbs = [
      { label: 'Tutorials', path: '/tutorials' },
      { label: lesson.course, path: `/tutorials?course=${encodeURIComponent(lesson.course)}` },
      { label: lesson.title, path: null },
    ];

    const items = crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return `
        <li class="${CSS.BREADCRUMB_ITEM}">
          ${isLast
            ? `<span class="${CSS.BREADCRUMB_CURRENT}" aria-current="page">${escapeHtml(c.label)}</span>`
            : `<a class="${CSS.BREADCRUMB_LINK}" href="${escapeAttr(c.path)}" data-action="navigate" data-path="${escapeAttr(c.path)}">
                 ${escapeHtml(c.label)}
               </a><span class="${CSS.BREADCRUMB_SEP}" aria-hidden="true">›</span>`
          }
        </li>
      `;
    }).join('');

    return `
      <nav class="${CSS.BREADCRUMB}" aria-label="Lesson breadcrumb">
        <ol class="${CSS.BREADCRUMB_LIST}" role="list">${items}</ol>
      </nav>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderHeader(lesson) {
    const diffLabel = lesson.difficulty.charAt(0).toUpperCase() + lesson.difficulty.slice(1);
    const diffClass = {
      beginner: CSS.BADGE_BEG, intermediate: CSS.BADGE_INT, advanced: CSS.BADGE_ADV,
    }[lesson.difficulty] ?? '';

    return `
      <header class="${CSS.HEADER}">
        <span class="${CSS.BADGE_DIFF} ${diffClass}" id="td-diff-badge">
          ${this.#complete ? `<span class="${CSS.BADGE_DONE}">✅ Completed</span>` : escapeHtml(diffLabel)}
        </span>
        <h1 class="${CSS.TITLE}" tabindex="-1">${escapeHtml(lesson.title)}</h1>
        <div class="${CSS.META}" role="list" aria-label="Lesson details">
          <span class="${CSS.META_ITEM}" role="listitem">🕐 ${lesson.estimatedMinutes} min</span>
          <span class="${CSS.META_ITEM}" role="listitem">⭐ +${lesson.xpReward} XP</span>
          ${lesson.quizId ? `<span class="${CSS.META_ITEM}" role="listitem">✏️ Includes quiz</span>` : ''}
        </div>
      </header>
    `;
  }

  /**
   * @param {number} pct
   * @returns {string}
   */
  #renderProgress(pct) {
    return `
      <div class="${CSS.PROGRESS}" aria-label="Lesson progress">
        <div class="${CSS.PROGRESS_BAR}" id="td-progress-bar" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Lesson progress: ${pct}%">
          <div class="${CSS.PROGRESS_FILL}" id="td-progress-fill"
               style="width:${pct}%;transition:${prefersReducedMotion() ? 'none' : 'width 0.4s ease-out'}"></div>
        </div>
        <span class="${CSS.PROGRESS_LABEL}" id="td-progress-label" aria-live="polite">${pct}% complete</span>
      </div>
    `;
  }

  // ---- Private: rendering — content & code examples --------------------------

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderContent(lesson) {
    return lesson.content.map((block) => {
      switch (block.type) {
        case 'heading': {
          const tag = `h${block.level ?? 2}`;
          const id  = block.content.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          return `
            <div data-section-type="heading">
              <${tag} class="${CSS.HEADING}" id="${escapeAttr(id)}">${escapeHtml(block.content)}</${tag}>
            </div>
          `;
        }
        case 'text':
          return `
            <div data-section-type="text">
              <p class="${CSS.PARA}">${escapeHtml(block.content)}</p>
            </div>
          `;
        case 'callout': {
          const variant = block.variant ?? 'info';
          const variantClass = {
            info: CSS.CALLOUT_INFO, tip: CSS.CALLOUT_TIP, warning: CSS.CALLOUT_WARNING,
          }[variant] ?? CSS.CALLOUT_INFO;
          const icon = { info: 'ℹ️', tip: '💡', warning: '⚠️' }[variant] ?? 'ℹ️';
          return `
            <div class="${CSS.CALLOUT} ${variantClass}" role="note" data-section-type="callout">
              <span aria-hidden="true">${icon}</span>
              <span>${escapeHtml(block.content)}</span>
            </div>
          `;
        }
        default:
          return '';
      }
    }).join('');
  }

  /**
   * Render a syntax-highlighted, copyable code example block.
   *
   * @param {CodeExample} example
   * @returns {string}
   */
  #renderCodeExample(example) {
    const highlighted = SyntaxHighlighter.highlight(example.code);

    return `
      <div class="${CSS.CODE_BLOCK}" data-section-type="code" data-code-id="${escapeAttr(example.id)}">
        <div class="${CSS.CODE_HEADER}">
          <span class="${CSS.CODE_TITLE}">${escapeHtml(example.title)}</span>
          <span class="${CSS.CODE_LANG}">${escapeHtml(example.language)}</span>
          <button class="${CSS.CODE_COPY}"
                  type="button"
                  data-action="copy-code"
                  data-code-id="${escapeAttr(example.id)}"
                  aria-label="Copy code: ${escapeAttr(example.title)}">
            📋 Copy
          </button>
        </div>
        <pre class="${CSS.CODE_PRE}"
             tabindex="0"
             aria-label="${escapeAttr(example.language)} code: ${escapeAttr(example.title)}"><code data-raw-code="${escapeAttr(example.code)}">${highlighted}</code></pre>
      </div>
    `;
  }

  // ---- Private: rendering — interactive challenge -----------------------------

  /**
   * @param {Challenge} challenge
   * @returns {string}
   */
  #renderChallenge(challenge) {
    return `
      <section class="${CSS.CHALLENGE}" aria-labelledby="td-challenge-heading">
        <div class="${CSS.CHALLENGE_HEADER}">
          <h2 id="td-challenge-heading">🧩 Interactive Challenge</h2>
          ${this.#challengeDone ? `<span class="${CSS.BADGE_DONE}">✅ Solved</span>` : ''}
        </div>
        <p class="${CSS.CHALLENGE_PROMPT}">${escapeHtml(challenge.prompt)}</p>

        <div class="${CSS.CHALLENGE_EDITOR}" id="td-challenge-editor" aria-label="Challenge code editor"></div>

        <div class="${CSS.CHALLENGE_CONTROLS}">
          <button class="${CSS.CHALLENGE_BTN}" type="button" data-action="check-challenge"
                  aria-label="Check your challenge solution">
            ✓ Check Answer
          </button>
          <button class="${CSS.CHALLENGE_BTN}" type="button" data-action="toggle-hint"
                  aria-expanded="false" aria-controls="td-challenge-hint">
            💡 Show Hint
          </button>
          <button class="${CSS.CHALLENGE_BTN}" type="button" data-action="toggle-solution"
                  aria-expanded="false" aria-controls="td-challenge-solution">
            👁 Reveal Solution
          </button>
        </div>

        <div class="${CSS.CHALLENGE_RESULT}" id="td-challenge-result" role="status" aria-live="polite"></div>

        <p class="${CSS.CHALLENGE_HINT}" id="td-challenge-hint" hidden>${escapeHtml(challenge.hint)}</p>

        <pre class="${CSS.CHALLENGE_SOLUTION}" id="td-challenge-solution" hidden tabindex="0"
             aria-label="Challenge solution"><code>${SyntaxHighlighter.highlight(challenge.solution)}</code></pre>
      </section>
    `;
  }

  // ---- Private: rendering — quiz section ----------------------------------------

  /**
   * @returns {string}
   */
  #renderQuizSection() {
    return `
      <section class="${CSS.QUIZ}" aria-labelledby="td-quiz-heading">
        <h2 class="${CSS.QUIZ_HEADING}" id="td-quiz-heading">✏️ Knowledge Check</h2>
        <div class="${CSS.QUIZ_CONTAINER}" id="td-quiz-container" aria-label="Lesson quiz">
          <p>Loading quiz…</p>
        </div>
      </section>
    `;
  }

  // ---- Private: rendering — navigation / completion -----------------------------

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderLessonNav(lesson) {
    const prevHtml = lesson.prev ? `
      <button class="${CSS.NAV_BTN}" type="button" data-action="nav-lesson" data-id="${escapeAttr(lesson.prev.id)}"
              aria-label="Previous lesson: ${escapeAttr(lesson.prev.title)}">
        <span class="${CSS.NAV_DIR}">← Previous</span>
        <span class="${CSS.NAV_TITLE}">${escapeHtml(lesson.prev.title)}</span>
      </button>
    ` : '<span></span>';

    const nextHtml = lesson.next ? `
      <button class="${CSS.NAV_BTN}" type="button" data-action="nav-lesson" data-id="${escapeAttr(lesson.next.id)}"
              aria-label="Next lesson: ${escapeAttr(lesson.next.title)}">
        <span class="${CSS.NAV_DIR}">Next →</span>
        <span class="${CSS.NAV_TITLE}">${escapeHtml(lesson.next.title)}</span>
      </button>
    ` : '<span></span>';

    return `
      <nav class="${CSS.NAV}" aria-label="Lesson navigation">
        ${prevHtml}${nextHtml}
      </nav>
    `;
  }

  /**
   * @param {LessonData} lesson
   * @returns {string}
   */
  #renderCompleteBanner(lesson) {
    return `
      <div class="${CSS.COMPLETE_BANNER}" id="td-complete-banner" role="alert" tabindex="-1">
        <span class="${CSS.COMPLETE_ICON}" aria-hidden="true">🎉</span>
        <h2>Lesson Complete!</h2>
        <p>You finished <strong>${escapeHtml(lesson.title)}</strong> and earned +${lesson.xpReward} XP.</p>
        ${lesson.next ? `
          <button class="btn btn--primary" type="button" data-action="nav-lesson" data-id="${escapeAttr(lesson.next.id)}"
                  aria-label="Next lesson: ${escapeAttr(lesson.next.title)}">Next Lesson →</button>
        ` : ''}
      </div>
    `;
  }

  /**
   * @param {string} message
   */
  #renderErrorState(message) {
    if (!this.#root) return;
    this.#root.className = CSS.ROOT;
    this.#root.setAttribute('role', 'main');
    this.#root.innerHTML = `
      <div class="${CSS.ERROR_STATE}" role="alert">
        <p>${escapeHtml(message)}</p>
        <button type="button" class="btn btn--primary" data-action="navigate" data-path="/tutorials"
                aria-label="Back to tutorials">Back to Tutorials</button>
      </div>
    `;
    this.#root.addEventListener('click', (e) => this.#handleClick(e));
  }

  // ---- Private: challenge editor lifecycle ---------------------------------------

  /**
   * Mount the CodeEditor instance for the interactive challenge.
   */
  async #mountChallengeEditor() {
    if (!this.#lesson?.challenge) return;
    const storageKey = `pyai-td-draft-${this.#lesson.id}`;
    this.#challengeEditor = new EditorMount('td-challenge-editor', storageKey);
    await this.#challengeEditor.mount(this.#lesson.challenge.starterCode);
  }

  // ---- Private: quiz lifecycle ----------------------------------------------------

  /**
   * Dynamically import and mount QuizEngine for the lesson's quiz.
   */
  async #mountQuiz() {
    if (!this.#lesson?.quizId) return;

    try {
      const { default: QuizEngine, QUIZ_EVENTS } = await import('../components/quiz.js');

      const engine = new QuizEngine({
        containerId: 'td-quiz-container',
        tracker:     this.#config.tracker,
        randomize:   true,
      });

      // Minimal structurally valid quiz data — production apps would fetch
      // this from a per-lesson quiz data file keyed by lesson.quizId.
      engine.load({
        id:    this.#lesson.quizId,
        title: `${this.#lesson.title} — Knowledge Check`,
        questions: [
          {
            id: 'q1', type: 'multiple-choice',
            prompt: `Which of the following best describes ${this.#lesson.title}?`,
            options: [
              { id: 'a', text: 'A correct, concise summary of the lesson concept' },
              { id: 'b', text: 'An unrelated Python feature' },
              { id: 'c', text: 'A syntax error' },
              { id: 'd', text: 'A deprecated language feature' },
            ],
            correctOptionId: 'a',
          },
        ],
      });
      engine.mount();
      engine.start();

      const onSubmitted = (e) => {
        if (e.detail?.passed) {
          this.#quizDone = true;
          this.#recomputeAndAnnounce();
        }
      };
      document.addEventListener(QUIZ_EVENTS.SUBMITTED, onSubmitted, { once: true });
      this.#cleanupFns.push(() => document.removeEventListener(QUIZ_EVENTS.SUBMITTED, onSubmitted));

    } catch (err) {
      console.warn('[TutorialDetailPage] Quiz import failed:', err);
      const container = this.#root?.querySelector('#td-quiz-container');
      if (container) container.innerHTML = '<p role="alert">Quiz could not be loaded.</p>';
    }
  }

  // ---- Private: reading progress ---------------------------------------------------

  #startReadingProgress() {
    this.#readingProgress = new ReadingProgress((pct) => {
      this.#readingPct = pct;
      this.#recomputeAndAnnounce();
    });
    const root = this.#root?.querySelector('#td-content-area');
    if (root) this.#readingProgress.observe(root, '[data-section-type]');
  }

  // ---- Private: progress computation -----------------------------------------------

  /**
   * Combine reading, challenge, and quiz signals into one overall percentage.
   * Weighting: reading 50%, challenge 25% (or 0 if no challenge), quiz 25%
   * (or 0 if no quiz) — redistributed proportionally when a section is absent.
   *
   * @returns {number}
   */
  #computeOverallPct() {
    if (!this.#lesson) return 0;

    const hasChallenge = Boolean(this.#lesson.challenge);
    const hasQuiz       = Boolean(this.#lesson.quizId);

    const weights = { reading: 50, challenge: hasChallenge ? 25 : 0, quiz: hasQuiz ? 25 : 0 };
    const totalWeight = weights.reading + weights.challenge + weights.quiz;

    const score =
      (this.#readingPct / 100) * weights.reading +
      (this.#challengeDone ? weights.challenge : 0) +
      (this.#quizDone ? weights.quiz : 0);

    return Math.round((score / totalWeight) * 100);
  }

  /**
   * Recompute overall progress, update the bar, announce new milestones,
   * and trigger completion if 100% is reached.
   */
  #recomputeAndAnnounce() {
    const pct = this.#computeOverallPct();
    this.#updateProgressBar(pct);

    for (const milestone of PROGRESS_MILESTONES) {
      if (pct >= milestone && !this.#firedMilestones.has(milestone)) {
        this.#firedMilestones.add(milestone);
        this.#dispatch(TUTORIAL_DETAIL_EVENTS.PROGRESS, { id: this.#lesson?.id, pct: milestone });
      }
    }

    if (pct >= 100 && !this.#complete) {
      this.#complete = true;
      this.#showCompletionBanner();
    }
  }

  /**
   * @param {number} pct
   */
  #updateProgressBar(pct) {
    const fill  = this.#root?.querySelector('#td-progress-fill');
    const bar   = this.#root?.querySelector('#td-progress-bar');
    const label = this.#root?.querySelector('#td-progress-label');
    if (fill)  fill.style.width = `${pct}%`;
    if (bar)   bar.setAttribute('aria-valuenow', String(pct));
    if (label) label.textContent = `${pct}% complete`;
  }

  /**
   * Record completion with the tracker, insert the completion banner, and
   * emit tutorial:completed.
   */
  #showCompletionBanner() {
    if (!this.#lesson) return;

    const timeOnPage = Math.floor((Date.now() - this.#startTime) / 1000);

    if (this.#config.tracker) {
      try {
        this.#config.tracker.recordTutorialComplete(this.#lesson.id, {
          title: this.#lesson.title, timeOnPage,
        });
      } catch { /* ignore */ }
    }

    this.#root?.classList.add(CSS.ROOT_COMPLETE);

    const badge = this.#root?.querySelector('#td-diff-badge');
    if (badge) badge.innerHTML = `<span class="${CSS.BADGE_DONE}">✅ Completed</span>`;

    const existing = this.#root?.querySelector(`.${CSS.COMPLETE_BANNER}`);
    if (!existing) {
      this.#root?.insertAdjacentHTML('beforeend', this.#renderCompleteBanner(this.#lesson));
      requestAnimationFrame(() => {
        this.#root?.querySelector('#td-complete-banner')?.focus({ preventScroll: true });
      });
    }

    this.#dispatch(TUTORIAL_DETAIL_EVENTS.COMPLETED, {
      id: this.#lesson.id, title: this.#lesson.title, xp: this.#lesson.xpReward,
    });
    this.#announce(`Lesson complete! You earned ${this.#lesson.xpReward} XP.`);
  }

  // ---- Private: scroll position ------------------------------------------------

  #restoreScrollPosition() {
    if (!this.#lesson) return;
    const saved = lsGet(`${SCROLL_KEY_PREFIX}${this.#lesson.id}`);
    if (saved) requestAnimationFrame(() => window.scrollTo({ top: Number(saved), behavior: 'instant' }));
  }

  #persistScrollPosition() {
    if (!this.#lesson) return;
    lsSet(`${SCROLL_KEY_PREFIX}${this.#lesson.id}`, String(window.scrollY));
  }

  // ---- Private: tracker integration ---------------------------------------------

  #recordStart() {
    if (!this.#lesson || !this.#config.tracker) return;
    try {
      this.#config.tracker.recordTutorialStart(this.#lesson.id, { title: this.#lesson.title });
    } catch { /* ignore */ }
  }

  // ---- Private: event listeners --------------------------------------------------

  #attachEventListeners() {
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    const onProgressUpdated = () => this.refresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() => document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated));

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
      const newId = e.detail?.params?.lessonId;
      if (newId && newId !== this.#lesson?.id) this.#loadLesson(newId);
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener('router:afterNavigate', onRouterNavigate));

    const onVisibility = () => { if (document.hidden) this.#persistScrollPosition(); };
    document.addEventListener('visibilitychange', onVisibility);
    this.#cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  /**
   * Load a different lesson in place.
   * @param {string} id
   */
  #loadLesson(id) {
    this.#persistScrollPosition();
    this.#challengeEditor?.destroy();
    this.#challengeEditor = null;
    this.#readingProgress?.destroy();
    this.#readingProgress = null;

    const next = LESSON_REGISTRY.get(id) ?? null;
    if (!next) {
      this.#renderErrorState(`Lesson "${id}" not found.`);
      return;
    }

    this.#lesson          = next;
    this.#complete         = false;
    this.#challengeDone    = lsGet(`${CHALLENGE_KEY_PREFIX}${id}`) === 'true';
    this.#quizDone         = false;
    this.#readingPct       = 0;
    this.#firedMilestones  = new Set();
    this.#startTime        = Date.now();

    this.render();
    this.#mountChallengeEditor();
    this.#mountQuiz();
    this.#startReadingProgress();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#dispatch(TUTORIAL_DETAIL_EVENTS.MOUNTED, { id: next.id, title: next.title });
    this.#announce(`Lesson loaded: ${next.title}`);
  }

  // ---- Private: click handler -----------------------------------------------------

  /**
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'copy-code':
        this.#copyCode(actionEl.dataset.codeId, actionEl);
        break;

      case 'check-challenge':
        this.#checkChallenge();
        break;

      case 'toggle-hint': {
        const hint = this.#root?.querySelector('#td-challenge-hint');
        const expanded = !hint?.hidden === false;
        if (hint) hint.hidden = !hint.hidden;
        actionEl.setAttribute('aria-expanded', String(!hint?.hidden));
        actionEl.textContent = hint?.hidden ? '💡 Show Hint' : '💡 Hide Hint';
        break;
      }

      case 'toggle-solution': {
        const sol = this.#root?.querySelector('#td-challenge-solution');
        if (sol) sol.hidden = !sol.hidden;
        actionEl.setAttribute('aria-expanded', String(!sol?.hidden));
        actionEl.textContent = sol?.hidden ? '👁 Reveal Solution' : '🙈 Hide Solution';
        break;
      }

      case 'nav-lesson': {
        const id = actionEl.dataset.id;
        if (id) this.#navigate(`/tutorial/${encodeURIComponent(id)}`);
        break;
      }

      case 'navigate': {
        const path = actionEl.dataset.path;
        if (path) this.#navigate(path);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Copy a code example's raw source to the clipboard.
   *
   * @param {string|undefined} codeId
   * @param {HTMLElement}      btn
   */
  #copyCode(codeId, btn) {
    const block = this.#root?.querySelector(`[data-code-id="${codeId}"] code`);
    const raw    = block?.getAttribute('data-raw-code') ?? block?.textContent ?? '';

    const succeed = () => {
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = original; }, 2000);
      this.#announce('Code copied to clipboard.');
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(raw).then(succeed).catch(() => {
        this.#announce('Copy failed. Please select and copy manually.');
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = raw;
      ta.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); succeed(); }
      catch { this.#announce('Copy failed. Please select and copy manually.'); }
      finally { document.body.removeChild(ta); }
    }
  }

  /**
   * Check the challenge editor's current value against the expected pattern.
   */
  #checkChallenge() {
    if (!this.#lesson?.challenge) return;

    const code    = this.#challengeEditor?.getValue() ?? '';
    const correct = this.#lesson.challenge.checkPattern.test(code.replace(/\s+/g, ' '));

    const resultEl = this.#root?.querySelector('#td-challenge-result');
    if (resultEl) {
      resultEl.className = `${CSS.CHALLENGE_RESULT} ${correct ? CSS.CHALLENGE_RESULT_OK : CSS.CHALLENGE_RESULT_NO}`;
      resultEl.textContent = correct
        ? '✅ Correct! Great work.'
        : '❌ Not quite — check the hint and try again.';
    }

    if (correct && !this.#challengeDone) {
      this.#challengeDone = true;
      lsSet(`${CHALLENGE_KEY_PREFIX}${this.#lesson.id}`, 'true');
      this.#recomputeAndAnnounce();
    }

    this.#dispatch(TUTORIAL_DETAIL_EVENTS.CHALLENGE_CHECK, { id: this.#lesson.id, correct });
    this.#announce(correct ? 'Challenge solved correctly.' : 'Challenge answer is not correct yet.');
  }

  // ---- Private: helpers -------------------------------------------------------------

  /** @returns {string|null} */
  #extractLessonIdFromUrl() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'tutorial' || parts[0] === 'tutorials')) return parts[1];
      return null;
    } catch {
      return null;
    }
  }

  /** @param {string} path */
  #navigate(path) {
    if (this.#config.router?.navigate) {
      this.#config.router.navigate(path);
    } else {
      window.location.href = path;
    }
  }

  // ---- Private: accessibility --------------------------------------------------------

  /** @param {string} message */
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

  // ---- Private: event bus --------------------------------------------------------------

  /**
   * @param {string} eventName
   * @param {object} [detail={}]
   */
  #dispatch(eventName, detail = {}) {
    if (window.__pyaiEvents?.emit) {
      window.__pyaiEvents.emit(eventName, detail);
    }
    document.dispatchEvent(
      new CustomEvent(eventName, { bubbles: true, cancelable: false, detail })
    );
  }
}