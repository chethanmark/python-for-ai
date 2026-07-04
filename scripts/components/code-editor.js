/**
 * =============================================================================
 * CODE EDITOR COMPONENT
 * scripts/components/code-editor.js
 * -----------------------------------------------------------------------------
 * Reusable, accessible, textarea-based Python code editor for the
 * "Python for AI" educational platform. Designed as a lightweight alternative
 * to Monaco / CodeMirror — zero external dependencies, full keyboard support,
 * and seamless integration with the platform's event bus and design system.
 *
 * ARCHITECTURE:
 *   CodeEditor (default export)
 *     └─ EditorStore    — localStorage persistence with schema versioning
 *                         and graceful in-memory fallback
 *
 * CAPABILITIES:
 *   • Textarea-based editing with monospace styling hooks
 *   • Synchronised line-number gutter
 *   • Auto-resize to content height
 *   • Tab indentation (4 spaces) and Shift+Tab outdent
 *   • Cursor position preservation across all operations
 *   • Native browser undo/redo stack via execCommand/document.execCommand
 *   • Autosave with configurable debounce interval
 *   • Draft restore from localStorage on mount
 *   • Reset to initial code
 *   • Copy to clipboard with visual feedback
 *   • Download as .py file
 *   • Upload .py file from disk
 *   • Read-only mode (textarea disabled, toolbar buttons hidden)
 *   • Fullscreen overlay mode
 *   • Word wrap toggle
 *   • Font size controls (10–28 px range)
 *   • Toolbar with all actions
 *   • Status bar: line count, char count, cursor line, cursor column
 *   • ARIA live region for screen reader announcements
 *   • Keyboard shortcuts: Ctrl+S, Ctrl+C (copy), Ctrl+A, Tab, Shift+Tab,
 *     Ctrl+/ (toggle comment), Ctrl+Enter (run), F11 (fullscreen)
 *   • prefers-reduced-motion awareness for all transitions
 *
 * DOES NOT OWN:
 *   - Python execution        → Pyodide is wired externally; this component
 *     emits editor:run and callers handle execution
 *   - Syntax highlighting     → Prism.js can be layered on top if needed;
 *     the textarea approach does not support inline HTML highlighting
 *
 * EVENT EMISSIONS:
 *   editor:mounted    { containerId }
 *   editor:changed    { value, lines, chars }
 *   editor:saved      { key, value }
 *   editor:restored   { key, value }
 *   editor:reset      { value }
 *   editor:copy       { value }
 *   editor:download   { filename }
 *   editor:upload     { filename, value }
 *   editor:run        { value }
 *   editor:fullscreen { active }
 *   editor:wrap       { active }
 *
 * STORAGE SCHEMA (localStorage key: config.storageKey):
 *   {
 *     version: 1,
 *     savedAt: number,         — Unix ms timestamp
 *     value:   string,         — the raw Python code
 *   }
 *
 * USAGE (tutorial-detail.js, project-detail.js):
 *
 *   import CodeEditor from './components/code-editor.js';
 *
 *   const editor = new CodeEditor({
 *     containerId:   'editor-container',
 *     storageKey:    'pyai-draft-python-variables',
 *     language:      'python',
 *     autosave:      true,
 *     autosaveDelay: 1500,
 *     showToolbar:   true,
 *     showLineNumbers: true,
 *     showStatusBar: true,
 *     fontSize:      14,
 *     wordWrap:      false,
 *     readonly:      false,
 *   });
 *
 *   editor.load(`print("Hello, AI world!")`);
 *   editor.mount();
 *
 *   document.addEventListener('editor:run', (e) => {
 *     pyodide.runPython(e.detail.value);
 *   });
 *
 * EXPORTS:
 *   CodeEditor  — primary class (default export)
 *   EDITOR_EVENTS — event name constants
 *   EDITOR_DEFAULTS — default configuration values
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * Event names emitted by the code editor.
 * All events bubble on document and are also published to window.__pyaiEvents.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EDITOR_EVENTS = Object.freeze({
  MOUNTED:    'editor:mounted',
  CHANGED:    'editor:changed',
  SAVED:      'editor:saved',
  RESTORED:   'editor:restored',
  RESET:      'editor:reset',
  COPY:       'editor:copy',
  DOWNLOAD:   'editor:download',
  UPLOAD:     'editor:upload',
  RUN:        'editor:run',
  FULLSCREEN: 'editor:fullscreen',
  WRAP:       'editor:wrap',
});

/**
 * Default configuration values applied when not specified by the caller.
 *
 * @type {Readonly<Record<string, *>>}
 */
export const EDITOR_DEFAULTS = Object.freeze({
  /** Language identifier — used for file extension and ARIA labelling */
  LANGUAGE:        'python',

  /** localStorage key prefix for draft storage */
  STORAGE_KEY:     'pyai-editor-draft',

  /** Whether the editor is read-only */
  READONLY:        false,

  /** Whether to autosave drafts to localStorage */
  AUTOSAVE:        true,

  /** Debounce delay (ms) before triggering an autosave after a keystroke */
  AUTOSAVE_DELAY:  1500,

  /** Whether to show the toolbar above the editor */
  SHOW_TOOLBAR:    true,

  /** Whether to show the line-number gutter */
  SHOW_LINE_NUMBERS: true,

  /** Whether to show the status bar below the editor */
  SHOW_STATUS_BAR: true,

  /** Default font size in pixels */
  FONT_SIZE:       14,

  /** Minimum allowed font size in pixels */
  FONT_SIZE_MIN:   10,

  /** Maximum allowed font size in pixels */
  FONT_SIZE_MAX:   28,

  /** Font size step for increase/decrease actions */
  FONT_SIZE_STEP:  2,

  /** Whether word wrap is initially active */
  WORD_WRAP:       false,

  /** Tab character replacement (4 spaces) */
  TAB_SIZE:        4,

  /** Draft storage schema version */
  STORE_VERSION:   1,

  /** Seconds after which a saved draft is considered stale and discarded */
  DRAFT_MAX_AGE_S: 604_800,   // 7 days
});

// ---------------------------------------------------------------------------
// CSS BEM class names — single source of truth, zero magic strings
// ---------------------------------------------------------------------------

/**
 * BEM class names for every element the code editor renders.
 * Follows the same pattern as navigation.js, footer.js, quiz.js.
 *
 * @type {Readonly<Record<string, string>>}
 */
const CSS = Object.freeze({
  // Root
  ROOT:              'code-editor',
  ROOT_FULLSCREEN:   'code-editor--fullscreen',
  ROOT_READONLY:     'code-editor--readonly',
  ROOT_WRAP:         'code-editor--wrap',
  ROOT_FOCUSED:      'code-editor--focused',

  // Toolbar
  TOOLBAR:           'code-editor__toolbar',
  TOOLBAR_GROUP:     'code-editor__toolbar-group',
  TOOLBAR_BTN:       'code-editor__toolbar-btn',
  TOOLBAR_BTN_ACTIVE:'code-editor__toolbar-btn--active',
  TOOLBAR_DIVIDER:   'code-editor__toolbar-divider',

  // Editor area
  EDITOR_AREA:       'code-editor__area',
  GUTTER:            'code-editor__gutter',
  GUTTER_LINE:       'code-editor__gutter-line',
  GUTTER_ACTIVE:     'code-editor__gutter-line--active',
  TEXTAREA:          'code-editor__textarea',

  // Status bar
  STATUS:            'code-editor__status',
  STATUS_LEFT:       'code-editor__status-left',
  STATUS_RIGHT:      'code-editor__status-right',
  STATUS_ITEM:       'code-editor__status-item',
  STATUS_LABEL:      'code-editor__status-label',
  STATUS_VALUE:      'code-editor__status-value',

  // Live region
  LIVE:              'code-editor__live',

  // Upload input (hidden)
  UPLOAD_INPUT:      'code-editor__upload-input',

  // Copy feedback
  COPY_SUCCESS:      'code-editor__toolbar-btn--copy-success',
});

// ---------------------------------------------------------------------------
// Inline SVG icon factory
// ---------------------------------------------------------------------------

/**
 * Returns an inline SVG for a named icon used in the editor toolbar.
 * All icons are aria-hidden — the surrounding button carries the label.
 *
 * @param {string} name
 * @param {number} [size=16]
 * @returns {string}
 */
function icon(name, size = 16) {
  const s = size;
  const ICONS = {
    play: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"
              aria-hidden="true" focusable="false">
              <polygon points="5 3 19 12 5 21 5 3"/>
           </svg>`,

    reset: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <polyline points="1 4 1 10 7 10"/>
               <path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>`,

    copy: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
           </svg>`,

    check: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true" focusable="false">
               <polyline points="20 6 9 17 4 12"/>
            </svg>`,

    download: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"
                  aria-hidden="true" focusable="false">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
               </svg>`,

    upload: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true" focusable="false">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
             </svg>`,

    fullscreen: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true" focusable="false">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3"  y1="21" x2="10" y2="14"/>
                 </svg>`,

    exitFullscreen: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round"
                        aria-hidden="true" focusable="false">
                        <polyline points="8 3 3 3 3 8"/>
                        <polyline points="21 8 21 3 16 3"/>
                        <polyline points="3 16 3 21 8 21"/>
                        <polyline points="16 21 21 21 21 16"/>
                     </svg>`,

    wrap: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <line x1="3" y1="6"  x2="21" y2="6"/>
              <path d="M3 12h15a3 3 0 0 1 0 6h-4"/>
              <polyline points="10 15 7 18 10 21"/>
           </svg>`,

    fontIncrease: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"
                      aria-hidden="true" focusable="false">
                      <text x="2" y="16" font-size="12" stroke="none" fill="currentColor">A</text>
                      <text x="12" y="19" font-size="16" stroke="none" fill="currentColor">A</text>
                      <line x1="20" y1="8" x2="20" y2="14"/>
                      <line x1="17" y1="11" x2="23" y2="11"/>
                   </svg>`,

    fontDecrease: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"
                      aria-hidden="true" focusable="false">
                      <text x="2" y="19" font-size="16" stroke="none" fill="currentColor">A</text>
                      <text x="14" y="16" font-size="12" stroke="none" fill="currentColor">A</text>
                      <line x1="20" y1="8" x2="26" y2="8"/>
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
 * Returns a debounced wrapper around a function.
 * The wrapper resets the timer on every call; the underlying function
 * fires only once the quiet period has elapsed.
 *
 * @param {Function} fn
 * @param {number}   ms — Quiet period in milliseconds
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
 * Returns true when the user's OS requests reduced motion.
 * Checked fresh each call so mid-session OS changes are respected.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Saves a cursor position (selectionStart, selectionEnd) from a textarea
 * and returns a restore function.
 *
 * @param {HTMLTextAreaElement} ta
 * @returns {() => void} Restore function — call after the textarea value changes
 */
function saveCursor(ta) {
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  return () => {
    ta.selectionStart = start;
    ta.selectionEnd   = end;
  };
}

// ---------------------------------------------------------------------------
// EditorStore — localStorage persistence with in-memory fallback
// ---------------------------------------------------------------------------

/**
 * Thin persistence layer for editor drafts.
 * Mirrors the StorageAdapter pattern from progress-tracker.js.
 * Falls back to an in-memory Map when localStorage is blocked or full.
 */
class EditorStore {
  /** @type {Map<string, string>|null} */
  #memory = null;

  /** @type {boolean} */
  #available = true;

  constructor() {
    try {
      const probe = '__pyai_editor_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch {
      this.#available = false;
      this.#memory    = new Map();
    }
  }

  /**
   * Retrieve a raw string value by key.
   *
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
   * Store a raw string value.
   *
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
      // QuotaExceededError — fall through to memory
      this.#available = false;
      if (!this.#memory) this.#memory = new Map();
      this.#memory.set(key, value);
    }
  }

  /**
   * Delete a stored value.
   *
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

  /** @returns {boolean} Whether persistent storage is available */
  get isAvailable() { return this.#available; }
}

// ---------------------------------------------------------------------------
// CodeEditor — primary class
// ---------------------------------------------------------------------------

/**
 * Textarea-based code editor component.
 *
 * Lifecycle:
 *   1. new CodeEditor(config)  — no DOM side-effects
 *   2. .load(code)             — sets the initial code string
 *   3. .mount()                — renders HTML, attaches events, restores draft
 *   4. [user edits]            — autosave, status updates, shortcuts
 *   5. .destroy()              — tears down all listeners and timers
 */
export default class CodeEditor {

  // ---- Configuration (sealed after construction) ---------------------------

  /**
   * @type {{
   *   containerId:      string,
   *   language:         string,
   *   storageKey:       string,
   *   readonly:         boolean,
   *   autosave:         boolean,
   *   autosaveDelay:    number,
   *   showToolbar:      boolean,
   *   showLineNumbers:  boolean,
   *   showStatusBar:    boolean,
   *   fontSize:         number,
   *   wordWrap:         boolean,
   * }}
   */
  #config;

  // ---- Core state ----------------------------------------------------------

  /** @type {string}  Initial code set via load() — used by reset() */
  #initialCode = '';

  /** @type {number}  Active font size in pixels */
  #fontSize;

  /** @type {boolean} Whether word wrap is currently active */
  #wordWrap;

  /** @type {boolean} Whether fullscreen is currently active */
  #fullscreen = false;

  /** @type {boolean} Whether the component has been mounted */
  #mounted = false;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}       */ #root        = null;
  /** @type {HTMLElement|null}       */ #toolbar      = null;
  /** @type {HTMLElement|null}       */ #editorArea   = null;
  /** @type {HTMLElement|null}       */ #gutter       = null;
  /** @type {HTMLTextAreaElement|null} */ #textarea   = null;
  /** @type {HTMLElement|null}       */ #statusBar    = null;
  /** @type {HTMLElement|null}       */ #liveRegion   = null;
  /** @type {HTMLInputElement|null}  */ #uploadInput  = null;

  // ---- Status bar element references (cached for efficient updates) --------

  /** @type {HTMLElement|null} */ #statLines   = null;
  /** @type {HTMLElement|null} */ #statChars   = null;
  /** @type {HTMLElement|null} */ #statLine    = null;
  /** @type {HTMLElement|null} */ #statCol     = null;

  // ---- Services ------------------------------------------------------------

  /** @type {EditorStore} */ #store;

  // ---- Timers --------------------------------------------------------------

  /** @type {Function}    */ #debouncedAutosave;
  /** @type {number|null} */ #copyFeedbackTimer = null;

  // ---- Cleanup references --------------------------------------------------

  /** @type {Array<() => void>} */
  #cleanupFns = [];

  // --------------------------------------------------------------------------

  /**
   * @param {{
   *   containerId?:     string,
   *   language?:        string,
   *   storageKey?:      string,
   *   readonly?:        boolean,
   *   autosave?:        boolean,
   *   autosaveDelay?:   number,
   *   showToolbar?:     boolean,
   *   showLineNumbers?: boolean,
   *   showStatusBar?:   boolean,
   *   fontSize?:        number,
   *   wordWrap?:        boolean,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId:      config.containerId      ?? 'editor-container',
      language:         config.language         ?? EDITOR_DEFAULTS.LANGUAGE,
      storageKey:       config.storageKey       ?? EDITOR_DEFAULTS.STORAGE_KEY,
      readonly:         config.readonly         ?? EDITOR_DEFAULTS.READONLY,
      autosave:         config.autosave         ?? EDITOR_DEFAULTS.AUTOSAVE,
      autosaveDelay:    config.autosaveDelay    ?? EDITOR_DEFAULTS.AUTOSAVE_DELAY,
      showToolbar:      config.showToolbar      ?? EDITOR_DEFAULTS.SHOW_TOOLBAR,
      showLineNumbers:  config.showLineNumbers  ?? EDITOR_DEFAULTS.SHOW_LINE_NUMBERS,
      showStatusBar:    config.showStatusBar    ?? EDITOR_DEFAULTS.SHOW_STATUS_BAR,
      fontSize:         config.fontSize         ?? EDITOR_DEFAULTS.FONT_SIZE,
      wordWrap:         config.wordWrap         ?? EDITOR_DEFAULTS.WORD_WRAP,
    });

    this.#fontSize = this.#config.fontSize;
    this.#wordWrap = this.#config.wordWrap;
    this.#store    = new EditorStore();

    // Build the debounced autosave so it is ready before mount()
    this.#debouncedAutosave = debounce(
      () => this.saveDraft(),
      this.#config.autosaveDelay
    );
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Set the initial code that will populate the editor on mount.
   * If mount() has already been called, updates the textarea value immediately.
   *
   * @param {string} [initialCode='']
   * @returns {CodeEditor} this — for chaining
   */
  load(initialCode = '') {
    this.#initialCode = String(initialCode);

    if (this.#mounted && this.#textarea) {
      this.#textarea.value = this.#initialCode;
      this.#afterChange();
    }

    return this;
  }

  /**
   * Mount the editor into the container element.
   * Resolves the container by ID, renders all HTML, attaches events,
   * and optionally restores a saved draft.
   *
   * @throws {Error} If the container element is not found in the DOM
   * @returns {CodeEditor} this — for chaining
   */
  mount() {
    if (this.#mounted) return this;

    const container = document.getElementById(this.#config.containerId);
    if (!container) {
      throw new Error(
        `[CodeEditor] Container element #${this.#config.containerId} not found.`
      );
    }

    this.#render(container);
    this.#cacheRefs();
    this.#applyFontSize(this.#fontSize, false);
    this.#applyWordWrap(this.#wordWrap, false);

    if (this.#config.readonly) {
      this.#root?.classList.add(CSS.ROOT_READONLY);
      if (this.#textarea) {
        this.#textarea.readOnly = true;
        this.#textarea.setAttribute('aria-readonly', 'true');
      }
    }

    // Restore draft if available, else use initial code
    const restored = this.restoreDraft();
    if (!restored) {
      this.setValue(this.#initialCode);
    }

    this.#attachEvents();
    this.#mounted = true;

    this.#dispatch(EDITOR_EVENTS.MOUNTED, {
      containerId: this.#config.containerId,
    });

    // Initial status bar and line numbers
    this.#updateLineNumbers();
    this.#updateStatus();

    return this;
  }

  /**
   * Tear down all event listeners, timers, and DOM content.
   * Safe to call multiple times.
   */
  destroy() {
    if (this.#copyFeedbackTimer !== null) {
      clearTimeout(this.#copyFeedbackTimer);
      this.#copyFeedbackTimer = null;
    }

    this.#cleanupFns.forEach((fn) => fn());
    this.#cleanupFns = [];

    if (this.#root) {
      this.#root.innerHTML = '';
      this.#root.className = '';
    }

    this.#mounted = false;
  }

  // ---- Public API: content -------------------------------------------------

  /**
   * Return the current value of the editor.
   *
   * @returns {string}
   */
  getValue() {
    return this.#textarea?.value ?? this.#initialCode;
  }

  /**
   * Programmatically set the editor content.
   * Preserves the cursor position if the textarea is focused.
   *
   * @param {string} code
   * @returns {CodeEditor} this
   */
  setValue(code) {
    if (!this.#textarea) {
      this.#initialCode = String(code);
      return this;
    }

    const restore = saveCursor(this.#textarea);
    this.#textarea.value = String(code);
    restore();
    this.#afterChange();

    return this;
  }

  /**
   * Append a string to the end of the current editor content.
   * Moves the cursor to the end after appending.
   *
   * @param {string} code
   * @returns {CodeEditor} this
   */
  append(code) {
    if (!this.#textarea) return this;

    this.#textarea.value += String(code);
    this.#textarea.selectionStart = this.#textarea.value.length;
    this.#textarea.selectionEnd   = this.#textarea.value.length;
    this.#afterChange();

    return this;
  }

  /**
   * Clear all content from the editor.
   *
   * @returns {CodeEditor} this
   */
  clear() {
    return this.setValue('');
  }

  /**
   * Reset the editor to the initial code set via load().
   * Clears any saved draft.
   *
   * @returns {CodeEditor} this
   */
  reset() {
    this.#store.remove(this.#config.storageKey);
    this.setValue(this.#initialCode);

    this.#dispatch(EDITOR_EVENTS.RESET, { value: this.#initialCode });
    this.#announce('Editor reset to original code.');

    return this;
  }

  // ---- Public API: persistence ---------------------------------------------

  /**
   * Save the current editor content to localStorage immediately.
   * Called automatically by autosave; also available for manual triggers.
   *
   * @returns {CodeEditor} this
   */
  saveDraft() {
    const value   = this.getValue();
    const payload = JSON.stringify({
      version: EDITOR_DEFAULTS.STORE_VERSION,
      savedAt: Date.now(),
      value,
    });

    this.#store.set(this.#config.storageKey, payload);

    this.#dispatch(EDITOR_EVENTS.SAVED, {
      key:   this.#config.storageKey,
      value,
    });

    return this;
  }

  /**
   * Restore a previously saved draft from localStorage.
   * Returns true if a valid, non-stale draft was found and applied.
   *
   * @returns {boolean} Whether a draft was successfully restored
   */
  restoreDraft() {
    const raw = this.#store.get(this.#config.storageKey);
    if (!raw) return false;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#store.remove(this.#config.storageKey);
      return false;
    }

    // Schema version check
    if (parsed.version !== EDITOR_DEFAULTS.STORE_VERSION) {
      this.#store.remove(this.#config.storageKey);
      return false;
    }

    // Staleness check
    const ageSecs = (Date.now() - (parsed.savedAt ?? 0)) / 1000;
    if (ageSecs > EDITOR_DEFAULTS.DRAFT_MAX_AGE_S) {
      this.#store.remove(this.#config.storageKey);
      return false;
    }

    if (typeof parsed.value !== 'string') return false;

    this.setValue(parsed.value);

    this.#dispatch(EDITOR_EVENTS.RESTORED, {
      key:   this.#config.storageKey,
      value: parsed.value,
    });

    return true;
  }

  // ---- Public API: file operations -----------------------------------------

  /**
   * Trigger a browser download of the current editor content as a .py file.
   * The filename is derived from the storageKey or a sensible default.
   *
   * @returns {CodeEditor} this
   */
  download() {
    const value    = this.getValue();
    const filename = this.#deriveFilename();
    const blob     = new Blob([value], { type: 'text/x-python' });
    const url      = URL.createObjectURL(blob);

    const a  = document.createElement('a');
    a.href   = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Revoke the object URL after a tick to allow the download to start
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);

    this.#dispatch(EDITOR_EVENTS.DOWNLOAD, { filename });
    this.#announce(`File downloaded as ${filename}`);

    return this;
  }

  /**
   * Process an uploaded .py file and load its content into the editor.
   * Called by the toolbar upload button or programmatically.
   *
   * @param {File} file — A File object from an <input type="file"> change event
   * @returns {Promise<CodeEditor>} this — resolves when content is loaded
   */
  async upload(file) {
    if (!file) return this;

    if (!file.name.endsWith('.py') && file.type !== 'text/x-python' && file.type !== 'text/plain') {
      this.#announce('Upload failed: please select a .py file.');
      return this;
    }

    const text = await file.text();
    this.setValue(text);

    this.#dispatch(EDITOR_EVENTS.UPLOAD, {
      filename: file.name,
      value:    text,
    });

    this.#announce(`File "${escapeHtml(file.name)}" uploaded.`);

    return this;
  }

  // ---- Public API: view controls ------------------------------------------

  /**
   * Toggle fullscreen mode.
   * Adds/removes the fullscreen CSS modifier and updates the button ARIA state.
   * Escape key exits fullscreen when active.
   *
   * @returns {CodeEditor} this
   */
  toggleFullscreen() {
    this.#fullscreen = !this.#fullscreen;
    this.#root?.classList.toggle(CSS.ROOT_FULLSCREEN, this.#fullscreen);

    // Update the fullscreen button
    const fsBtn = this.#toolbar?.querySelector('[data-action="fullscreen"]');
    if (fsBtn) {
      fsBtn.setAttribute('aria-pressed', String(this.#fullscreen));
      fsBtn.setAttribute(
        'aria-label',
        this.#fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
      );
      fsBtn.classList.toggle(CSS.TOOLBAR_BTN_ACTIVE, this.#fullscreen);
      const iconSpan = fsBtn.querySelector('span[aria-hidden]');
      if (iconSpan) {
        iconSpan.innerHTML = icon(this.#fullscreen ? 'exitFullscreen' : 'fullscreen', 16);
      }
    }

    // Lock/unlock body scroll
    if (this.#fullscreen) {
      document.body.style.overflow = 'hidden';
      this.#textarea?.focus({ preventScroll: true });
    } else {
      document.body.style.overflow = '';
    }

    this.#dispatch(EDITOR_EVENTS.FULLSCREEN, { active: this.#fullscreen });
    this.#announce(this.#fullscreen ? 'Fullscreen mode active.' : 'Fullscreen mode exited.');

    return this;
  }

  /**
   * Toggle word wrap mode.
   *
   * @returns {CodeEditor} this
   */
  toggleWordWrap() {
    this.#applyWordWrap(!this.#wordWrap, true);
    return this;
  }

  /**
   * Increase the editor font size by one step.
   * Capped at EDITOR_DEFAULTS.FONT_SIZE_MAX.
   *
   * @returns {CodeEditor} this
   */
  increaseFont() {
    this.#applyFontSize(
      Math.min(this.#fontSize + EDITOR_DEFAULTS.FONT_SIZE_STEP, EDITOR_DEFAULTS.FONT_SIZE_MAX),
      true
    );
    return this;
  }

  /**
   * Decrease the editor font size by one step.
   * Capped at EDITOR_DEFAULTS.FONT_SIZE_MIN.
   *
   * @returns {CodeEditor} this
   */
  decreaseFont() {
    this.#applyFontSize(
      Math.max(this.#fontSize - EDITOR_DEFAULTS.FONT_SIZE_STEP, EDITOR_DEFAULTS.FONT_SIZE_MIN),
      true
    );
    return this;
  }

  // ---- Private: rendering --------------------------------------------------

  /**
   * Render the complete editor shell into the given container.
   * Called once from mount(). Clear and re-render on reset if needed.
   *
   * @param {HTMLElement} container
   */
  #render(container) {
    this.#root = container;
    this.#root.className = CSS.ROOT;
    this.#root.setAttribute('role', 'region');
    this.#root.setAttribute('aria-label', `${this.#config.language} code editor`);

    this.#root.innerHTML = `
      ${this.#renderLiveRegion()}
      ${this.#renderUploadInput()}
      ${this.#config.showToolbar ? this.#renderToolbar() : ''}
      ${this.#renderEditor()}
      ${this.#config.showStatusBar ? this.#renderStatusBar() : ''}
    `;
  }

  /**
   * Render the ARIA live region for screen reader announcements.
   * This element is always present, regardless of toolbar/status config.
   *
   * @returns {string} HTML string
   */
  #renderLiveRegion() {
    return `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text">
      </div>
    `;
  }

  /**
   * Render the hidden file upload input.
   *
   * @returns {string}
   */
  #renderUploadInput() {
    return `
      <input class="${CSS.UPLOAD_INPUT}"
             id="${this.#config.containerId}-upload"
             type="file"
             accept=".py,text/x-python,text/plain"
             aria-hidden="true"
             tabindex="-1"
             style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;">
    `;
  }

  /**
   * Render the editor toolbar with all action buttons.
   *
   * @returns {string} HTML string
   */
  #renderToolbar() {
    const btn = (action, label, iconName, title = label) => `
      <button class="${CSS.TOOLBAR_BTN}"
              type="button"
              data-action="${escapeAttr(action)}"
              aria-label="${escapeAttr(label)}"
              title="${escapeAttr(title)}"
              ${this.#config.readonly && ['reset', 'upload'].includes(action) ? 'disabled aria-disabled="true"' : ''}>
        <span aria-hidden="true">${icon(iconName, 16)}</span>
        <span class="sr-only">${escapeHtml(label)}</span>
      </button>
    `;

    const divider = `<span class="${CSS.TOOLBAR_DIVIDER}" aria-hidden="true"></span>`;

    return `
      <div class="${CSS.TOOLBAR}" role="toolbar" aria-label="Editor toolbar">

        <!-- Execution group -->
        <div class="${CSS.TOOLBAR_GROUP}">
          ${btn('run',      'Run code (Ctrl+Enter)',   'play',     'Run (Ctrl+Enter)')}
        </div>

        ${divider}

        <!-- Edit group -->
        <div class="${CSS.TOOLBAR_GROUP}">
          ${btn('reset',    'Reset to original code',  'reset',    'Reset')}
          ${btn('copy',     'Copy code (Ctrl+C)',       'copy',     'Copy (Ctrl+C)')}
        </div>

        ${divider}

        <!-- File group -->
        <div class="${CSS.TOOLBAR_GROUP}">
          ${btn('download', 'Download as .py file',    'download', 'Download .py')}
          ${btn('upload',   'Upload .py file',         'upload',   'Upload .py')}
        </div>

        ${divider}

        <!-- View group -->
        <div class="${CSS.TOOLBAR_GROUP}">
          <button class="${CSS.TOOLBAR_BTN}"
                  type="button"
                  data-action="wrap"
                  aria-label="Toggle word wrap"
                  aria-pressed="${this.#wordWrap}"
                  title="Word wrap">
            <span aria-hidden="true">${icon('wrap', 16)}</span>
            <span class="sr-only">Word wrap</span>
          </button>
          <button class="${CSS.TOOLBAR_BTN}"
                  type="button"
                  data-action="fullscreen"
                  aria-label="Enter fullscreen"
                  aria-pressed="false"
                  title="Fullscreen (F11)">
            <span aria-hidden="true">${icon('fullscreen', 16)}</span>
            <span class="sr-only">Fullscreen</span>
          </button>
        </div>

        ${divider}

        <!-- Font size group -->
        <div class="${CSS.TOOLBAR_GROUP}">
          <button class="${CSS.TOOLBAR_BTN}"
                  type="button"
                  data-action="font-decrease"
                  aria-label="Decrease font size"
                  title="Smaller font">
            <span aria-hidden="true" style="font-size:11px;font-weight:700;line-height:1">A−</span>
            <span class="sr-only">Decrease font size</span>
          </button>
          <span class="${CSS.TOOLBAR_BTN}"
                style="pointer-events:none;min-width:2.5rem;text-align:center;"
                aria-live="polite"
                aria-label="Current font size"
                data-font-display>
            ${this.#fontSize}px
          </span>
          <button class="${CSS.TOOLBAR_BTN}"
                  type="button"
                  data-action="font-increase"
                  aria-label="Increase font size"
                  title="Larger font">
            <span aria-hidden="true" style="font-size:14px;font-weight:700;line-height:1">A+</span>
            <span class="sr-only">Increase font size</span>
          </button>
        </div>

      </div>
    `;
  }

  /**
   * Render the editor area: gutter (line numbers) + textarea.
   *
   * @returns {string} HTML string
   */
  #renderEditor() {
    const id          = `${this.#config.containerId}-textarea`;
    const gutterHtml  = this.#config.showLineNumbers
      ? `<div class="${CSS.GUTTER}" aria-hidden="true" id="${this.#config.containerId}-gutter"></div>`
      : '';

    return `
      <div class="${CSS.EDITOR_AREA}">
        ${gutterHtml}
        <textarea
          class="${CSS.TEXTAREA}"
          id="${escapeAttr(id)}"
          name="${escapeAttr(id)}"
          aria-label="${escapeAttr(this.#config.language)} code editor. Use Tab to indent."
          aria-multiline="true"
          aria-required="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          wrap="${this.#wordWrap ? 'soft' : 'off'}"
          ${this.#config.readonly ? 'readonly aria-readonly="true"' : ''}
          style="font-size:${this.#fontSize}px;tab-size:${EDITOR_DEFAULTS.TAB_SIZE};"
        ></textarea>
      </div>
    `;
  }

  /**
   * Render the status bar below the editor.
   *
   * @returns {string} HTML string
   */
  #renderStatusBar() {
    const s = (id, label, value) => `
      <span class="${CSS.STATUS_ITEM}">
        <span class="${CSS.STATUS_LABEL}">${escapeHtml(label)}:</span>
        <span class="${CSS.STATUS_VALUE}" id="${escapeAttr(id)}" aria-live="polite">${escapeHtml(String(value))}</span>
      </span>
    `;

    return `
      <div class="${CSS.STATUS}" role="status" aria-label="Editor status">
        <div class="${CSS.STATUS_LEFT}">
          ${s(`${this.#config.containerId}-stat-lines`, 'Lines', '0')}
          ${s(`${this.#config.containerId}-stat-chars`, 'Chars', '0')}
        </div>
        <div class="${CSS.STATUS_RIGHT}">
          ${s(`${this.#config.containerId}-stat-line`, 'Ln', '1')}
          ${s(`${this.#config.containerId}-stat-col`,  'Col', '1')}
        </div>
      </div>
    `;
  }

  // ---- Private: DOM caching -----------------------------------------------

  /**
   * Cache references to rendered interactive elements.
   * Called once after #render() to avoid repeated querySelector calls.
   */
  #cacheRefs() {
    const id = this.#config.containerId;

    this.#toolbar     = this.#root?.querySelector(`.${CSS.TOOLBAR}`) ?? null;
    this.#editorArea  = this.#root?.querySelector(`.${CSS.EDITOR_AREA}`) ?? null;
    this.#gutter      = this.#root?.querySelector(`#${id}-gutter`) ?? null;
    this.#textarea    = this.#root?.querySelector(`#${id}-textarea`) ?? null;
    this.#statusBar   = this.#root?.querySelector(`.${CSS.STATUS}`) ?? null;
    this.#liveRegion  = this.#root?.querySelector(`.${CSS.LIVE}`) ?? null;
    this.#uploadInput = this.#root?.querySelector(`#${id}-upload`) ?? null;

    // Status value spans
    this.#statLines = this.#root?.querySelector(`#${id}-stat-lines`) ?? null;
    this.#statChars = this.#root?.querySelector(`#${id}-stat-chars`) ?? null;
    this.#statLine  = this.#root?.querySelector(`#${id}-stat-line`) ?? null;
    this.#statCol   = this.#root?.querySelector(`#${id}-stat-col`) ?? null;
  }

  // ---- Private: event attachment ------------------------------------------

  /**
   * Attach all event listeners.
   * Every listener is stored in #cleanupFns for precise teardown in destroy().
   */
  #attachEvents() {
    this.#attachToolbarEvents();
    this.#attachTextareaEvents();
    this.#attachUploadEvents();
    this.#attachGlobalKeyboardEvents();
    this.#attachResizeObserver();
  }

  /**
   * Attach click handlers to toolbar buttons using event delegation.
   */
  #attachToolbarEvents() {
    if (!this.#toolbar) return;

    const onClick = (e) => {
      const btn = e.target.closest(`[data-action]`);
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;

      switch (btn.dataset.action) {
        case 'run':           this.#handleRun();         break;
        case 'reset':         this.reset();              break;
        case 'copy':          this.#handleCopy();        break;
        case 'download':      this.download();           break;
        case 'upload':        this.#uploadInput?.click(); break;
        case 'fullscreen':    this.toggleFullscreen();   break;
        case 'wrap':          this.toggleWordWrap();     break;
        case 'font-increase': this.increaseFont();       break;
        case 'font-decrease': this.decreaseFont();       break;
        default: break;
      }
    };

    this.#toolbar.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#toolbar?.removeEventListener('click', onClick));
  }

  /**
   * Attach all textarea-level events: input, keydown, scroll, focus/blur,
   * selection change (for status bar cursor updates).
   */
  #attachTextareaEvents() {
    if (!this.#textarea) return;

    // Content changes
    const onInput = () => {
      this.#afterChange();
      if (this.#config.autosave && !this.#config.readonly) {
        this.#debouncedAutosave();
      }
    };
    this.#textarea.addEventListener('input', onInput);
    this.#cleanupFns.push(() => this.#textarea?.removeEventListener('input', onInput));

    // Keyboard shortcuts and special key handling
    const onKeydown = (e) => this.#handleTextareaKeydown(e);
    this.#textarea.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => this.#textarea?.removeEventListener('keydown', onKeydown));

    // Cursor position for status bar — fires on click, keyboard, and programmatic selection
    const onSelectionChange = () => this.#updateStatus();
    this.#textarea.addEventListener('click',   onSelectionChange);
    this.#textarea.addEventListener('keyup',   onSelectionChange);
    this.#cleanupFns.push(() => {
      this.#textarea?.removeEventListener('click',   onSelectionChange);
      this.#textarea?.removeEventListener('keyup',   onSelectionChange);
    });

    // Sync gutter scroll with textarea scroll
    if (this.#gutter) {
      const onScroll = () => {
        if (this.#gutter) {
          this.#gutter.scrollTop = this.#textarea?.scrollTop ?? 0;
        }
      };
      this.#textarea.addEventListener('scroll', onScroll, { passive: true });
      this.#cleanupFns.push(() => this.#textarea?.removeEventListener('scroll', onScroll));
    }

    // Focus ring on the root for external styling
    const onFocus = () => this.#root?.classList.add(CSS.ROOT_FOCUSED);
    const onBlur  = () => this.#root?.classList.remove(CSS.ROOT_FOCUSED);
    this.#textarea.addEventListener('focus', onFocus);
    this.#textarea.addEventListener('blur',  onBlur);
    this.#cleanupFns.push(() => {
      this.#textarea?.removeEventListener('focus', onFocus);
      this.#textarea?.removeEventListener('blur',  onBlur);
    });
  }

  /**
   * Attach the file upload input change handler.
   */
  #attachUploadEvents() {
    if (!this.#uploadInput) return;

    const onChange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.upload(file);
        // Reset the input so the same file can be re-uploaded if needed
        this.#uploadInput.value = '';
      }
    };

    this.#uploadInput.addEventListener('change', onChange);
    this.#cleanupFns.push(() => this.#uploadInput?.removeEventListener('change', onChange));
  }

  /**
   * Attach global keyboard shortcuts that work regardless of which element
   * has focus (Escape for fullscreen exit, F11 for fullscreen toggle).
   */
  #attachGlobalKeyboardEvents() {
    const onKeydown = (e) => {
      // F11 — toggle fullscreen (only when focus is within our editor)
      if (e.key === 'F11' && this.#root?.contains(document.activeElement)) {
        e.preventDefault();
        this.toggleFullscreen();
        return;
      }

      // Escape — exit fullscreen
      if (e.key === 'Escape' && this.#fullscreen) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    };

    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));
  }

  /**
   * Use a ResizeObserver on the editor area to auto-resize the textarea
   * when the container dimensions change (e.g. sidebar open/close, responsive).
   */
  #attachResizeObserver() {
    if (!this.#editorArea || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      this.#autoResize();
    });

    observer.observe(this.#editorArea);
    this.#cleanupFns.push(() => observer.disconnect());
  }

  // ---- Private: keyboard handlers -----------------------------------------

  /**
   * Handle all keydown events on the textarea.
   * Implements: Tab/Shift+Tab, Ctrl+S, Ctrl+/ (comment), Ctrl+Enter,
   * and delegates Ctrl+C to the copy handler.
   *
   * @param {KeyboardEvent} e
   */
  #handleTextareaKeydown(e) {
    const ta      = /** @type {HTMLTextAreaElement} */ (e.target);
    const ctrl    = e.ctrlKey || e.metaKey;
    const shift   = e.shiftKey;

    // ── Ctrl+S — save draft ────────────────────────────────────────────────
    if (ctrl && e.key === 's') {
      e.preventDefault();
      if (!this.#config.readonly) this.saveDraft();
      return;
    }

    // ── Ctrl+Enter — run ───────────────────────────────────────────────────
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      this.#handleRun();
      return;
    }

    // ── Ctrl+A — select all (browser handles this; we intercept for announce) ─
    // Do not intercept — let the browser handle Ctrl+A naturally.

    // ── Ctrl+/ — toggle line comment ──────────────────────────────────────
    if (ctrl && e.key === '/') {
      e.preventDefault();
      this.#toggleLineComment(ta);
      return;
    }

    // ── Tab — insert spaces / outdent ─────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault();
      if (shift) {
        this.#outdent(ta);
      } else {
        this.#indent(ta);
      }
      return;
    }

    // ── Enter — auto-indent to match current line's leading whitespace ────
    if (e.key === 'Enter' && !ctrl && !shift) {
      e.preventDefault();
      this.#autoIndentNewLine(ta);
      return;
    }
  }

  // ---- Private: editor operations -----------------------------------------

  /**
   * Emit the editor:run event with the current code.
   * Page scripts (tutorial-detail.js, project-detail.js) listen for this
   * event and pass the code to Pyodide or the platform's execution layer.
   */
  #handleRun() {
    const value = this.getValue();
    this.#dispatch(EDITOR_EVENTS.RUN, { value });
    this.#announce('Running code…');
  }

  /**
   * Copy the current editor content to the clipboard.
   * Shows a brief visual success state on the copy button.
   */
  #handleCopy() {
    const value = this.getValue();

    const applyFeedback = () => {
      const copyBtn = this.#toolbar?.querySelector('[data-action="copy"]');
      if (!copyBtn) return;

      const iconSpan = copyBtn.querySelector('span[aria-hidden]');
      if (iconSpan) iconSpan.innerHTML = icon('check', 16);
      copyBtn.classList.add(CSS.COPY_SUCCESS);
      copyBtn.setAttribute('aria-label', 'Copied!');

      this.#copyFeedbackTimer = setTimeout(() => {
        if (iconSpan) iconSpan.innerHTML = icon('copy', 16);
        copyBtn.classList.remove(CSS.COPY_SUCCESS);
        copyBtn.setAttribute('aria-label', 'Copy code (Ctrl+C)');
        this.#copyFeedbackTimer = null;
      }, 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(() => {
        applyFeedback();
        this.#dispatch(EDITOR_EVENTS.COPY, { value });
        this.#announce('Code copied to clipboard.');
      }).catch(() => {
        this.#announce('Copy failed. Please copy manually.');
      });
    } else {
      // Fallback for browsers without Clipboard API
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        applyFeedback();
        this.#dispatch(EDITOR_EVENTS.COPY, { value });
        this.#announce('Code copied to clipboard.');
      } catch {
        this.#announce('Copy failed. Please copy manually.');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  /**
   * Insert 4 spaces (or a tab-width of spaces) at the cursor position.
   * If text is selected and spans multiple lines, indent all selected lines.
   *
   * @param {HTMLTextAreaElement} ta
   */
  #indent(ta) {
    const spaces = ' '.repeat(EDITOR_DEFAULTS.TAB_SIZE);
    const { selectionStart: start, selectionEnd: end, value } = ta;

    if (start === end) {
      // No selection — insert spaces at caret
      this.#insertAtCursor(ta, spaces);
      return;
    }

    // Multi-line selection — indent every line
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd   = value.indexOf('\n', end);
    const block     = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const indented  = block.split('\n').map((l) => spaces + l).join('\n');

    ta.setRangeText(indented, lineStart, lineEnd === -1 ? value.length : lineEnd, 'select');
    this.#afterChange();
  }

  /**
   * Remove up to TAB_SIZE leading spaces from the cursor's line(s).
   * If text is selected across multiple lines, outdents all of them.
   *
   * @param {HTMLTextAreaElement} ta
   */
  #outdent(ta) {
    const spaces    = EDITOR_DEFAULTS.TAB_SIZE;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd   = value.indexOf('\n', end);
    const block     = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

    const outdented = block.split('\n').map((line) => {
      const leading = line.match(/^ */)[0].length;
      const remove  = Math.min(leading, spaces);
      return line.slice(remove);
    }).join('\n');

    ta.setRangeText(outdented, lineStart, lineEnd === -1 ? value.length : lineEnd, 'select');
    this.#afterChange();
  }

  /**
   * Toggle a Python comment (#) on the current line or all selected lines.
   * If all lines are already commented, removes the comment prefix.
   * Otherwise adds a comment prefix.
   *
   * @param {HTMLTextAreaElement} ta
   */
  #toggleLineComment(ta) {
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd   = value.indexOf('\n', end);
    const block     = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const lines     = block.split('\n');

    const allCommented = lines.every((l) => l.trimStart().startsWith('# ') || l.trim() === '');

    const toggled = lines.map((line) => {
      if (allCommented) {
        return line.replace(/^(\s*)# /, '$1');
      } else {
        const leadingMatch = line.match(/^(\s*)/);
        const leading = leadingMatch ? leadingMatch[1] : '';
        return `${leading}# ${line.slice(leading.length)}`;
      }
    }).join('\n');

    ta.setRangeText(toggled, lineStart, lineEnd === -1 ? value.length : lineEnd, 'select');
    this.#afterChange();

    this.#announce(allCommented ? 'Lines uncommented.' : 'Lines commented.');
  }

  /**
   * Insert a newline and match the current line's leading whitespace.
   * If the current line ends with a colon (Python block opener), add an
   * additional indent level.
   *
   * @param {HTMLTextAreaElement} ta
   */
  #autoIndentNewLine(ta) {
    const { selectionStart: pos, value } = ta;
    const lineStart    = value.lastIndexOf('\n', pos - 1) + 1;
    const currentLine  = value.slice(lineStart, pos);
    const leadingMatch = currentLine.match(/^(\s*)/);
    const leading      = leadingMatch ? leadingMatch[1] : '';
    const trimmed      = currentLine.trimEnd();
    const extraIndent  = trimmed.endsWith(':')
      ? ' '.repeat(EDITOR_DEFAULTS.TAB_SIZE)
      : '';

    this.#insertAtCursor(ta, `\n${leading}${extraIndent}`);
  }

  /**
   * Insert a string at the current cursor position, updating the selection.
   * Uses document.execCommand('insertText') when available to maintain
   * the browser's native undo/redo stack. Falls back to setRangeText.
   *
   * @param {HTMLTextAreaElement} ta
   * @param {string} text
   */
  #insertAtCursor(ta, text) {
    const { selectionStart: start, selectionEnd: end } = ta;

    // Prefer execCommand — keeps the native undo stack intact
    const success = document.execCommand('insertText', false, text);

    if (!success) {
      // Fallback: manual insertion (breaks undo history in some browsers)
      ta.setRangeText(text, start, end, 'end');
    }

    this.#afterChange();
  }

  // ---- Private: post-change lifecycle -------------------------------------

  /**
   * Called after every content change.
   * Updates line numbers, status bar, and auto-resizes the textarea.
   */
  #afterChange() {
    this.#updateLineNumbers();
    this.#updateStatus();
    this.#autoResize();

    const value = this.getValue();

    this.#dispatch(EDITOR_EVENTS.CHANGED, {
      value,
      lines: value.split('\n').length,
      chars: value.length,
    });
  }

  // ---- Private: line numbers ----------------------------------------------

  /**
   * Synchronise the line-number gutter with the textarea content.
   * Renders one <span> per line, marking the cursor's current line as active.
   */
  #updateLineNumbers() {
    if (!this.#gutter || !this.#config.showLineNumbers) return;

    const value       = this.#textarea?.value ?? '';
    const lineCount   = value.split('\n').length;
    const currentLine = this.#getCursorLine();

    // Build HTML efficiently — avoid innerHTML reassignment on every keystroke
    // by checking if the count hasn't changed
    const existingCount = this.#gutter.children.length;
    if (existingCount !== lineCount) {
      this.#gutter.innerHTML = Array.from(
        { length: lineCount },
        (_, i) => `<span class="${CSS.GUTTER_LINE} ${i + 1 === currentLine ? CSS.GUTTER_ACTIVE : ''}"
                         aria-hidden="true">${i + 1}</span>`
      ).join('');
    } else {
      // Just update the active class efficiently
      const spans = this.#gutter.children;
      for (let i = 0; i < spans.length; i++) {
        spans[i].classList.toggle(CSS.GUTTER_ACTIVE, i + 1 === currentLine);
      }
    }
  }

  // ---- Private: status bar ------------------------------------------------

  /**
   * Update all status bar values: line count, character count,
   * cursor line, and cursor column.
   */
  #updateStatus() {
    if (!this.#config.showStatusBar) return;

    const value    = this.#textarea?.value ?? '';
    const lines    = value.split('\n').length;
    const chars    = value.length;
    const curLine  = this.#getCursorLine();
    const curCol   = this.#getCursorCol();

    if (this.#statLines) this.#statLines.textContent = String(lines);
    if (this.#statChars) this.#statChars.textContent = String(chars);
    if (this.#statLine)  this.#statLine.textContent  = String(curLine);
    if (this.#statCol)   this.#statCol.textContent   = String(curCol);
  }

  // ---- Private: auto-resize -----------------------------------------------

  /**
   * Auto-resize the textarea to fit its content.
   * Sets height to 'auto' first to allow shrinking, then to scrollHeight.
   */
  #autoResize() {
    if (!this.#textarea) return;

    this.#textarea.style.height = 'auto';
    this.#textarea.style.height = `${this.#textarea.scrollHeight}px`;
  }

  // ---- Private: view state -------------------------------------------------

  /**
   * Apply a font size to the editor and update all related UI elements.
   *
   * @param {number}  newSize
   * @param {boolean} announce — Whether to announce the change to screen readers
   */
  #applyFontSize(newSize, announce) {
    const clamped = Math.max(
      EDITOR_DEFAULTS.FONT_SIZE_MIN,
      Math.min(EDITOR_DEFAULTS.FONT_SIZE_MAX, newSize)
    );

    this.#fontSize = clamped;

    if (this.#textarea) {
      this.#textarea.style.fontSize = `${clamped}px`;
    }

    if (this.#gutter) {
      this.#gutter.style.fontSize = `${clamped}px`;
    }

    // Update the font size display in the toolbar
    const display = this.#toolbar?.querySelector('[data-font-display]');
    if (display) {
      display.textContent = `${clamped}px`;
    }

    if (announce) {
      this.#announce(`Font size: ${clamped}px`);
    }
  }

  /**
   * Apply or remove word wrap mode.
   *
   * @param {boolean} active
   * @param {boolean} announce
   */
  #applyWordWrap(active, announce) {
    this.#wordWrap = active;

    if (this.#textarea) {
      this.#textarea.setAttribute('wrap', active ? 'soft' : 'off');
    }

    this.#root?.classList.toggle(CSS.ROOT_WRAP, active);

    // Update the wrap button state
    const wrapBtn = this.#toolbar?.querySelector('[data-action="wrap"]');
    if (wrapBtn) {
      wrapBtn.setAttribute('aria-pressed', String(active));
      wrapBtn.classList.toggle(CSS.TOOLBAR_BTN_ACTIVE, active);
    }

    this.#dispatch(EDITOR_EVENTS.WRAP, { active });

    if (announce) {
      this.#announce(`Word wrap ${active ? 'on' : 'off'}.`);
    }
  }

  // ---- Private: cursor helpers --------------------------------------------

  /**
   * Compute the 1-based line number of the cursor's current position.
   *
   * @returns {number}
   */
  #getCursorLine() {
    if (!this.#textarea) return 1;
    const pos  = this.#textarea.selectionStart ?? 0;
    const text = this.#textarea.value.slice(0, pos);
    return text.split('\n').length;
  }

  /**
   * Compute the 1-based column number of the cursor's current position.
   *
   * @returns {number}
   */
  #getCursorCol() {
    if (!this.#textarea) return 1;
    const pos      = this.#textarea.selectionStart ?? 0;
    const text     = this.#textarea.value.slice(0, pos);
    const lastLine = text.slice(text.lastIndexOf('\n') + 1);
    return lastLine.length + 1;
  }

  // ---- Private: filename helper -------------------------------------------

  /**
   * Derive a sensible .py filename for download.
   * Strips the 'pyai-draft-' prefix and appends '.py'.
   *
   * @returns {string}
   */
  #deriveFilename() {
    return (
      this.#config.storageKey
        .replace(/^pyai-draft-/, '')
        .replace(/[^a-z0-9_-]/gi, '_')
        .toLowerCase() || 'code'
    ) + '.py';
  }

  // ---- Private: accessibility ---------------------------------------------

  /**
   * Write a message to the ARIA live region for screen reader announcement.
   * Clears first to ensure re-announcements of the same string still trigger AT.
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

  // ---- Private: event bus -------------------------------------------------

  /**
   * Publish an event to the project event bus and dispatch a native CustomEvent.
   * Consistent with navigation.js, header.js, footer.js, quiz.js.
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