/**
 * =============================================================================
 * TUTORIALS PAGE MODULE — PREMIUM COURSE CATALOG
 * scripts/pages/tutorials.js
 * -----------------------------------------------------------------------------
 * Premium course catalog for the Python for AI educational platform. Presents
 * the platform's seven flagship learning tracks — Python Basics, Data
 * Analysis, Machine Learning, Deep Learning, AI Agents, LLM Engineering, and
 * MLOps — as polished, responsive course cards.
 *
 * ARCHITECTURE:
 *   TutorialsPage (default export)
 *     └─ Self-contained: reads live completion data from the injected
 *        ProgressTracker via getSummary() to compute each course's progress
 *        percentage. A static COURSE_CATALOGUE seeds course metadata (icon,
 *        difficulty, lesson count, duration, description). No sub-components
 *        are imported — router integration, event-bus dispatch, and
 *        accessibility patterns match every other page module in this
 *        codebase (home.js, dashboard.js, quizzes.js, projects.js).
 *
 * SECTIONS (rendered in document order):
 *   1. Hero            — catalog title, subtitle
 *   2. Stats strip      — total courses, total hours, categories covered
 *   3. Course grid       — one premium card per flagship course
 *
 * COURSE CARD CONTRACT:
 *   Every card renders: an icon on an accent-tinted thumbnail, a difficulty
 *   badge, the course title and short description, a meta row (lesson count
 *   + estimated duration), a progress bar with percentage label, and a
 *   single primary CTA that reads "Start Learning" / "Continue Learning" /
 *   "Review Course" depending on the learner's tracked progress.
 *
 * PROGRESS COMPUTATION:
 *   Each course lists the lesson IDs that belong to it. The displayed
 *   progress percentage is the proportion of those lesson IDs marked
 *   complete in ProgressTracker.getSummary().tutorials.records. Courses with
 *   no tracked activity show a 0% placeholder bar rather than being hidden.
 *
 * REACTIVE UPDATES:
 *   • progress:updated → debounced refresh of every course card's progress bar
 *   • theme:changed    → toggle dark-mode root class
 *
 * EVENT EMISSIONS:
 *   tutorials:mounted   { pathname }
 *   tutorials:updated   { timestamp }
 *   tutorials:opened    { id, title }
 *   tutorials:destroyed { pathname }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces page load and progress refreshes
 *   • Every card carries a descriptive aria-label; progress bars use
 *     role="progressbar" with accurate aria-valuenow
 *   • Focus moves to the page H1 on mount
 *   • Reduced motion: card entrance and progress-bar transitions are instant
 *
 * PERFORMANCE:
 *   • progress:updated is debounced at 250 ms
 *   • Only the grid region patches on refresh — the hero and stats strip
 *     never re-render after the initial mount
 *
 * USAGE (router component loader — unchanged):
 *   {
 *     path:      '/tutorials',
 *     title:     'Tutorials',
 *     component: () => import('./pages/tutorials.js'),
 *   }
 *
 * EXPORTS:
 *   TutorialsPage    — primary class (default export)
 *   TUTORIALS_EVENTS — event name constants
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
 * Event names emitted by the tutorials page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TUTORIALS_EVENTS = Object.freeze({
  MOUNTED:   'tutorials:mounted',
  UPDATED:   'tutorials:updated',
  OPENED:    'tutorials:opened',
  DESTROYED: 'tutorials:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** progress:updated debounce delay (ms) */
const REFRESH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Course catalogue — the platform's seven flagship learning tracks
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:          string,
 *   title:       string,
 *   description: string,
 *   difficulty:  'beginner'|'intermediate'|'advanced',
 *   icon:        string,
 *   accent:      string,
 *   lessonCount: number,
 *   duration:    string,
 *   lessonIds:   string[],
 *   path:        string,
 * }} Course
 */

/** @type {ReadonlyArray<Course>} */
const COURSE_CATALOGUE = Object.freeze([
  {
    id:          'python-basics',
    title:       'Python Basics',
    description: 'Master core Python syntax, data types, control flow, and functions — the essential foundation for every AI learner.',
    difficulty:  'beginner',
    icon:        '🐍',
    accent:      'var(--color-success)',
    lessonCount: 14,
    duration:    '6h 30m',
    lessonIds:   ['python-variables', 'python-functions', 'python-oop'],
    path:        '/tutorials/python-variables',
  },
  {
    id:          'data-analysis',
    title:       'Data Analysis',
    description: 'Load, clean, transform, and visualise real-world datasets using NumPy, Pandas, and modern plotting libraries.',
    difficulty:  'beginner',
    icon:        '📊',
    accent:      'var(--color-primary)',
    lessonCount: 20,
    duration:    '8h 45m',
    lessonIds:   ['numpy-fundamentals', 'pandas-data-analysis', 'data-visualisation'],
    path:        '/tutorials/numpy-fundamentals',
  },
  {
    id:          'machine-learning',
    title:       'Machine Learning',
    description: 'Build, train, and evaluate predictive models — from linear regression to ensemble methods — with scikit-learn.',
    difficulty:  'intermediate',
    icon:        '🤖',
    accent:      'var(--color-accent)',
    lessonCount: 24,
    duration:    '11h 15m',
    lessonIds:   ['ml-regression', 'ml-classification', 'feature-engineering', 'model-evaluation'],
    path:        '/tutorials/ml-regression',
  },
  {
    id:          'deep-learning',
    title:       'Deep Learning',
    description: 'Design and train neural networks with PyTorch — covering CNNs, RNNs, and modern architectures for real tasks.',
    difficulty:  'advanced',
    icon:        '🧠',
    accent:      'var(--color-danger)',
    lessonCount: 26,
    duration:    '13h 00m',
    lessonIds:   ['neural-networks-intro', 'convolutional-neural-networks'],
    path:        '/tutorials/neural-networks-intro',
  },
  {
    id:          'ai-agents',
    title:       'AI Agents',
    description: 'Design autonomous agents that plan, use tools, and reason over multiple steps to complete complex tasks.',
    difficulty:  'advanced',
    icon:        '🕹️',
    accent:      'var(--color-warning)',
    lessonCount: 16,
    duration:    '9h 30m',
    lessonIds:   ['ai-agents-intro', 'ai-agents-tool-use', 'ai-agents-planning'],
    path:        '/tutorials/ai-agents-intro',
  },
  {
    id:          'llm-engineering',
    title:       'LLM Engineering',
    description: 'Prompt, fine-tune, and deploy large language models — including retrieval-augmented generation pipelines.',
    difficulty:  'advanced',
    icon:        '💬',
    accent:      'var(--color-primary)',
    lessonCount: 18,
    duration:    '10h 15m',
    lessonIds:   ['transformers-attention', 'bert-fine-tuning', 'llm-prompting'],
    path:        '/tutorials/transformers-attention',
  },
  {
    id:          'mlops',
    title:       'MLOps',
    description: 'Package, deploy, monitor, and maintain machine learning systems in production with confidence.',
    difficulty:  'intermediate',
    icon:        '⚙️',
    accent:      'var(--color-code)',
    lessonCount: 15,
    duration:    '7h 45m',
    lessonIds:   ['mlops-packaging', 'mlops-deployment', 'mlops-monitoring'],
    path:        '/tutorials/mlops-packaging',
  },
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:            'tutorials-page',
  ROOT_DARK:       'tutorials-page--dark',
  ROOT_REDUCED:    'tutorials-page--reduced-motion',
  LIVE:            'tutorials-page__live',

  HERO:            'tutorials-hero',
  HERO_TITLE:      'tutorials-hero__title',
  HERO_SUB:        'tutorials-hero__sub',

  STATS:           'tutorials-stats',
  STAT:            'tutorials-stats__stat',
  STAT_VALUE:      'tutorials-stats__value',
  STAT_LABEL:      'tutorials-stats__label',

  GRID:            'tutorials-grid',
  CARD:            'tutorials-card',
  CARD_THUMB:      'tutorials-card__thumb',
  CARD_BADGE_DIFF: 'tutorials-card__badge-diff',
  CARD_BADGE_BEG:  'tutorials-card__badge-diff--beginner',
  CARD_BADGE_INT:  'tutorials-card__badge-diff--intermediate',
  CARD_BADGE_ADV:  'tutorials-card__badge-diff--advanced',
  CARD_BODY:       'tutorials-card__body',
  CARD_TITLE:      'tutorials-card__title',
  CARD_DESC:       'tutorials-card__desc',
  CARD_META:       'tutorials-card__meta',
  CARD_META_ITEM:  'tutorials-card__meta-item',
  CARD_PROGRESS:   'tutorials-card__progress',
  CARD_BAR:        'tutorials-card__bar',
  CARD_BAR_FILL:   'tutorials-card__bar-fill',
  CARD_BAR_LABEL:  'tutorials-card__bar-label',
  CARD_CTA:        'tutorials-card__cta',
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
 * @returns {Function & { cancel: () => void }}
 */
function debounce(fn, ms) {
  let timer = null;
  const d = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  d.cancel = () => { clearTimeout(timer); timer = null; };
  return d;
}

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * @param {object|null} tracker
 * @returns {object}
 */
function getSummary(tracker) {
  const empty = { tutorials: { records: {} } };
  if (!tracker?.getSummary) return empty;
  try {
    const s = tracker.getSummary();
    return s && typeof s === 'object' ? s : empty;
  } catch {
    return empty;
  }
}

/**
 * Compute a course's completion percentage from its lesson IDs against
 * the tracker's tutorial completion records.
 *
 * @param {Course} course
 * @param {object} summary
 * @returns {number} 0-100
 */
function computeCoursePct(course, summary) {
  const records = summary?.tutorials?.records ?? {};
  const total   = course.lessonIds.length;
  if (total === 0) return 0;

  const completed = course.lessonIds.filter((id) => Boolean(records[id]?.completedAt)).length;
  return Math.round((completed / total) * 100);
}

// ---------------------------------------------------------------------------
// TutorialsPage — primary class
// ---------------------------------------------------------------------------

/**
 * Premium course catalog page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve theme, fetch initial progress summary
 *   3. mount()               — render, attach events
 *   4. refresh()             — re-fetch tracker data, patch course progress bars
 *   5. destroy()             — teardown listeners, DOM
 */
export default class TutorialsPage {

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

  /** @type {object} */ #summary = { tutorials: { records: {} } };

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null} */ #root       = null;
  /** @type {HTMLElement|null} */ #liveRegion = null;

  // ---- Debounced handlers ---------------------------------------------------

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

    this.#debouncedRefresh = debounce(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  // ---- Static router integration helpers -----------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new TutorialsPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker ?? null,
      router:      ctx?.meta?.router  ?? null,
      store:       ctx?.meta?.store   ?? null,
    });
    outlet.__tutorialsPage = instance;
    instance.#root = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__tutorialsPage?.destroy();
    delete outlet.__tutorialsPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve theme and fetch the initial progress summary.
   *
   * @returns {TutorialsPage} this
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
   * Render the page into the container and attach all event listeners.
   *
   * @returns {TutorialsPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[TutorialsPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.render();
    this.#attachEventListeners();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(TUTORIALS_EVENTS.MOUNTED, { pathname: '/tutorials' });
    this.#announce('Course catalog loaded.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {TutorialsPage} this
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
    this.#root.setAttribute('aria-label', 'Course Catalog — Python for AI');

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      ${this.#renderHero()}
      ${this.#renderStats()}

      <div id="tutorials-grid-region">
        ${this.#renderGrid()}
      </div>
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);

    return this;
  }

  /**
   * Re-fetch tracker data and patch the course grid's progress bars.
   *
   * @returns {TutorialsPage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    this.#summary = getSummary(this.#config.tracker);
    this.#replaceRegion('tutorials-grid-region', this.#renderGrid());

    this.#dispatch(TUTORIALS_EVENTS.UPDATED, { timestamp: Date.now() });
    return this;
  }

  /**
   * Tear down all listeners and clear the DOM.
   *
   * @returns {TutorialsPage} this
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

    this.#dispatch(TUTORIALS_EVENTS.DESTROYED, { pathname: '/tutorials' });
    return this;
  }

  // ---- Private: rendering ----------------------------------------------------

  /**
   * @returns {string}
   */
  #renderHero() {
    return `
      <header class="${CSS.HERO}">
        <h1 class="${CSS.HERO_TITLE}" tabindex="-1">Course Catalog</h1>
        <p class="${CSS.HERO_SUB}">
          Seven flagship tracks covering everything from your first line of Python
          to deploying production AI systems.
        </p>
      </header>
    `;
  }

  /**
   * @returns {string}
   */
  #renderStats() {
    const totalCourses = COURSE_CATALOGUE.length;
    const totalHours   = COURSE_CATALOGUE.reduce((sum, c) => {
      const match = c.duration.match(/(\d+)h\s*(\d+)?m?/);
      const hours = match ? Number(match[1]) + (Number(match[2] ?? 0) / 60) : 0;
      return sum + hours;
    }, 0);
    const totalLessons = COURSE_CATALOGUE.reduce((sum, c) => sum + c.lessonCount, 0);

    const stats = [
      { value: totalCourses, label: 'Courses' },
      { value: `${Math.round(totalHours)}h+`, label: 'Content' },
      { value: totalLessons, label: 'Lessons' },
    ];

    const items = stats.map((s) => `
      <div class="${CSS.STAT}" role="listitem">
        <span class="${CSS.STAT_VALUE}">${escapeHtml(String(s.value))}</span>
        <span class="${CSS.STAT_LABEL}">${escapeHtml(s.label)}</span>
      </div>
    `).join('');

    return `
      <div class="${CSS.STATS}" role="list" aria-label="Catalog statistics">
        ${items}
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderGrid() {
    const cards = COURSE_CATALOGUE.map((course) => this.#renderCard(course)).join('');

    return `
      <div class="${CSS.GRID}" role="list" aria-label="${COURSE_CATALOGUE.length} courses">
        ${cards}
      </div>
    `;
  }

  /**
   * Render a single premium course card.
   *
   * @param {Course} course
   * @returns {string}
   */
  #renderCard(course) {
    const pct = computeCoursePct(course, this.#summary);

    const diffLabel = course.difficulty.charAt(0).toUpperCase() + course.difficulty.slice(1);
    const diffClass = {
      beginner:     CSS.CARD_BADGE_BEG,
      intermediate: CSS.CARD_BADGE_INT,
      advanced:     CSS.CARD_BADGE_ADV,
    }[course.difficulty] ?? '';

    const ctaLabel = pct === 100 ? 'Review Course' : pct > 0 ? 'Continue Learning' : 'Start Learning';

    return `
      <article class="${CSS.CARD}"
               role="listitem"
               aria-labelledby="course-title-${escapeAttr(course.id)}">
        <div class="${CSS.CARD_THUMB}"
             aria-hidden="true"
             style="background:${course.accent}20;color:${course.accent}">
          <span style="font-size:2.5rem">${escapeHtml(course.icon)}</span>
        </div>

        <div class="${CSS.CARD_BODY}">
          <span class="${CSS.CARD_BADGE_DIFF} ${diffClass}">${escapeHtml(diffLabel)}</span>

          <h2 class="${CSS.CARD_TITLE}" id="course-title-${escapeAttr(course.id)}">
            ${escapeHtml(course.title)}
          </h2>

          <p class="${CSS.CARD_DESC}">${escapeHtml(course.description)}</p>

          <div class="${CSS.CARD_META}">
            <span class="${CSS.CARD_META_ITEM}" aria-label="${course.lessonCount} lessons">
              📝 ${course.lessonCount} lessons
            </span>
            <span class="${CSS.CARD_META_ITEM}" aria-label="${escapeAttr(course.duration)} estimated duration">
              🕐 ${escapeHtml(course.duration)}
            </span>
          </div>

          <div class="${CSS.CARD_PROGRESS}">
            <div class="${CSS.CARD_BAR}"
                 role="progressbar"
                 aria-valuenow="${pct}"
                 aria-valuemin="0"
                 aria-valuemax="100"
                 aria-label="${escapeAttr(course.title)}: ${pct}% complete">
              <div class="${CSS.CARD_BAR_FILL}"
                   style="width:${pct}%;background:${course.accent}"></div>
            </div>
            <span class="${CSS.CARD_BAR_LABEL}">${pct}% complete</span>
          </div>

          <button class="${CSS.CARD_CTA}"
                  type="button"
                  data-action="start-course"
                  data-id="${escapeAttr(course.id)}"
                  data-path="${escapeAttr(course.path)}"
                  aria-label="${escapeAttr(ctaLabel)}: ${escapeAttr(course.title)}"
                  style="--cta-accent:${course.accent}">
            ${escapeHtml(ctaLabel)}
          </button>
        </div>
      </article>
    `;
  }

  // ---- Private: DOM patching -------------------------------------------------

  /**
   * @param {string} id
   * @param {string} html
   */
  #replaceRegion(id, html) {
    const el = this.#root?.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  // ---- Private: event listeners -----------------------------------------------

  /**
   * Attach all external event subscriptions and DOM event delegation.
   */
  #attachEventListeners() {
    // Click delegation
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    // progress:updated -> debounced refresh
    const onProgressUpdated = () => this.#debouncedRefresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated)
    );

    // theme:changed -> toggle dark class
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
  }

  // ---- Private: click handler ---------------------------------------------

  /**
   * @param {MouseEvent} e
   */
  #handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (action === 'start-course') {
      const id     = actionEl.dataset.id ?? '';
      const path   = actionEl.dataset.path ?? '/tutorials';
      const course = COURSE_CATALOGUE.find((c) => c.id === id);

      this.#navigate(path);
      this.#dispatch(TUTORIALS_EVENTS.OPENED, { id, title: course?.title ?? id });
    }
  }

  // ---- Private: navigation helper ------------------------------------------

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

  // ---- Private: accessibility -----------------------------------------------

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

  // ---- Private: event bus -----------------------------------------------------

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