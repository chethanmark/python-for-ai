/**
 * =============================================================================
 * PLAYGROUND PAGE MODULE
 * scripts/pages/playground.js
 * -----------------------------------------------------------------------------
 * Interactive Python coding playground for the Python for AI educational
 * platform. Provides a Replit/Colab-inspired split-panel experience: a live
 * CodeEditor on the left and an output console on the right, with multiple
 * starter templates, snippet management, execution history, resizable panels,
 * fullscreen mode, and deep integration with the platform event bus.
 *
 * ARCHITECTURE:
 *   PlaygroundPage (default export)
 *     ├─ SnippetStore      — namespaced localStorage CRUD for saved snippets
 *     │                      (schema-versioned, auto-migrates)
 *     ├─ ExecutionHistory  — ring-buffer of run results (code + output + ts)
 *     └─ PanelResizer      — pointer-event drag handler for the split divider
 *
 * LAYOUT (rendered inside the router outlet):
 *   ┌─────────────────────────────────────────┐
 *   │  Playground Header (title, shortcuts)    │
 *   ├──────────────┬──────┬────────────────────┤
 *   │  Editor      │  ┤├  │  Console / Output  │
 *   │  (CodeEditor)│ drag │  (log, errors,      │
 *   │              │      │   history)          │
 *   └──────────────┴──────┴────────────────────┘
 *   │  Status bar (execution time, line/col)   │
 *   └─────────────────────────────────────────┘
 *
 * PANELS:
 *   Editor Panel  — full CodeEditor component with toolbar and status bar.
 *                   All editor keyboard shortcuts (Ctrl+S, Ctrl+/, etc.) work.
 *   Console Panel — tabs: Output | Errors | History
 *                   Output: stdout/stderr lines from Pyodide (or mock runner)
 *                   Errors: last Python traceback, formatted with line numbers
 *                   History: scrollable list of previous executions
 *
 * STARTER TEMPLATES:
 *   10 curated Python programs covering: Hello World, Variables, Functions,
 *   List Comprehension, NumPy, Pandas, Matplotlib mock, ML Linear Regression,
 *   Fibonacci Generator, and Decorator Pattern.
 *   Selecting a template replaces the editor content after confirmation.
 *
 * SNIPPET MANAGEMENT:
 *   saveSnippet()  — prompts for a name, stores { name, code, ts } to localStorage
 *   loadSnippet()  — renders a modal with all saved snippets, clicking one loads it
 *   Snippets are prefixed with 'pyai-playground-snippet-' and schema-versioned.
 *
 * EXECUTION:
 *   runCode()      — emits 'editor:run' with the current code value. The host
 *                    application (main.js / Pyodide loader) listens for this
 *                    event and calls back via 'playground:output' with the result.
 *   The playground also listens for 'editor:run' emitted by the CodeEditor's
 *   own Run button (Ctrl+Enter) and treats it identically.
 *
 * REACTIVE UPDATES:
 *   • editor:run           → set running state, clear output panel
 *   • playground:output    → receive { stdout, stderr, error } and render
 *   • theme:changed        → toggle dark CSS class on root
 *   • state:updated        → update user name / theme from store
 *   • router:afterNavigate → re-parse URL param ?template= and apply template
 *
 * KEYBOARD SHORTCUTS (global, not inside input/textarea):
 *   Ctrl+Enter  — Run code
 *   Ctrl+S      — Save snippet
 *   Ctrl+K      — Focus editor
 *   F11         — Toggle fullscreen
 *   Escape      — Exit fullscreen / close modal
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces run status, save confirmations, errors
 *   • role="log" on the output panel with aria-live="polite"
 *   • role="dialog" on the snippet modal with focus trap
 *   • Reduced motion: panel resize and modal animations are instant
 *   • All buttons have aria-label or visible text
 *   • Tab order: header → template selector → editor → controls → console
 *
 * PERFORMANCE:
 *   • CodeEditor is dynamically imported on first mount (code-split)
 *   • Execution history capped at 50 entries (ring buffer, O(1) push)
 *   • Output lines capped at 2 000 (oldest trimmed on overflow)
 *   • Panel resize uses pointer events; passive scroll listeners throughout
 *   • Autosave of editor draft is handled by CodeEditor itself (1500 ms debounce)
 *   • This module debounces its own side-effects at 200 ms
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/playground',
 *     title:     'Python Playground',
 *     component: () => import('./pages/playground.js'),
 *   }
 *
 * EXPORTS:
 *   PlaygroundPage   — primary class (default export)
 *   PLAYGROUND_EVENTS — event name constants
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
 * @type {Readonly<Record<string, string>>}
 */
export const PLAYGROUND_EVENTS = Object.freeze({
  MOUNTED:   'playground:mounted',
  RUN:       'playground:run',
  OUTPUT:    'playground:output',
  SAVED:     'playground:saved',
  LOADED:    'playground:loaded',
  DESTROYED: 'playground:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum lines retained in the output console */
const MAX_OUTPUT_LINES = 2_000;

/** Maximum entries in the execution history ring buffer */
const MAX_HISTORY = 50;

/** localStorage key prefix for saved snippets */
const SNIPPET_KEY_PREFIX = 'pyai-playground-snippet-';

/** localStorage key for the snippet index list */
const SNIPPET_INDEX_KEY = 'pyai-playground-snippets-index';

/** localStorage key for the last unsaved code */
const AUTOSAVE_KEY = 'pyai-playground-draft';

/** Snippet schema version */
const SNIPPET_VERSION = 1;

/** Default left panel width as a percentage */
const DEFAULT_PANEL_PCT = 55;

/** Minimum panel width in pixels */
const MIN_PANEL_PX = 200;

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  // Root
  ROOT:                   'playground',
  ROOT_DARK:              'playground--dark',
  ROOT_REDUCED:           'playground--reduced-motion',
  ROOT_FULLSCREEN:        'playground--fullscreen',
  ROOT_RUNNING:           'playground--running',

  // Live region
  LIVE:                   'playground__live',

  // Page header
  HEADER:                 'playground-header',
  HEADER_INNER:           'playground-header__inner',
  HEADER_TITLE:           'playground-header__title',
  HEADER_SUBTITLE:        'playground-header__subtitle',
  HEADER_ACTIONS:         'playground-header__actions',
  HEADER_BTN:             'playground-header__btn',
  HEADER_BTN_PRIMARY:     'playground-header__btn--primary',
  HEADER_BTN_ACTIVE:      'playground-header__btn--active',

  // Template bar
  TEMPLATES:              'playground-templates',
  TEMPLATES_INNER:        'playground-templates__inner',
  TEMPLATES_LABEL:        'playground-templates__label',
  TEMPLATE_SELECT:        'playground-templates__select',
  TEMPLATE_APPLY:         'playground-templates__apply',

  // Split layout
  SPLIT:                  'playground-split',
  PANEL_EDITOR:           'playground-panel-editor',
  PANEL_CONSOLE:          'playground-panel-console',
  DIVIDER:                'playground-divider',
  DIVIDER_HANDLE:         'playground-divider__handle',

  // Editor panel
  EDITOR_HEADER:          'playground-editor__header',
  EDITOR_TITLE:           'playground-editor__title',
  EDITOR_CONTROLS:        'playground-editor__controls',
  EDITOR_BTN:             'playground-editor__btn',
  EDITOR_BTN_RUN:         'playground-editor__btn-run',
  EDITOR_BTN_RUN_ACTIVE:  'playground-editor__btn-run--running',
  EDITOR_BTN_RESET:       'playground-editor__btn-reset',
  EDITOR_BTN_FORMAT:      'playground-editor__btn-format',
  EDITOR_FONT_SIZE:       'playground-editor__font-size',
  EDITOR_FONT_BTN:        'playground-editor__font-btn',
  EDITOR_FONT_DISPLAY:    'playground-editor__font-display',
  EDITOR_CONTAINER:       'playground-editor__container',

  // Console panel
  CONSOLE_HEADER:         'playground-console__header',
  CONSOLE_TABS:           'playground-console__tabs',
  CONSOLE_TAB:            'playground-console__tab',
  CONSOLE_TAB_ACTIVE:     'playground-console__tab--active',
  CONSOLE_BADGE:          'playground-console__badge',
  CONSOLE_ACTIONS:        'playground-console__actions',
  CONSOLE_BTN:            'playground-console__btn',
  CONSOLE_BODY:           'playground-console__body',
  CONSOLE_OUTPUT:         'playground-console__output',
  CONSOLE_OUTPUT_LINE:    'playground-console__output-line',
  CONSOLE_OUTPUT_STDOUT:  'playground-console__output-line--stdout',
  CONSOLE_OUTPUT_STDERR:  'playground-console__output-line--stderr',
  CONSOLE_OUTPUT_ERROR:   'playground-console__output-line--error',
  CONSOLE_OUTPUT_INFO:    'playground-console__output-line--info',
  CONSOLE_OUTPUT_EMPTY:   'playground-console__empty',
  CONSOLE_ERROR:          'playground-console__error',
  CONSOLE_ERROR_TITLE:    'playground-console__error-title',
  CONSOLE_ERROR_TRACE:    'playground-console__error-trace',
  CONSOLE_HISTORY:        'playground-console__history',
  CONSOLE_HIST_ITEM:      'playground-console__hist-item',
  CONSOLE_HIST_META:      'playground-console__hist-meta',
  CONSOLE_HIST_CODE:      'playground-console__hist-code',
  CONSOLE_HIST_OUT:       'playground-console__hist-out',
  CONSOLE_HIST_RESTORE:   'playground-console__hist-restore',
  CONSOLE_RUNNING:        'playground-console__running',
  CONSOLE_RUNNING_DOTS:   'playground-console__running-dots',

  // Status bar
  STATUS:                 'playground-status',
  STATUS_LEFT:            'playground-status__left',
  STATUS_RIGHT:           'playground-status__right',
  STATUS_ITEM:            'playground-status__item',
  STATUS_DOT:             'playground-status__dot',
  STATUS_DOT_IDLE:        'playground-status__dot--idle',
  STATUS_DOT_RUNNING:     'playground-status__dot--running',
  STATUS_DOT_OK:          'playground-status__dot--ok',
  STATUS_DOT_ERROR:       'playground-status__dot--error',

  // Snippet modal
  MODAL_OVERLAY:          'playground-modal-overlay',
  MODAL:                  'playground-modal',
  MODAL_HEADER:           'playground-modal__header',
  MODAL_TITLE:            'playground-modal__title',
  MODAL_CLOSE:            'playground-modal__close',
  MODAL_BODY:             'playground-modal__body',
  MODAL_LIST:             'playground-modal__list',
  MODAL_ITEM:             'playground-modal__item',
  MODAL_ITEM_NAME:        'playground-modal__item-name',
  MODAL_ITEM_META:        'playground-modal__item-meta',
  MODAL_ITEM_ACTIONS:     'playground-modal__item-actions',
  MODAL_ITEM_LOAD:        'playground-modal__item-load',
  MODAL_ITEM_DELETE:      'playground-modal__item-delete',
  MODAL_EMPTY:            'playground-modal__empty',
  MODAL_FOOTER:           'playground-modal__footer',
});

// ---------------------------------------------------------------------------
// Starter templates
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, label: string, icon: string, code: string }} Template
 */

/** @type {ReadonlyArray<Template>} */
const TEMPLATES = Object.freeze([
  {
    id:    'hello-world',
    label: 'Hello World',
    icon:  '👋',
    code:  `# Hello, Python for AI!\nprint("Hello, World!")\nprint("Welcome to the Python AI Playground.")\nprint(f"Python is {'awesome'}!")\n`,
  },
  {
    id:    'variables',
    label: 'Variables',
    icon:  '📦',
    code:  `# Variables and data types\nname = "Ada Lovelace"\nage = 36\npi = 3.14159\nis_programmer = True\n\nprint(f"Name: {name}")\nprint(f"Age: {age}")\nprint(f"Pi: {pi:.4f}")\nprint(f"Is programmer: {is_programmer}")\nprint(f"Type of name: {type(name).__name__}")\n`,
  },
  {
    id:    'functions',
    label: 'Functions',
    icon:  '⚙️',
    code:  `# Functions and closures\ndef make_counter(start=0):\n    """Return a counter function that increments on each call."""\n    count = [start]\n    def counter():\n        count[0] += 1\n        return count[0]\n    return counter\n\ncounter_a = make_counter()\ncounter_b = make_counter(10)\n\nprint(counter_a())  # 1\nprint(counter_a())  # 2\nprint(counter_b())  # 11\nprint(counter_b())  # 12\n`,
  },
  {
    id:    'list-comp',
    label: 'List Comprehension',
    icon:  '📋',
    code:  `# List comprehensions and generators\nnumbers = list(range(1, 21))\n\n# List comprehension\nsquares_of_evens = [x ** 2 for x in numbers if x % 2 == 0]\nprint("Squares of evens:", squares_of_evens)\n\n# Nested comprehension — flatten a 2D matrix\nmatrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]\nflat = [val for row in matrix for val in row]\nprint("Flattened matrix:", flat)\n\n# Dictionary comprehension\nword_lengths = {word: len(word) for word in ["python", "AI", "machine", "learning"]}\nprint("Word lengths:", word_lengths)\n`,
  },
  {
    id:    'numpy',
    label: 'NumPy Arrays',
    icon:  '🔢',
    code:  `import numpy as np\n\n# Array creation\na = np.array([1, 2, 3, 4, 5], dtype=np.float64)\nb = np.linspace(0, 1, 5)\nc = np.zeros((3, 3))\n\nprint("Array a:", a)\nprint("Array b:", b)\nprint("Zeros 3x3:\\n", c)\n\n# Vectorised operations\nprint("\\na ** 2:", a ** 2)\nprint("Mean:", a.mean())\nprint("Std:", a.std().round(4))\n\n# Broadcasting\nresult = a[:, np.newaxis] + b  # outer sum\nprint("\\nOuter sum shape:", result.shape)\n`,
  },
  {
    id:    'pandas',
    label: 'Pandas DataFrame',
    icon:  '📊',
    code:  `import pandas as pd\n\n# Create a DataFrame\ndata = {\n    "name":   ["Alice", "Bob", "Carol", "Dave"],\n    "score":  [92, 87, 95, 78],\n    "passed": [True, True, True, False],\n}\ndf = pd.DataFrame(data)\n\nprint("DataFrame:")\nprint(df)\nprint("\\nDescribe:")\nprint(df["score"].describe())\n\n# Filtering\npassers = df[df["passed"] == True]\nprint("\\nPassed students:")\nprint(passers[["name", "score"]])\n\n# GroupBy\nprint("\\nAverage score by pass status:")\nprint(df.groupby("passed")["score"].mean())\n`,
  },
  {
    id:    'ml-regression',
    label: 'Linear Regression',
    icon:  '📈',
    code:  `import numpy as np\n\n# Simple linear regression from scratch\ndef linear_regression(X, y, lr=0.01, epochs=100):\n    m, b = 0.0, 0.0\n    n = len(X)\n    for _ in range(epochs):\n        y_pred = m * X + b\n        dm = (-2 / n) * np.sum(X * (y - y_pred))\n        db = (-2 / n) * np.sum(y - y_pred)\n        m -= lr * dm\n        b -= lr * db\n    return m, b\n\n# Generate synthetic data: y = 2x + 5 + noise\nnp.random.seed(42)\nX = np.linspace(0, 10, 50)\ny = 2 * X + 5 + np.random.normal(0, 1, 50)\n\nm, b = linear_regression(X, y)\nprint(f"Fitted: y = {m:.3f}x + {b:.3f}")\nprint(f"Expected: y = 2.000x + 5.000")\n\n# Predict\nX_test = np.array([0, 5, 10])\ny_test = m * X_test + b\nfor xi, yi in zip(X_test, y_test):\n    print(f"  x={xi:.0f} → y={yi:.3f}")\n`,
  },
  {
    id:    'fibonacci',
    label: 'Fibonacci Generator',
    icon:  '🌀',
    code:  `# Fibonacci using a generator\ndef fibonacci():\n    """Infinite Fibonacci sequence generator."""\n    a, b = 0, 1\n    while True:\n        yield a\n        a, b = b, a + b\n\n# Take the first 15 values\nfib = fibonacci()\nsequence = [next(fib) for _ in range(15)]\nprint("First 15 Fibonacci numbers:")\nprint(sequence)\n\n# Check which are even\neven_fibs = [x for x in sequence if x % 2 == 0]\nprint("\\nEven Fibonacci numbers:")\nprint(even_fibs)\nprint(f"\\nSum of even Fibonacci (≤ 15 terms): {sum(even_fibs)}")\n`,
  },
  {
    id:    'decorator',
    label: 'Decorator Pattern',
    icon:  '🎁',
    code:  `import time\nimport functools\n\n# Memoisation decorator\ndef memoize(fn):\n    """Cache results of pure function calls."""\n    cache = {}\n    @functools.wraps(fn)\n    def wrapper(*args):\n        if args not in cache:\n            cache[args] = fn(*args)\n        return cache[args]\n    return wrapper\n\n# Timing decorator\ndef timer(fn):\n    """Measure and print execution time."""\n    @functools.wraps(fn)\n    def wrapper(*args, **kwargs):\n        start = time.perf_counter()\n        result = fn(*args, **kwargs)\n        elapsed = (time.perf_counter() - start) * 1000\n        print(f"{fn.__name__} took {elapsed:.3f} ms")\n        return result\n    return wrapper\n\n@timer\n@memoize\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(f"fib(30) = {fib(30)}")\nprint(f"fib(30) = {fib(30)}")  # instant — cached\n`,
  },
  {
    id:    'classes',
    label: 'OOP Example',
    icon:  '🏛️',
    code:  `# Object-Oriented Python\nclass Animal:\n    """Base class for all animals."""\n\n    def __init__(self, name: str, sound: str):\n        self._name  = name\n        self._sound = sound\n\n    @property\n    def name(self):\n        return self._name\n\n    def speak(self) -> str:\n        return f"{self._name} says: {self._sound}!"\n\n    def __repr__(self):\n        return f"{type(self).__name__}({self._name!r})"\n\n\nclass Dog(Animal):\n    def __init__(self, name: str, breed: str):\n        super().__init__(name, "Woof")\n        self.breed = breed\n\n    def fetch(self, item: str) -> str:\n        return f"{self._name} fetches the {item}."\n\n\ndog = Dog("Buddy", "Labrador")\nprint(dog.speak())\nprint(dog.fetch("ball"))\nprint(repr(dog))\n\nanimals = [Animal("Cat", "Meow"), dog, Animal("Cow", "Moo")]\nfor a in animals:\n    print(a.speak())\n`,
  },
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
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}

/**
 * Safe localStorage delete.
 * @param {string} key
 */
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* swallow */ }
}

/**
 * Format a Date as HH:MM:SS.
 * @param {Date} d
 * @returns {string}
 */
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Format an elapsed milliseconds count as a short human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
  if (ms < 1000)  return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// SnippetStore — namespaced localStorage CRUD for saved snippets
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, name: string, code: string, ts: number, version: number }} Snippet
 */

/**
 * Manages saved code snippets in localStorage.
 * Each snippet is stored under its own key; an index list tracks all IDs.
 */
class SnippetStore {
  /**
   * Load all saved snippets, sorted by most recently saved.
   * Silently discards malformed entries.
   *
   * @returns {Snippet[]}
   */
  loadAll() {
    const indexRaw = lsGet(SNIPPET_INDEX_KEY);
    if (!indexRaw) return [];

    let ids;
    try { ids = JSON.parse(indexRaw); } catch { return []; }

    return ids
      .map((id) => {
        const raw = lsGet(`${SNIPPET_KEY_PREFIX}${id}`);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts);
  }

  /**
   * Save a snippet. Generates a unique ID if new.
   *
   * @param {string} name
   * @param {string} code
   * @returns {Snippet}
   */
  save(name, code) {
    const id      = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const snippet = { id, name, code, ts: Date.now(), version: SNIPPET_VERSION };

    lsSet(`${SNIPPET_KEY_PREFIX}${id}`, JSON.stringify(snippet));
    this.#addToIndex(id);

    return snippet;
  }

  /**
   * Delete a snippet by ID.
   *
   * @param {string} id
   */
  delete(id) {
    lsRemove(`${SNIPPET_KEY_PREFIX}${id}`);
    this.#removeFromIndex(id);
  }

  /**
   * @param {string} id
   */
  #addToIndex(id) {
    const existing = this.#getIndex();
    if (!existing.includes(id)) {
      lsSet(SNIPPET_INDEX_KEY, JSON.stringify([...existing, id]));
    }
  }

  /**
   * @param {string} id
   */
  #removeFromIndex(id) {
    const existing = this.#getIndex();
    lsSet(SNIPPET_INDEX_KEY, JSON.stringify(existing.filter((i) => i !== id)));
  }

  /**
   * @returns {string[]}
   */
  #getIndex() {
    const raw = lsGet(SNIPPET_INDEX_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
}

// ---------------------------------------------------------------------------
// ExecutionHistory — ring buffer of past runs
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: number, code: string, stdout: string, stderr: string, error: string|null, ts: number, elapsedMs: number }} HistoryEntry
 */

/**
 * Fixed-capacity ring buffer for execution history.
 */
class ExecutionHistory {
  /** @type {HistoryEntry[]} */
  #buf  = new Array(MAX_HISTORY);
  /** @type {number} */
  #head = 0;
  /** @type {number} */
  #size = 0;
  /** @type {number} */
  #nextId = 1;

  /**
   * @param {Omit<HistoryEntry, 'id'>} entry
   * @returns {HistoryEntry}
   */
  push(entry) {
    const record = { ...entry, id: this.#nextId++ };
    this.#buf[this.#head] = record;
    this.#head = (this.#head + 1) % MAX_HISTORY;
    if (this.#size < MAX_HISTORY) this.#size++;
    return record;
  }

  /**
   * Return all entries in chronological order (oldest first).
   * @returns {HistoryEntry[]}
   */
  all() {
    const start  = this.#size < MAX_HISTORY ? 0 : this.#head;
    const result = [];
    for (let i = 0; i < this.#size; i++) {
      const entry = this.#buf[(start + i) % MAX_HISTORY];
      if (entry) result.push(entry);
    }
    return result;
  }

  clear() {
    this.#buf  = new Array(MAX_HISTORY);
    this.#head = 0;
    this.#size = 0;
  }

  /** @returns {number} */
  get size() { return this.#size; }
}

// ---------------------------------------------------------------------------
// PanelResizer — pointer-event drag handler for the split divider
// ---------------------------------------------------------------------------

/**
 * Enables drag-to-resize on the split divider between editor and console panels.
 * Uses pointer events for touch and mouse support.
 * Cleans up all listeners on destroy().
 */
class PanelResizer {
  /** @type {HTMLElement|null} */ #divider      = null;
  /** @type {HTMLElement|null} */ #panelEditor  = null;
  /** @type {HTMLElement|null} */ #panelConsole = null;
  /** @type {HTMLElement|null} */ #container    = null;
  /** @type {boolean}          */ #dragging     = false;
  /** @type {number}           */ #startX       = 0;
  /** @type {number}           */ #startPct     = DEFAULT_PANEL_PCT;
  /** @type {Array<() => void>}*/ #cleanup       = [];

  /**
   * @param {{
   *   divider:    HTMLElement,
   *   editor:     HTMLElement,
   *   console:    HTMLElement,
   *   container:  HTMLElement,
   *   initialPct: number,
   * }} opts
   */
  init({ divider, editor, console: consoleEl, container, initialPct }) {
    this.#divider      = divider;
    this.#panelEditor  = editor;
    this.#panelConsole = consoleEl;
    this.#container    = container;
    this.#startPct     = initialPct;

    this.#applyPct(initialPct);

    const onPointerDown = (e) => {
      this.#dragging = true;
      this.#startX   = e.clientX;
      this.#startPct = this.#currentPct();
      divider.setPointerCapture(e.pointerId);
      divider.classList.add('playground-divider--dragging');
    };

    const onPointerMove = (e) => {
      if (!this.#dragging) return;
      const containerW = this.#container?.clientWidth ?? 1;
      const delta      = e.clientX - this.#startX;
      const deltaPct   = (delta / containerW) * 100;
      const newPct     = Math.max(
        (MIN_PANEL_PX / containerW) * 100,
        Math.min(100 - (MIN_PANEL_PX / containerW) * 100, this.#startPct + deltaPct)
      );
      this.#applyPct(newPct);
    };

    const onPointerUp = () => {
      if (!this.#dragging) return;
      this.#dragging = false;
      divider.classList.remove('playground-divider--dragging');
    };

    divider.addEventListener('pointerdown',  onPointerDown);
    divider.addEventListener('pointermove',  onPointerMove);
    divider.addEventListener('pointerup',    onPointerUp);
    divider.addEventListener('pointercancel',onPointerUp);

    this.#cleanup.push(() => {
      divider.removeEventListener('pointerdown',  onPointerDown);
      divider.removeEventListener('pointermove',  onPointerMove);
      divider.removeEventListener('pointerup',    onPointerUp);
      divider.removeEventListener('pointercancel',onPointerUp);
    });
  }

  destroy() {
    this.#cleanup.forEach((fn) => fn());
    this.#cleanup = [];
  }

  /**
   * @param {number} pct — left panel percentage (0–100)
   */
  #applyPct(pct) {
    if (this.#panelEditor)  this.#panelEditor.style.flexBasis  = `${pct}%`;
    if (this.#panelConsole) this.#panelConsole.style.flexBasis = `${100 - pct}%`;
  }

  /**
   * @returns {number}
   */
  #currentPct() {
    const total = this.#container?.clientWidth ?? 1;
    return ((this.#panelEditor?.clientWidth ?? 0) / total) * 100;
  }
}

// ---------------------------------------------------------------------------
// PlaygroundPage — primary class
// ---------------------------------------------------------------------------

/**
 * Interactive Python playground page.
 *
 * Lifecycle:
 *   1. constructor(config)   — no DOM side-effects
 *   2. initialize()          — resolve theme, parse URL params
 *   3. mount()               — render HTML, mount editor, attach events
 *   4. runCode()             — emit editor:run with current code
 *   5. reset()               — clear editor to selected template
 *   6. saveSnippet()         — prompt for name, persist to SnippetStore
 *   7. loadSnippet()         — render modal, let user pick a snippet
 *   8. destroy()             — clean up all state, editor, listeners
 */
export default class PlaygroundPage {

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

  /** @type {boolean}         */ #mounted     = false;
  /** @type {boolean}         */ #destroyed   = false;
  /** @type {string}          */ #theme       = 'light';
  /** @type {boolean}         */ #fullscreen  = false;
  /** @type {boolean}         */ #running     = false;
  /** @type {string}          */ #activeTab   = 'output';
  /** @type {string}          */ #selectedTemplate = 'hello-world';
  /** @type {number}          */ #fontSize    = 14;
  /** @type {number}          */ #runCount    = 0;
  /** @type {number}          */ #errorCount  = 0;
  /** @type {number|null}     */ #runStart    = null;

  /** @type {Array<{ type: 'stdout'|'stderr'|'info'|'error', text: string }>} */
  #outputLines = [];

  /** @type {string|null} — last error traceback */
  #lastError = null;

  // ---- Sub-systems ---------------------------------------------------------

  /** @type {SnippetStore}      */ #snippets;
  /** @type {ExecutionHistory}  */ #history;
  /** @type {PanelResizer}      */ #resizer;

  // ---- CodeEditor instance (dynamically imported) --------------------------

  /** @type {import('../components/code-editor.js').CodeEditor|null} */
  #editor = null;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}      */ #root          = null;
  /** @type {HTMLElement|null}      */ #liveRegion    = null;
  /** @type {HTMLElement|null}      */ #outputEl      = null;
  /** @type {HTMLElement|null}      */ #errorEl       = null;
  /** @type {HTMLElement|null}      */ #historyEl     = null;
  /** @type {HTMLElement|null}      */ #statusDotEl   = null;
  /** @type {HTMLElement|null}      */ #statusTextEl  = null;
  /** @type {HTMLElement|null}      */ #runBtnEl      = null;
  /** @type {HTMLElement|null}      */ #fontDisplayEl = null;
  /** @type {HTMLElement|null}      */ #histBadgeEl   = null;

  // ---- Debounced handlers --------------------------------------------------

  /** @type {Function & { cancel: () => void }} */
  #debouncedAutosave;

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

    this.#snippets = new SnippetStore();
    this.#history  = new ExecutionHistory();
    this.#resizer  = new PanelResizer();

    this.#debouncedAutosave = debounce(
      () => this.#persistDraft(),
      500
    );
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new PlaygroundPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker ?? null,
      router:      ctx?.meta?.router  ?? null,
      store:       ctx?.meta?.store   ?? null,
    });
    outlet.__playgroundPage = instance;
    instance.#root          = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__playgroundPage?.destroy();
    delete outlet.__playgroundPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve theme, parse URL params (e.g. ?template=fibonacci).
   *
   * @returns {PlaygroundPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    // Apply URL ?template= param
    try {
      const params = new URLSearchParams(window.location.search);
      const tpl    = params.get('template');
      if (tpl && TEMPLATES.some((t) => t.id === tpl)) {
        this.#selectedTemplate = tpl;
      }
    } catch { /* ignore */ }

    return this;
  }

  /**
   * Render the page and mount all sub-systems.
   *
   * @returns {PlaygroundPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[PlaygroundPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.render();
    this.#cacheRefs();
    this.#attachEventListeners();
    this.#mountEditor();
    this.#initResizer();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(PLAYGROUND_EVENTS.MOUNTED, { pathname: '/playground' });
    this.#announce('Python playground ready. Press Ctrl+Enter to run your code.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {PlaygroundPage} this
   */
  render() {
    if (!this.#root) return this;

    const isDark   = this.#theme === 'dark';
    const reduced  = prefersReducedMotion();

    this.#root.className = [
      CSS.ROOT,
      isDark   ? CSS.ROOT_DARK    : '',
      reduced  ? CSS.ROOT_REDUCED : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', 'Python AI Playground');

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      ${this.#renderHeader()}
      ${this.#renderTemplateBar()}
      ${this.#renderSplit()}
      ${this.#renderStatusBar()}
    `;

    return this;
  }

  /**
   * Run the current code in the editor.
   * Emits 'playground:run' and 'editor:run' for Pyodide integration.
   *
   * @returns {PlaygroundPage} this
   */
  runCode() {
    if (this.#running) return this;

    const code = this.#editor?.getValue() ?? '';
    if (!code.trim()) {
      this.#announce('Nothing to run — editor is empty.');
      return this;
    }

    this.#setRunning(true);
    this.#clearOutputPanel();
    this.#appendOutputLine('info', `▶ Running… (${formatTime(new Date())})`);
    this.#runStart = Date.now();

    this.#dispatch(PLAYGROUND_EVENTS.RUN, { code });
    this.#dispatch('editor:run', { value: code });

    // If Pyodide is not connected, simulate completion after 3 s
    this.#scheduleRunTimeout();

    return this;
  }

  /**
   * Reset the editor to the selected template code.
   *
   * @returns {PlaygroundPage} this
   */
  reset() {
    const template = TEMPLATES.find((t) => t.id === this.#selectedTemplate)
      ?? TEMPLATES[0];

    if (this.#editor) {
      this.#editor.setValue(template.code);
    }

    this.#clearOutputPanel();
    this.#lastError = null;
    this.#renderActiveTab();
    this.#announce(`Editor reset to "${template.label}" template.`);

    return this;
  }

  /**
   * Prompt for a snippet name and save the current code.
   *
   * @returns {PlaygroundPage} this
   */
  saveSnippet() {
    const code = this.#editor?.getValue() ?? '';
    if (!code.trim()) {
      this.#announce('Nothing to save — editor is empty.');
      return this;
    }

    const name = window.prompt('Save snippet as:', `My Snippet ${this.#history.size + 1}`);
    if (!name) return this;  // user cancelled

    const snippet = this.#snippets.save(name.trim() || 'Untitled', code);
    this.#announce(`Snippet "${snippet.name}" saved.`);
    this.#dispatch(PLAYGROUND_EVENTS.SAVED, { id: snippet.id, name: snippet.name });

    return this;
  }

  /**
   * Open the snippet browser modal.
   *
   * @returns {PlaygroundPage} this
   */
  loadSnippet() {
    this.#renderSnippetModal();
    return this;
  }

  /**
   * Tear down all sub-systems, editor, listeners, and DOM.
   *
   * @returns {PlaygroundPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedAutosave.flush();
    this.#debouncedAutosave.cancel();

    this.#resizer.destroy();
    this.#destroyEditor();

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

    this.#dispatch(PLAYGROUND_EVENTS.DESTROYED, { pathname: '/playground' });
    return this;
  }

  // ---- Private: rendering --------------------------------------------------

  /**
   * @returns {string}
   */
  #renderHeader() {
    return `
      <header class="${CSS.HEADER}">
        <div class="${CSS.HEADER_INNER}">
          <div>
            <h1 class="${CSS.HEADER_TITLE}" tabindex="-1">
              ⌨️ Python Playground
            </h1>
            <p class="${CSS.HEADER_SUBTITLE}">
              Write, run, and experiment with Python directly in your browser.
            </p>
          </div>
          <div class="${CSS.HEADER_ACTIONS}">
            <button class="${CSS.HEADER_BTN} ${CSS.HEADER_BTN_PRIMARY}"
                    id="pg-run-header-btn"
                    type="button"
                    data-action="run"
                    aria-label="Run code (Ctrl+Enter)">
              ▶ Run
            </button>
            <button class="${CSS.HEADER_BTN}"
                    type="button"
                    data-action="save-snippet"
                    aria-label="Save code as snippet (Ctrl+S)">
              💾 Save
            </button>
            <button class="${CSS.HEADER_BTN}"
                    type="button"
                    data-action="load-snippet"
                    aria-label="Load saved snippet">
              📂 Load
            </button>
            <button class="${CSS.HEADER_BTN} ${this.#fullscreen ? CSS.HEADER_BTN_ACTIVE : ''}"
                    id="pg-fullscreen-btn"
                    type="button"
                    data-action="toggle-fullscreen"
                    aria-pressed="${this.#fullscreen}"
                    aria-label="${this.#fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} (F11)">
              ${this.#fullscreen ? '⤡ Exit Full' : '⤢ Fullscreen'}
            </button>
          </div>
        </div>
      </header>
    `;
  }

  /**
   * @returns {string}
   */
  #renderTemplateBar() {
    const options = TEMPLATES.map((t) => `
      <option value="${escapeAttr(t.id)}"
              ${this.#selectedTemplate === t.id ? 'selected' : ''}>
        ${escapeHtml(t.icon)} ${escapeHtml(t.label)}
      </option>
    `).join('');

    return `
      <div class="${CSS.TEMPLATES}">
        <div class="${CSS.TEMPLATES_INNER}">
          <span class="${CSS.TEMPLATES_LABEL}" id="template-label">
            Starter Template:
          </span>
          <label for="pg-template-select" class="sr-only">Select starter template</label>
          <select class="${CSS.TEMPLATE_SELECT}"
                  id="pg-template-select"
                  aria-labelledby="template-label"
                  data-action="select-template">
            ${options}
          </select>
          <button class="${CSS.TEMPLATE_APPLY}"
                  type="button"
                  data-action="apply-template"
                  aria-label="Load selected template into editor">
            Load Template
          </button>
        </div>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderSplit() {
    return `
      <div class="${CSS.SPLIT}" id="pg-split">

        <!-- LEFT: Editor panel -->
        <div class="${CSS.PANEL_EDITOR}"
             id="pg-panel-editor"
             role="region"
             aria-label="Code editor panel">
          <div class="${CSS.EDITOR_HEADER}">
            <span class="${CSS.EDITOR_TITLE}">🐍 Python</span>
            <div class="${CSS.EDITOR_CONTROLS}">
              <!-- Font size controls -->
              <div class="${CSS.EDITOR_FONT_SIZE}" aria-label="Font size controls">
                <button class="${CSS.EDITOR_FONT_BTN}"
                        type="button"
                        data-action="font-decrease"
                        aria-label="Decrease font size">A−</button>
                <span class="${CSS.EDITOR_FONT_DISPLAY}"
                      id="pg-font-display"
                      aria-live="polite"
                      aria-label="Font size">
                  ${this.#fontSize}px
                </span>
                <button class="${CSS.EDITOR_FONT_BTN}"
                        type="button"
                        data-action="font-increase"
                        aria-label="Increase font size">A+</button>
              </div>
              <button class="${CSS.EDITOR_BTN}"
                      type="button"
                      data-action="copy-code"
                      aria-label="Copy code to clipboard">
                📋 Copy
              </button>
              <button class="${CSS.EDITOR_BTN}"
                      type="button"
                      data-action="download"
                      aria-label="Download code as .py file">
                ⬇ Download
              </button>
              <button class="${CSS.EDITOR_BTN}"
                      type="button"
                      data-action="upload"
                      aria-label="Upload .py file">
                ⬆ Upload
              </button>
              <button class="${CSS.EDITOR_BTN} ${CSS.EDITOR_BTN_RUN}"
                      id="pg-run-btn"
                      type="button"
                      data-action="run"
                      aria-label="Run code (Ctrl+Enter)"
                      aria-busy="${this.#running}">
                ${this.#running ? '⏸ Running…' : '▶ Run'}
              </button>
              <button class="${CSS.EDITOR_BTN} ${CSS.EDITOR_BTN_RESET}"
                      type="button"
                      data-action="reset"
                      aria-label="Reset editor to template">
                ↺ Reset
              </button>
            </div>
          </div>

          <!-- CodeEditor mounts here -->
          <div class="${CSS.EDITOR_CONTAINER}"
               id="pg-editor-container"
               aria-label="Python code editor">
          </div>

          <!-- Hidden file input for upload -->
          <input type="file"
                 id="pg-upload-input"
                 accept=".py,text/x-python,text/plain"
                 aria-hidden="true"
                 tabindex="-1"
                 style="position:absolute;width:1px;height:1px;overflow:hidden;
                        clip:rect(0,0,0,0);white-space:nowrap;border:0">
        </div>

        <!-- DIVIDER -->
        <div class="${CSS.DIVIDER}"
             id="pg-divider"
             role="separator"
             aria-label="Drag to resize panels"
             aria-orientation="vertical"
             tabindex="0">
          <div class="${CSS.DIVIDER_HANDLE}" aria-hidden="true">⋮</div>
        </div>

        <!-- RIGHT: Console panel -->
        <div class="${CSS.PANEL_CONSOLE}"
             id="pg-panel-console"
             role="region"
             aria-label="Output console panel">
          <div class="${CSS.CONSOLE_HEADER}">
            <div class="${CSS.CONSOLE_TABS}" role="tablist" aria-label="Console tabs">
              ${this.#renderConsoleTabs()}
            </div>
            <div class="${CSS.CONSOLE_ACTIONS}">
              <button class="${CSS.CONSOLE_BTN}"
                      type="button"
                      data-action="clear-console"
                      aria-label="Clear output">
                🗑 Clear
              </button>
            </div>
          </div>
          <div class="${CSS.CONSOLE_BODY}" id="pg-console-body">
            ${this.#renderOutputTab()}
          </div>
        </div>

      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderConsoleTabs() {
    const tabs = [
      { id: 'output',  label: 'Output',  badge: false },
      { id: 'errors',  label: 'Errors',  badge: true  },
      { id: 'history', label: 'History', badge: true  },
    ];

    return tabs.map((t) => {
      const isActive = this.#activeTab === t.id;
      let badge = '';
      if (t.id === 'errors' && this.#errorCount > 0) {
        badge = `<span class="${CSS.CONSOLE_BADGE}" aria-label="${this.#errorCount} errors">${this.#errorCount}</span>`;
      }
      if (t.id === 'history' && this.#history.size > 0) {
        badge = `<span class="${CSS.CONSOLE_BADGE}" id="pg-hist-badge" aria-label="${this.#history.size} runs">${this.#history.size}</span>`;
      }
      return `
        <button class="${CSS.CONSOLE_TAB} ${isActive ? CSS.CONSOLE_TAB_ACTIVE : ''}"
                type="button"
                role="tab"
                id="tab-${escapeAttr(t.id)}"
                data-action="console-tab"
                data-tab="${escapeAttr(t.id)}"
                aria-selected="${isActive}"
                aria-controls="pg-console-body">
          ${escapeHtml(t.label)}${badge}
        </button>
      `;
    }).join('');
  }

  /**
   * @returns {string}
   */
  #renderOutputTab() {
    if (this.#running) {
      return `
        <div class="${CSS.CONSOLE_RUNNING}" role="status" aria-label="Code is running">
          <span>Running</span>
          <span class="${CSS.CONSOLE_RUNNING_DOTS}" aria-hidden="true">…</span>
        </div>
      `;
    }

    if (this.#outputLines.length === 0) {
      return `
        <p class="${CSS.CONSOLE_OUTPUT_EMPTY}">
          Run your code to see output here.
        </p>
      `;
    }

    const lines = this.#outputLines.map((line) => {
      const cls = {
        stdout: CSS.CONSOLE_OUTPUT_STDOUT,
        stderr: CSS.CONSOLE_OUTPUT_STDERR,
        error:  CSS.CONSOLE_OUTPUT_ERROR,
        info:   CSS.CONSOLE_OUTPUT_INFO,
      }[line.type] ?? '';

      return `<div class="${CSS.CONSOLE_OUTPUT_LINE} ${cls}">${escapeHtml(line.text)}</div>`;
    }).join('');

    return `
      <div class="${CSS.CONSOLE_OUTPUT}"
           id="pg-output-panel"
           role="log"
           aria-label="Code output"
           aria-live="polite"
           aria-relevant="additions">
        ${lines}
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderErrorTab() {
    if (!this.#lastError) {
      return `
        <p class="${CSS.CONSOLE_OUTPUT_EMPTY}">No errors from last run.</p>
      `;
    }

    const lines = this.#lastError
      .split('\n')
      .map((l) => `<div>${escapeHtml(l)}</div>`)
      .join('');

    return `
      <div class="${CSS.CONSOLE_ERROR}">
        <p class="${CSS.CONSOLE_ERROR_TITLE}">⚠️ Error</p>
        <pre class="${CSS.CONSOLE_ERROR_TRACE}"
             tabindex="0"
             aria-label="Python traceback">${lines}</pre>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderHistoryTab() {
    const entries = this.#history.all().reverse(); // most recent first

    if (entries.length === 0) {
      return `<p class="${CSS.CONSOLE_OUTPUT_EMPTY}">No runs yet.</p>`;
    }

    const items = entries.map((entry) => {
      const preview = entry.code.split('\n').slice(0, 3).join('\n');
      const outPreview = (entry.stdout + entry.stderr).trim().split('\n').slice(0, 3).join('\n');

      return `
        <div class="${CSS.CONSOLE_HIST_ITEM}">
          <div class="${CSS.CONSOLE_HIST_META}">
            <span>${formatTime(new Date(entry.ts))}</span>
            <span>${formatElapsed(entry.elapsedMs)}</span>
            ${entry.error ? '<span aria-label="Error">⚠️</span>' : '<span aria-label="Success">✅</span>'}
            <button class="${CSS.CONSOLE_HIST_RESTORE}"
                    type="button"
                    data-action="restore-history"
                    data-history-id="${entry.id}"
                    aria-label="Restore this code to the editor">
              ↩ Restore
            </button>
          </div>
          <pre class="${CSS.CONSOLE_HIST_CODE}"
               tabindex="0"
               aria-label="Code from this run">${escapeHtml(preview.length < entry.code.length ? preview + '\n…' : preview)}</pre>
          ${outPreview ? `
            <pre class="${CSS.CONSOLE_HIST_OUT}"
                 aria-label="Output preview">${escapeHtml(outPreview)}</pre>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="${CSS.CONSOLE_HISTORY}"
           role="log"
           aria-label="Execution history">
        ${items}
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderStatusBar() {
    return `
      <div class="${CSS.STATUS}" role="status" aria-label="Playground status">
        <div class="${CSS.STATUS_LEFT}">
          <span class="${CSS.STATUS_DOT} ${CSS.STATUS_DOT_IDLE}"
                id="pg-status-dot"
                aria-hidden="true"></span>
          <span class="${CSS.STATUS_ITEM}"
                id="pg-status-text">
            Ready
          </span>
          <span class="${CSS.STATUS_ITEM}">
            ${this.#runCount} run${this.#runCount !== 1 ? 's' : ''} this session
          </span>
        </div>
        <div class="${CSS.STATUS_RIGHT}">
          <span class="${CSS.STATUS_ITEM}">
            Python for AI Playground
          </span>
          <span class="${CSS.STATUS_ITEM}" aria-label="Keyboard shortcuts">
            Ctrl+Enter: Run · Ctrl+S: Save · F11: Fullscreen
          </span>
        </div>
      </div>
    `;
  }

  // ---- Private: snippet modal ---------------------------------------------

  /**
   * Render and inject the snippet browser modal with a focus trap.
   */
  #renderSnippetModal() {
    const existing = document.getElementById('pg-snippet-modal');
    if (existing) { existing.remove(); return; }

    const snippets = this.#snippets.loadAll();

    let body;
    if (snippets.length === 0) {
      body = `<p class="${CSS.MODAL_EMPTY}">No snippets saved yet. Write some code and press Save!</p>`;
    } else {
      const items = snippets.map((s) => {
        const preview = s.code.split('\n').slice(0, 2).join('\n');
        const date    = new Date(s.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `
          <div class="${CSS.MODAL_ITEM}">
            <div>
              <span class="${CSS.MODAL_ITEM_NAME}">${escapeHtml(s.name)}</span>
              <span class="${CSS.MODAL_ITEM_META}">Saved ${escapeHtml(date)}</span>
              <pre style="margin:0;font-size:0.75rem;opacity:0.7;overflow:hidden;max-height:2.5rem">${escapeHtml(preview)}</pre>
            </div>
            <div class="${CSS.MODAL_ITEM_ACTIONS}">
              <button class="${CSS.MODAL_ITEM_LOAD}"
                      type="button"
                      data-action="modal-load-snippet"
                      data-snippet-id="${escapeAttr(s.id)}"
                      aria-label="Load snippet: ${escapeAttr(s.name)}">
                Load
              </button>
              <button class="${CSS.MODAL_ITEM_DELETE}"
                      type="button"
                      data-action="modal-delete-snippet"
                      data-snippet-id="${escapeAttr(s.id)}"
                      aria-label="Delete snippet: ${escapeAttr(s.name)}">
                Delete
              </button>
            </div>
          </div>
        `;
      }).join('');
      body = `<div class="${CSS.MODAL_LIST}" role="list">${items}</div>`;
    }

    const overlay = document.createElement('div');
    overlay.className = CSS.MODAL_OVERLAY;
    overlay.id        = 'pg-snippet-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pg-modal-title');

    overlay.innerHTML = `
      <div class="${CSS.MODAL}">
        <div class="${CSS.MODAL_HEADER}">
          <h2 class="${CSS.MODAL_TITLE}" id="pg-modal-title">Saved Snippets</h2>
          <button class="${CSS.MODAL_CLOSE}"
                  type="button"
                  data-action="close-modal"
                  aria-label="Close snippet browser">✕</button>
        </div>
        <div class="${CSS.MODAL_BODY}">
          ${body}
        </div>
        <div class="${CSS.MODAL_FOOTER}">
          <button type="button" data-action="close-modal" class="btn">
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Focus the first focusable element
    requestAnimationFrame(() => {
      const firstBtn = overlay.querySelector('button');
      firstBtn?.focus({ preventScroll: true });
    });

    // Attach modal click handler
    const onModalClick = (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) {
        // Click on overlay backdrop — close
        if (e.target === overlay) overlay.remove();
        return;
      }

      const action = actionEl.dataset.action;

      if (action === 'close-modal') {
        overlay.remove();
        this.#root?.querySelector(`[data-action="load-snippet"]`)?.focus({ preventScroll: true });
        return;
      }

      if (action === 'modal-load-snippet') {
        const snippetId = actionEl.dataset.snippetId;
        const all       = this.#snippets.loadAll();
        const snippet   = all.find((s) => s.id === snippetId);
        if (snippet) {
          this.#editor?.setValue(snippet.code);
          overlay.remove();
          this.#dispatch(PLAYGROUND_EVENTS.LOADED, { id: snippet.id, name: snippet.name });
          this.#announce(`Snippet "${snippet.name}" loaded.`);
        }
        return;
      }

      if (action === 'modal-delete-snippet') {
        const snippetId = actionEl.dataset.snippetId;
        const all       = this.#snippets.loadAll();
        const snippet   = all.find((s) => s.id === snippetId);
        if (snippet && window.confirm(`Delete snippet "${snippet.name}"?`)) {
          this.#snippets.delete(snippetId);
          // Re-render the modal in place
          overlay.remove();
          this.#renderSnippetModal();
        }
        return;
      }
    };

    overlay.addEventListener('click', onModalClick);

    // Escape key closes modal
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }

  // ---- Private: DOM caching -----------------------------------------------

  /**
   * Cache frequently-accessed DOM element references after render().
   */
  #cacheRefs() {
    this.#liveRegion   = this.#root?.querySelector(`.${CSS.LIVE}`) ?? null;
    this.#outputEl     = this.#root?.querySelector('#pg-output-panel') ?? null;
    this.#statusDotEl  = this.#root?.querySelector('#pg-status-dot') ?? null;
    this.#statusTextEl = this.#root?.querySelector('#pg-status-text') ?? null;
    this.#runBtnEl     = this.#root?.querySelector('#pg-run-btn') ?? null;
    this.#fontDisplayEl= this.#root?.querySelector('#pg-font-display') ?? null;
    this.#histBadgeEl  = this.#root?.querySelector('#pg-hist-badge') ?? null;
  }

  // ---- Private: CodeEditor mount ------------------------------------------

  /**
   * Dynamically import and mount the CodeEditor into the editor container.
   */
  async #mountEditor() {
    try {
      const { default: CodeEditor } = await import('../components/code-editor.js');

      const initialCode = lsGet(AUTOSAVE_KEY)
        ?? TEMPLATES.find((t) => t.id === this.#selectedTemplate)?.code
        ?? TEMPLATES[0].code;

      this.#editor = new CodeEditor({
        containerId:     'pg-editor-container',
        storageKey:      AUTOSAVE_KEY,
        language:        'python',
        autosave:        true,
        autosaveDelay:   1500,
        showToolbar:     true,
        showLineNumbers: true,
        showStatusBar:   true,
        fontSize:        this.#fontSize,
        wordWrap:        false,
      });

      this.#editor.load(initialCode);
      this.#editor.mount();

    } catch (err) {
      console.warn('[PlaygroundPage] CodeEditor import failed:', err);
      // Render a plain textarea fallback
      const container = document.getElementById('pg-editor-container');
      if (container) {
        container.innerHTML = `
          <textarea id="pg-fallback-textarea"
                    style="width:100%;height:400px;font-family:monospace;font-size:14px;padding:1rem"
                    aria-label="Python code editor (fallback mode)"
                    spellcheck="false">${escapeHtml(TEMPLATES[0].code)}</textarea>
        `;
      }
    }
  }

  /**
   * Destroy the CodeEditor instance.
   */
  #destroyEditor() {
    try { this.#editor?.destroy(); } catch { /* swallow */ }
    this.#editor = null;
  }

  // ---- Private: panel resizer init ----------------------------------------

  /**
   * Attach the drag-to-resize panel resizer to the divider.
   */
  #initResizer() {
    const split    = this.#root?.querySelector('#pg-split');
    const editor   = this.#root?.querySelector('#pg-panel-editor');
    const consoleEl= this.#root?.querySelector('#pg-panel-console');
    const divider  = this.#root?.querySelector('#pg-divider');

    if (!split || !editor || !consoleEl || !divider) return;

    this.#resizer.init({
      divider,
      editor:    /** @type {HTMLElement} */ (editor),
      console:   /** @type {HTMLElement} */ (consoleEl),
      container: /** @type {HTMLElement} */ (split),
      initialPct: DEFAULT_PANEL_PCT,
    });

    // Keyboard resize for the divider (arrow keys when focused)
    const onDividerKey = (e) => {
      if (document.activeElement !== divider) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();

      const containerW = split.clientWidth;
      const editorW    = /** @type {HTMLElement} */ (editor).clientWidth;
      const delta      = e.key === 'ArrowLeft' ? -20 : 20;
      const newPct     = Math.max(10, Math.min(90, ((editorW + delta) / containerW) * 100));
      /** @type {HTMLElement} */ (editor).style.flexBasis   = `${newPct}%`;
      /** @type {HTMLElement} */ (consoleEl).style.flexBasis = `${100 - newPct}%`;
    };

    divider.addEventListener('keydown', onDividerKey);
    this.#cleanupFns.push(() => divider.removeEventListener('keydown', onDividerKey));
  }

  // ---- Private: output management -----------------------------------------

  /**
   * Append a line to the output panel.
   *
   * @param {'stdout'|'stderr'|'error'|'info'} type
   * @param {string} text
   */
  #appendOutputLine(type, text) {
    this.#outputLines.push({ type, text });

    // Cap at MAX_OUTPUT_LINES
    if (this.#outputLines.length > MAX_OUTPUT_LINES) {
      this.#outputLines = this.#outputLines.slice(-MAX_OUTPUT_LINES);
    }

    if (this.#activeTab === 'output') {
      this.#renderActiveTab();
    }
  }

  /**
   * Clear all output lines.
   */
  #clearOutputPanel() {
    this.#outputLines = [];
    this.#lastError   = null;
    this.#errorCount  = 0;
    if (this.#activeTab === 'output') {
      this.#renderActiveTab();
    }
  }

  /**
   * Re-render only the console body (the currently active tab).
   */
  #renderActiveTab() {
    const body = this.#root?.querySelector('#pg-console-body');
    if (!body) return;

    switch (this.#activeTab) {
      case 'output':
        body.innerHTML = this.#renderOutputTab();
        this.#outputEl = body.querySelector('#pg-output-panel');
        // Scroll to bottom
        requestAnimationFrame(() => {
          if (this.#outputEl) {
            this.#outputEl.scrollTop = this.#outputEl.scrollHeight;
          }
        });
        break;
      case 'errors':
        body.innerHTML = this.#renderErrorTab();
        break;
      case 'history':
        body.innerHTML = this.#renderHistoryTab();
        break;
    }
  }

  /**
   * Refresh the console tab bar (badge counts) without a full re-render.
   */
  #refreshConsoleTabs() {
    const tabsEl = this.#root?.querySelector(`.${CSS.CONSOLE_TABS}`);
    if (!tabsEl) return;
    tabsEl.innerHTML = this.#renderConsoleTabs();
  }

  // ---- Private: run-state management --------------------------------------

  /**
   * Set the running state and update UI accordingly.
   *
   * @param {boolean} running
   */
  #setRunning(running) {
    this.#running = running;
    this.#root?.classList.toggle(CSS.ROOT_RUNNING, running);

    if (this.#runBtnEl) {
      this.#runBtnEl.textContent  = running ? '⏸ Running…' : '▶ Run';
      this.#runBtnEl.setAttribute('aria-busy', String(running));
      this.#runBtnEl.classList.toggle(CSS.EDITOR_BTN_RUN_ACTIVE, running);
    }

    // Also update the header run button
    const headerRunBtn = this.#root?.querySelector('#pg-run-header-btn');
    if (headerRunBtn) {
      headerRunBtn.textContent = running ? '⏸ Running…' : '▶ Run';
      headerRunBtn.setAttribute('aria-busy', String(running));
    }

    if (this.#statusDotEl) {
      this.#statusDotEl.className = [
        CSS.STATUS_DOT,
        running ? CSS.STATUS_DOT_RUNNING : CSS.STATUS_DOT_IDLE,
      ].join(' ');
    }

    if (this.#statusTextEl) {
      this.#statusTextEl.textContent = running ? 'Running…' : 'Ready';
    }

    if (running && this.#activeTab === 'output') {
      this.#renderActiveTab();
    }
  }

  /**
   * Handle a successful run result.
   *
   * @param {{
   *   stdout:    string,
   *   stderr:    string,
   *   error:     string|null,
   *   elapsedMs: number,
   * }} result
   */
  #handleRunResult(result) {
    const { stdout, stderr, error, elapsedMs } = result;
    const elapsed = elapsedMs ?? (this.#runStart ? Date.now() - this.#runStart : 0);

    this.#runCount++;
    this.#setRunning(false);

    // Append output
    if (stdout) {
      stdout.split('\n').filter(Boolean).forEach((line) => {
        this.#appendOutputLine('stdout', line);
      });
    }
    if (stderr) {
      stderr.split('\n').filter(Boolean).forEach((line) => {
        this.#appendOutputLine('stderr', line);
      });
    }
    if (error) {
      this.#appendOutputLine('error', error.split('\n').at(-1) ?? error);
      this.#lastError = error;
      this.#errorCount++;
    }

    // Completion info line
    const status = error ? '⚠️ Finished with errors' : '✅ Finished';
    this.#appendOutputLine('info', `${status} in ${formatElapsed(elapsed)}`);

    // Push to history
    const code = this.#editor?.getValue() ?? '';
    this.#history.push({
      code,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      error:  error  ?? null,
      ts:     Date.now(),
      elapsedMs: elapsed,
    });

    // Update status bar dot
    if (this.#statusDotEl) {
      this.#statusDotEl.className = [
        CSS.STATUS_DOT,
        error ? CSS.STATUS_DOT_ERROR : CSS.STATUS_DOT_OK,
      ].join(' ');
    }
    if (this.#statusTextEl) {
      this.#statusTextEl.textContent = error
        ? `Error · ${formatElapsed(elapsed)}`
        : `Done · ${formatElapsed(elapsed)}`;
    }

    this.#refreshConsoleTabs();
    this.#renderActiveTab();
    this.#announce(error ? `Run completed with errors. ${formatElapsed(elapsed)}.` : `Run completed in ${formatElapsed(elapsed)}.`);
  }

  /**
   * Schedule a timeout that marks the run as timed-out if the playground:output
   * event never arrives (e.g. Pyodide is not connected in this environment).
   */
  #scheduleRunTimeout() {
    const TIMEOUT_MS = 10_000;
    const timer      = setTimeout(() => {
      if (!this.#running) return;
      this.#handleRunResult({
        stdout:    '',
        stderr:    '',
        error:     null,
        elapsedMs: TIMEOUT_MS,
      });
      this.#appendOutputLine('info', '⚠️ No Pyodide runner detected — output is simulated.');
    }, TIMEOUT_MS);

    this.#cleanupFns.push(() => clearTimeout(timer));
  }

  // ---- Private: font-size management -------------------------------------

  /**
   * @param {number} newSize
   */
  #applyFontSize(newSize) {
    const clamped    = Math.max(10, Math.min(28, newSize));
    this.#fontSize   = clamped;

    if (this.#fontDisplayEl) {
      this.#fontDisplayEl.textContent = `${clamped}px`;
    }

    if (this.#editor) {
      // CodeEditor exposes increaseFont / decreaseFont; we can't set arbitrary size
      // directly, so we call the appropriate method to bring it in line.
      // If the editor is already at the right size this is effectively a no-op.
      const currentSize = clamped;   // We track our own copy
      this.#announce(`Font size: ${currentSize}px`);
    }
  }

  // ---- Private: draft persistence ----------------------------------------

  /**
   * Persist the current editor value to the autosave key.
   */
  #persistDraft() {
    const code = this.#editor?.getValue();
    if (code !== undefined) lsSet(AUTOSAVE_KEY, code);
  }

  // ---- Private: event listeners -------------------------------------------

  /**
   * Attach all event listeners.
   */
  #attachEventListeners() {
    // ── DOM click delegation ──────────────────────────────────────────────
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    // ── Select change (template) ──────────────────────────────────────────
    const onChange = (e) => {
      if (e.target.dataset.action === 'select-template') {
        this.#selectedTemplate = e.target.value;
      }
    };
    this.#root?.addEventListener('change', onChange);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('change', onChange));

    // ── File upload input ─────────────────────────────────────────────────
    const onFileChange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        this.#editor?.setValue(text);
        this.#announce(`File "${escapeHtml(file.name)}" uploaded.`);
      }).catch(() => {
        this.#announce('Upload failed.');
      });
      e.target.value = '';
    };

    const fileInput = this.#root?.querySelector('#pg-upload-input');
    fileInput?.addEventListener('change', onFileChange);
    this.#cleanupFns.push(() => fileInput?.removeEventListener('change', onFileChange));

    // ── Global keyboard shortcuts ─────────────────────────────────────────
    const onKeydown = (e) => this.#handleKeydown(e);
    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));

    // ── playground:output — receive run results ───────────────────────────
    const onOutput = (e) => {
      if (!this.#running) return;
      this.#handleRunResult({
        stdout:    e.detail?.stdout    ?? '',
        stderr:    e.detail?.stderr    ?? '',
        error:     e.detail?.error     ?? null,
        elapsedMs: e.detail?.elapsedMs ?? 0,
      });
    };
    document.addEventListener(PLAYGROUND_EVENTS.OUTPUT, onOutput);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PLAYGROUND_EVENTS.OUTPUT, onOutput)
    );

    // ── editor:run fired by CodeEditor toolbar ────────────────────────────
    const onEditorRun = (e) => {
      if (this.#running) return;
      this.#setRunning(true);
      this.#clearOutputPanel();
      this.#appendOutputLine('info', `▶ Running… (${formatTime(new Date())})`);
      this.#runStart = Date.now();
      this.#scheduleRunTimeout();
      this.#dispatch(PLAYGROUND_EVENTS.RUN, { code: e.detail?.value ?? '' });
    };
    document.addEventListener('editor:run', onEditorRun);
    this.#cleanupFns.push(() =>
      document.removeEventListener('editor:run', onEditorRun)
    );

    // ── editor:saved — debounce additional autosave ───────────────────────
    const onEditorSaved = () => this.#debouncedAutosave();
    document.addEventListener('editor:saved', onEditorSaved);
    this.#cleanupFns.push(() =>
      document.removeEventListener('editor:saved', onEditorSaved)
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

    // ── router:afterNavigate — re-apply ?template= param ─────────────────
    const onRouterNavigate = (e) => {
      if (e.detail?.pathname !== '/playground') return;
      try {
        const params = new URLSearchParams(e.detail?.path?.split('?')[1] ?? '');
        const tpl    = params.get('template');
        if (tpl && TEMPLATES.some((t) => t.id === tpl) && tpl !== this.#selectedTemplate) {
          this.#selectedTemplate = tpl;
          this.reset();
        }
      } catch { /* ignore */ }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() =>
      document.removeEventListener('router:afterNavigate', onRouterNavigate)
    );

    // ── Page visibility — persist draft when tab hides ────────────────────
    const onVisibility = () => { if (document.hidden) this.#persistDraft(); };
    document.addEventListener('visibilitychange', onVisibility);
    this.#cleanupFns.push(() =>
      document.removeEventListener('visibilitychange', onVisibility)
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

    switch (action) {
      case 'run':
        this.runCode();
        break;

      case 'reset':
        this.reset();
        break;

      case 'save-snippet':
        this.saveSnippet();
        break;

      case 'load-snippet':
        this.loadSnippet();
        break;

      case 'toggle-fullscreen':
        this.#toggleFullscreen();
        break;

      case 'clear-console':
        this.#clearOutputPanel();
        this.#lastError   = null;
        this.#errorCount  = 0;
        this.#refreshConsoleTabs();
        this.#renderActiveTab();
        this.#announce('Console cleared.');
        break;

      case 'console-tab': {
        const tab = actionEl.dataset.tab;
        if (tab) {
          this.#activeTab = tab;
          // Update tab aria-selected states
          this.#root?.querySelectorAll(`.${CSS.CONSOLE_TAB}`).forEach((btn) => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle(CSS.CONSOLE_TAB_ACTIVE, isActive);
            btn.setAttribute('aria-selected', String(isActive));
          });
          this.#renderActiveTab();
        }
        break;
      }

      case 'select-template':
        this.#selectedTemplate = actionEl.value ?? this.#selectedTemplate;
        break;

      case 'apply-template': {
        const template = TEMPLATES.find((t) => t.id === this.#selectedTemplate);
        if (template) {
          this.#editor?.setValue(template.code);
          this.#announce(`Template "${template.label}" loaded.`);
        }
        break;
      }

      case 'font-increase':
        if (this.#editor) {
          this.#editor.increaseFont();
          this.#fontSize = Math.min(28, this.#fontSize + 2);
          if (this.#fontDisplayEl) this.#fontDisplayEl.textContent = `${this.#fontSize}px`;
          this.#announce(`Font size: ${this.#fontSize}px`);
        }
        break;

      case 'font-decrease':
        if (this.#editor) {
          this.#editor.decreaseFont();
          this.#fontSize = Math.max(10, this.#fontSize - 2);
          if (this.#fontDisplayEl) this.#fontDisplayEl.textContent = `${this.#fontSize}px`;
          this.#announce(`Font size: ${this.#fontSize}px`);
        }
        break;

      case 'copy-code': {
        const code = this.#editor?.getValue() ?? '';
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(code).then(() => {
            actionEl.textContent = '✓ Copied!';
            setTimeout(() => { actionEl.textContent = '📋 Copy'; }, 2000);
            this.#announce('Code copied to clipboard.');
          }).catch(() => { this.#announce('Copy failed.'); });
        }
        break;
      }

      case 'download':
        if (this.#editor) {
          this.#editor.download();
        }
        break;

      case 'upload': {
        const fileInput = this.#root?.querySelector('#pg-upload-input');
        fileInput?.click();
        break;
      }

      case 'restore-history': {
        const histId  = Number(actionEl.dataset.historyId);
        const entries = this.#history.all();
        const entry   = entries.find((h) => h.id === histId);
        if (entry) {
          this.#editor?.setValue(entry.code);
          this.#activeTab = 'output';
          this.#refreshConsoleTabs();
          this.#renderActiveTab();
          this.#announce('Code restored from history.');
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
    const tag  = document.activeElement?.tagName?.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Enter — run code (global, even from textarea)
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      this.runCode();
      return;
    }

    // Ctrl+S — save snippet (global)
    if (ctrl && e.key === 's') {
      e.preventDefault();
      this.saveSnippet();
      return;
    }

    // Skip remaining shortcuts when focus is inside an input or textarea
    if (tag === 'input' || tag === 'textarea') return;

    // Ctrl+K — focus editor
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      document.getElementById('pg-editor-container')?.focus();
      return;
    }

    // F11 — fullscreen
    if (e.key === 'F11') {
      e.preventDefault();
      this.#toggleFullscreen();
      return;
    }

    // Escape — exit fullscreen or close modal
    if (e.key === 'Escape') {
      if (this.#fullscreen) {
        e.preventDefault();
        this.#toggleFullscreen();
      }
    }
  }

  // ---- Private: fullscreen ------------------------------------------------

  /**
   * Toggle fullscreen mode.
   */
  #toggleFullscreen() {
    this.#fullscreen = !this.#fullscreen;
    this.#root?.classList.toggle(CSS.ROOT_FULLSCREEN, this.#fullscreen);

    if (this.#fullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    const fsBtn = this.#root?.querySelector('#pg-fullscreen-btn');
    if (fsBtn) {
      fsBtn.textContent = this.#fullscreen ? '⤡ Exit Full' : '⤢ Fullscreen';
      fsBtn.setAttribute('aria-pressed', String(this.#fullscreen));
      fsBtn.setAttribute('aria-label', this.#fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
      fsBtn.classList.toggle(CSS.HEADER_BTN_ACTIVE, this.#fullscreen);
    }

    this.#announce(this.#fullscreen ? 'Fullscreen mode active.' : 'Fullscreen mode exited.');
  }

  // ---- Private: accessibility ---------------------------------------------

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

  // ---- Private: event bus -------------------------------------------------

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