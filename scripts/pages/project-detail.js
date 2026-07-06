/**
 * =============================================================================
 * PROJECT DETAIL PAGE MODULE
 * scripts/pages/project-detail.js
 * -----------------------------------------------------------------------------
 * The step-by-step build experience for a single real-world AI/Python project,
 * comparable to GitHub Learning Lab, Codecademy Projects, DataCamp Projects,
 * and Coursera Guided Projects.
 *
 * ARCHITECTURE:
 *   ProjectDetailPage (default export)
 *     └─ Self-contained: resolves project data from a static PROJECT_REGISTRY
 *        (mirroring lesson-player.js's LESSON_REGISTRY pattern), reads/writes
 *        progress through the injected ProgressTracker, and dynamically
 *        imports code-editor.js only when an interactive milestone requires
 *        a live editor.
 *
 * SECTIONS (rendered in document order):
 *   1.  Breadcrumb Navigation   — Projects → category → project title
 *   2.  Hero Banner             — title, tagline, completion badge
 *   3.  Project Overview        — description, difficulty, duration, XP reward
 *   4.  Technologies Used       — chip list
 *   5.  Skills Learned          — chip list
 *   6.  Learning Objectives     — ordered list
 *   7.  Requirements Checklist  — what the learner needs before starting
 *   8.  Prerequisites           — links to recommended prior tutorials
 *   9.  Step-by-Step Milestones — the main build sequence, each with:
 *         • Interactive Task Checklist (sub-steps)
 *         • Embedded Code Editor (for milestones with a coding task)
 *         • Run Code button + Output Console
 *         • Hints (progressively revealed)
 *  10.  Resource Links          — docs, datasets, articles for the project
 *  11.  Notes Panel             — personal notes, auto-saved
 *  12.  Progress Tracker        — overall completion bar across milestones
 *  13.  Completion Status       — banner shown once all milestones are done
 *  14.  Achievement Unlock      — inline celebration when a new badge unlocks
 *  15.  Previous / Next Project — inter-project navigation
 *  16.  Related Projects        — same-category suggestions
 *  17.  Footer Integration      — lightweight CTA bridging into the global footer
 *
 * MILESTONE STATE MACHINE:
 *   Each milestone has a set of sub-steps (checklist items). A milestone is
 *   "complete" once every sub-step is checked. The project's overall
 *   completion percentage is (completed milestones / total milestones) * 100.
 *   Marking the final milestone complete triggers markComplete()-equivalent
 *   behaviour: the tracker is updated to PROJECT_STATE.COMPLETED, the
 *   completion banner renders, and project:completed fires.
 *
 * PROGRESS TRACKING:
 *   • Starting the project calls tracker.recordProjectUpdate(id, 'in-progress')
 *   • Checking a sub-step calls tracker.recordProjectStep(id, stepId)
 *   • Completing all milestones calls
 *     tracker.recordProjectUpdate(id, 'completed', { title })
 *   • Auto-save persists scroll position, notes, and editor drafts via
 *     localStorage, debounced at 800 ms
 *
 * REACTIVE UPDATES:
 *   • state:updated          → refresh theme
 *   • project:started        → no-op while already viewing this project
 *   • project:completed      → refresh completion badge and progress bar
 *   • progress:updated       → debounced refresh of progress-dependent regions
 *   • theme:changed          → toggle dark-mode root class
 *   • router:afterNavigate   → load a different project when the route changes
 *
 * EVENT EMISSIONS:
 *   project:mounted       { id, title }
 *   project:updated       { id, pct }
 *   project:stepCompleted { id, milestoneId, stepId, pct }
 *   project:completed     { id, title, xp }
 *   project:destroyed     { id }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces step completion, milestone completion,
 *     and full project completion
 *   • Every checklist item is a real checkbox input with a matching label
 *   • Focus moves to the project H1 on mount
 *   • Reduced motion: progress bar and completion banner appear instantly
 *   • Hints are revealed via a real disclosure button (aria-expanded)
 *
 * PERFORMANCE:
 *   • code-editor.js is dynamically imported only for milestones with a
 *     coding task, and only when that milestone becomes visible/active
 *   • Notes autosave is debounced at 800 ms; progress refresh at 250 ms
 *   • Only the progress bar, completion badge, and milestone list patch on
 *     refresh — the static sections never re-render after mount
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/projects/:projectId',
 *     title:     (ctx) => `Project — ${ctx.params.projectId}`,
 *     component: () => import('./pages/project-detail.js'),
 *   }
 *
 * EXPORTS:
 *   ProjectDetailPage    — primary class (default export)
 *   PROJECT_DETAIL_EVENTS — event name constants
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
 * Event names emitted by the project detail page.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROJECT_DETAIL_EVENTS = Object.freeze({
  MOUNTED:         'project:mounted',
  UPDATED:         'project:updated',
  STEP_COMPLETED:  'project:stepCompleted',
  COMPLETED:       'project:completed',
  DESTROYED:       'project:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Notes autosave debounce delay (ms) */
const NOTE_AUTOSAVE_DELAY = 800;

/** progress:updated debounce delay (ms) */
const REFRESH_DEBOUNCE_MS = 250;

/** localStorage key prefixes */
const NOTES_KEY_PREFIX    = 'pyai-project-notes-';
const BOOKMARK_KEY_PREFIX = 'pyai-project-bookmark-';
const FAVOURITE_KEY_PREFIX = 'pyai-project-favourite-';
const SCROLL_KEY_PREFIX   = 'pyai-project-scroll-';
const HINTS_KEY_PREFIX    = 'pyai-project-hints-';

// ---------------------------------------------------------------------------
// Static project registry
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:       string, title: string, description: string,
 *   difficulty: 'beginner'|'intermediate'|'advanced', category: string,
 *   technologies: string[], skills: string[], estimatedHours: number,
 *   xpReward: number, icon: string, accent: string,
 *   objectives: string[], requirements: string[],
 *   prerequisites: Array<{ title: string, path: string }>,
 *   milestones: ProjectMilestone[],
 *   resources: Array<{ title: string, url: string, type: string }>,
 *   prev: { id: string, title: string } | null,
 *   next: { id: string, title: string } | null,
 * }} ProjectData
 */

/**
 * @typedef {{
 *   id: string, title: string, description: string,
 *   steps: Array<{ id: string, label: string }>,
 *   hasEditor: boolean, starterCode: string, hints: string[],
 * }} ProjectMilestone
 */

/** @type {Map<string, ProjectData>} */
const PROJECT_REGISTRY = new Map([
  [
    'build-image-classifier',
    {
      id:               'build-image-classifier',
      title:            'Build an Image Classifier',
      description:      'Train a convolutional neural network on a labelled image dataset, evaluate its accuracy, and expose it behind a simple REST API for real-time predictions.',
      difficulty:       'advanced',
      category:         'computer-vision',
      technologies:     ['Python', 'PyTorch', 'FastAPI'],
      skills:           ['CNN Architecture', 'Model Training', 'Model Evaluation', 'API Deployment'],
      estimatedHours:   8,
      xpReward:         200,
      icon:             '🏗️',
      accent:           'var(--color-danger)',
      objectives: [
        'Load and preprocess an image classification dataset.',
        'Design and train a convolutional neural network from scratch.',
        'Evaluate model accuracy using a held-out test set.',
        'Serve predictions through a lightweight REST endpoint.',
      ],
      requirements: [
        'A working Python 3.10+ environment (or use the browser playground).',
        'Basic familiarity with NumPy arrays.',
        'PyTorch installed, or use the in-browser Pyodide runtime.',
      ],
      prerequisites: [
        { title: 'NumPy Fundamentals',              path: '/tutorials/numpy-fundamentals'    },
        { title: 'Introduction to Neural Networks',  path: '/tutorials/neural-networks-intro' },
      ],
      milestones: [
        {
          id: 'load-data', title: 'Load and Explore the Dataset',
          description: 'Download the dataset, inspect class balance, and visualise a few sample images.',
          steps: [
            { id: 's1', label: 'Download and extract the dataset' },
            { id: 's2', label: 'Load images into a PyTorch Dataset object' },
            { id: 's3', label: 'Visualise class distribution' },
          ],
          hasEditor: true,
          starterCode: 'from torchvision import datasets, transforms\n\ntransform = transforms.Compose([\n    transforms.Resize((64, 64)),\n    transforms.ToTensor(),\n])\n\n# Load your dataset here\ndataset = None\nprint("Dataset loaded:", dataset)\n',
          hints: [
            'Use torchvision.datasets.ImageFolder if your data is organised in class subfolders.',
            'transforms.Compose lets you chain resizing and tensor conversion in one step.',
          ],
        },
        {
          id: 'build-model', title: 'Design the CNN Architecture',
          description: 'Define a convolutional neural network with at least two convolutional blocks.',
          steps: [
            { id: 's1', label: 'Define the model class' },
            { id: 's2', label: 'Add convolutional and pooling layers' },
            { id: 's3', label: 'Add a fully-connected classification head' },
          ],
          hasEditor: true,
          starterCode: 'import torch.nn as nn\n\nclass SimpleCNN(nn.Module):\n    def __init__(self, num_classes):\n        super().__init__()\n        # Define your layers here\n        pass\n\n    def forward(self, x):\n        # Define the forward pass here\n        return x\n\nmodel = SimpleCNN(num_classes=10)\nprint(model)\n',
          hints: [
            'Start with Conv2d → ReLU → MaxPool2d blocks, doubling channels each time.',
            'Flatten before your final Linear layer.',
          ],
        },
        {
          id: 'train-model', title: 'Train the Model',
          description: 'Write the training loop with a loss function and optimiser.',
          steps: [
            { id: 's1', label: 'Define the loss function and optimiser' },
            { id: 's2', label: 'Write the training loop' },
            { id: 's3', label: 'Track loss across epochs' },
          ],
          hasEditor: true,
          starterCode: 'import torch\nimport torch.optim as optim\n\ncriterion = torch.nn.CrossEntropyLoss()\noptimizer = optim.Adam(model.parameters(), lr=0.001)\n\n# Write your training loop here\nfor epoch in range(5):\n    pass\n',
          hints: [
            'Remember to call optimizer.zero_grad() before each backward pass.',
            'Track epoch loss to confirm the model is actually learning.',
          ],
        },
        {
          id: 'evaluate', title: 'Evaluate Accuracy',
          description: 'Run the trained model against a held-out test set and report accuracy.',
          steps: [
            { id: 's1', label: 'Run inference on the test set' },
            { id: 's2', label: 'Compute accuracy' },
            { id: 's3', label: 'Identify misclassified examples' },
          ],
          hasEditor: true,
          starterCode: 'correct = 0\ntotal = 0\n\n# Evaluate the model here\n\nprint(f"Accuracy: {100 * correct / total:.2f}%")\n',
          hints: [
            'Wrap evaluation in torch.no_grad() to save memory.',
            'Use torch.argmax on the model output to get predicted classes.',
          ],
        },
        {
          id: 'deploy', title: 'Deploy the API',
          description: 'Wrap the trained model in a minimal FastAPI endpoint.',
          steps: [
            { id: 's1', label: 'Create a FastAPI app' },
            { id: 's2', label: 'Add a /predict endpoint' },
            { id: 's3', label: 'Test the endpoint with a sample image' },
          ],
          hasEditor: true,
          starterCode: 'from fastapi import FastAPI, UploadFile\n\napp = FastAPI()\n\n@app.post("/predict")\nasync def predict(file: UploadFile):\n    # Load image, run inference, return prediction\n    return {"prediction": None}\n',
          hints: [
            'Use PIL.Image.open on the uploaded file bytes before preprocessing.',
            'Return the predicted class label as JSON.',
          ],
        },
      ],
      resources: [
        { title: 'PyTorch: Training a Classifier', url: 'https://pytorch.org/tutorials/beginner/blitz/cifar10_tutorial.html', type: 'doc' },
        { title: 'FastAPI Documentation',           url: 'https://fastapi.tiangolo.com/',                                       type: 'doc' },
      ],
      prev: null,
      next: { id: 'chatbot-transformer', title: 'Transformer-Based Chatbot' },
    },
  ],
  [
    'sentiment-dashboard',
    {
      id:               'sentiment-dashboard',
      title:            'Sentiment Analysis Dashboard',
      description:      'Classify text by sentiment using a Naive Bayes or Logistic Regression model, then visualise sentiment trends on a lightweight dashboard.',
      difficulty:       'intermediate',
      category:         'nlp',
      technologies:     ['Python', 'scikit-learn', 'Plotly'],
      skills:           ['Text Classification', 'TF-IDF', 'Data Visualisation'],
      estimatedHours:   5,
      xpReward:         130,
      icon:             '😊',
      accent:           'var(--color-warning)',
      objectives: [
        'Preprocess and vectorise text data using TF-IDF.',
        'Train a text classification model.',
        'Visualise sentiment trends over time.',
      ],
      requirements: [
        'A CSV dataset of labelled text samples.',
        'Basic familiarity with pandas DataFrames.',
      ],
      prerequisites: [
        { title: 'Data Analysis with Pandas', path: '/tutorials/pandas-data-analysis' },
      ],
      milestones: [
        {
          id: 'prep-data', title: 'Prepare the Dataset',
          description: 'Load and clean the labelled text dataset.',
          steps: [
            { id: 's1', label: 'Load the dataset into a DataFrame' },
            { id: 's2', label: 'Clean and normalise the text column' },
          ],
          hasEditor: true,
          starterCode: 'import pandas as pd\n\ndf = pd.read_csv("reviews.csv")\nprint(df.head())\n',
          hints: ['Lowercase text and strip punctuation before vectorising.'],
        },
        {
          id: 'vectorise', title: 'Vectorise and Train',
          description: 'Convert text to TF-IDF features and train a classifier.',
          steps: [
            { id: 's1', label: 'Fit a TF-IDF vectoriser' },
            { id: 's2', label: 'Train a classification model' },
          ],
          hasEditor: true,
          starterCode: 'from sklearn.feature_extraction.text import TfidfVectorizer\nfrom sklearn.linear_model import LogisticRegression\n\nvectoriser = TfidfVectorizer(max_features=5000)\n# Fit and train here\n',
          hints: ['max_features limits vocabulary size and speeds up training.'],
        },
        {
          id: 'visualise', title: 'Build the Dashboard',
          description: 'Plot sentiment trends using Plotly.',
          steps: [
            { id: 's1', label: 'Aggregate sentiment by date' },
            { id: 's2', label: 'Create a trend line chart' },
          ],
          hasEditor: true,
          starterCode: 'import plotly.express as px\n\n# Build your chart here\nfig = None\n',
          hints: ['px.line() is the simplest way to plot a sentiment trend over time.'],
        },
      ],
      resources: [
        { title: 'scikit-learn TF-IDF Guide', url: 'https://scikit-learn.org/stable/modules/feature_extraction.html', type: 'doc' },
      ],
      prev: { id: 'build-image-classifier', title: 'Build an Image Classifier' },
      next: { id: 'chatbot-transformer',    title: 'Transformer-Based Chatbot' },
    },
  ],
]);

/** Generic fallback project used when the requested ID is not in the registry */
const GENERIC_PROJECT_TEMPLATE = Object.freeze({
  difficulty: 'intermediate', category: 'general', technologies: ['Python'],
  skills: ['Problem Solving'], estimatedHours: 4, xpReward: 100, icon: '🔧',
  accent: 'var(--color-primary)', objectives: [], requirements: [], prerequisites: [],
  milestones: [], resources: [], prev: null, next: null,
});

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:               'pd-page',
  ROOT_DARK:          'pd-page--dark',
  ROOT_REDUCED:       'pd-page--reduced-motion',
  ROOT_COMPLETE:      'pd-page--complete',
  LIVE:               'pd-page__live',

  BREADCRUMB:         'pd-breadcrumb',
  BREADCRUMB_LIST:    'pd-breadcrumb__list',
  BREADCRUMB_ITEM:    'pd-breadcrumb__item',
  BREADCRUMB_SEP:     'pd-breadcrumb__sep',
  BREADCRUMB_LINK:    'pd-breadcrumb__link',
  BREADCRUMB_CURRENT: 'pd-breadcrumb__current',

  HERO:               'pd-hero',
  HERO_ICON:          'pd-hero__icon',
  HERO_TITLE:         'pd-hero__title',
  HERO_BADGE:         'pd-hero__badge',
  HERO_BADGE_DONE:    'pd-hero__badge--done',
  HERO_ACTIONS:       'pd-hero__actions',
  HERO_BTN:           'pd-hero__btn',
  HERO_BTN_ACTIVE:    'pd-hero__btn--active',

  LAYOUT:             'pd-layout',
  MAIN:               'pd-main',
  ASIDE:              'pd-aside',

  SECTION:            'pd-section',
  SECTION_HEADER:     'pd-section__header',
  SECTION_TITLE:      'pd-section__title',

  META_GRID:          'pd-meta__grid',
  META_ITEM:          'pd-meta__item',
  META_LABEL:         'pd-meta__label',
  META_VALUE:         'pd-meta__value',

  CHIPS:              'pd-chips',
  CHIP:                'pd-chip',

  OBJECTIVES_LIST:    'pd-objectives__list',
  REQUIREMENTS_LIST:  'pd-requirements__list',
  REQUIREMENTS_ICON:  'pd-requirements__icon',

  PREREQ_LIST:        'pd-prereq__list',
  PREREQ_ITEM:        'pd-prereq__item',

  MILESTONE:          'pd-milestone',
  MILESTONE_HEADER:   'pd-milestone__header',
  MILESTONE_NUM:      'pd-milestone__num',
  MILESTONE_NUM_DONE: 'pd-milestone__num--done',
  MILESTONE_TITLE:    'pd-milestone__title',
  MILESTONE_DESC:     'pd-milestone__desc',
  MILESTONE_CHECKLIST:'pd-milestone__checklist',
  MILESTONE_CHECK_ITEM:'pd-milestone__check-item',
  MILESTONE_CHECKBOX: 'pd-milestone__checkbox',

  EDITOR_WRAP:        'pd-editor',
  EDITOR_HEADER:      'pd-editor__header',
  EDITOR_CONTAINER:   'pd-editor__container',
  EDITOR_OUTPUT:      'pd-editor__output',
  EDITOR_OUTPUT_LINE: 'pd-editor__output-line',
  EDITOR_OUTPUT_EMPTY:'pd-editor__output-empty',
  EDITOR_CONTROLS:    'pd-editor__controls',
  EDITOR_BTN_RUN:     'pd-editor__btn-run',
  EDITOR_STATUS:      'pd-editor__status',

  HINTS:              'pd-hints',
  HINTS_TOGGLE:       'pd-hints__toggle',
  HINTS_LIST:         'pd-hints__list',
  HINTS_ITEM:         'pd-hints__item',

  RESOURCES_LIST:     'pd-resources__list',
  RESOURCES_ICON:     'pd-resources__icon',

  NOTES:              'pd-notes',
  NOTES_TEXTAREA:     'pd-notes__textarea',
  NOTES_FOOTER:       'pd-notes__footer',
  NOTES_SAVED:        'pd-notes__saved',

  PROGRESS:           'pd-progress',
  PROGRESS_BAR:       'pd-progress__bar',
  PROGRESS_FILL:      'pd-progress__fill',
  PROGRESS_LABEL:     'pd-progress__label',

  COMPLETE_BANNER:    'pd-complete',
  COMPLETE_ICON:      'pd-complete__icon',
  COMPLETE_XP:        'pd-complete__xp',
  COMPLETE_ACTIONS:   'pd-complete__actions',

  ACHIEVEMENT_TOAST:  'pd-achievement-toast',

  NAV:                'pd-nav',
  NAV_BTN:             'pd-nav__btn',
  NAV_DIR:            'pd-nav__dir',
  NAV_TITLE:          'pd-nav__title',

  RELATED_GRID:       'pd-related__grid',
  RELATED_CARD:       'pd-related__card',

  FOOTER_CTA:         'pd-footer-cta',
  FOOTER_CTA_INNER:   'pd-footer-cta__inner',
  FOOTER_CTA_BTN:     'pd-footer-cta__btn',

  ERROR_STATE:        'pd-error',
  ERROR_BTN:          'pd-error__btn',
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

/**
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function & { cancel: () => void, flush: () => void }}
 */
function debounce(fn, ms) {
  let timer = null, lastArgs = null;
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

/** @returns {boolean} */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** @param {string} key @returns {string|null} */
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
/** @param {string} key @param {string} value */
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* quota */ } }

/**
 * @param {string} key
 * @returns {Record<string, boolean>}
 */
function lsGetJson(key) {
  try {
    const raw = lsGet(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {object} icon
 * @returns {string}
 */
function resourceIcon(type) {
  return { doc: '📄', video: '▶️', article: '📰', github: '🐙', dataset: '📦' }[type] ?? '🔗';
}

/**
 * Resolve a full ProjectData object for the given ID, merging registry data
 * with the generic fallback template so every field is always defined.
 *
 * @param {string|null} id
 * @returns {ProjectData|null}
 */
function resolveProject(id) {
  if (!id) return null;
  const registered = PROJECT_REGISTRY.get(id);
  if (registered) return registered;

  // Unknown project ID — synthesise a minimal but structurally valid record
  // so the page can still render something useful rather than a dead end.
  return {
    id,
    title: id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    description: 'Project details are being finalised. Check back soon for the full walkthrough.',
    ...GENERIC_PROJECT_TEMPLATE,
  };
}

// ---------------------------------------------------------------------------
// EditorMount — thin CodeEditor lifecycle wrapper (mirrors lesson-player.js)
// ---------------------------------------------------------------------------

/**
 * Mounts and tears down a single CodeEditor instance for one milestone.
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
      console.warn('[ProjectDetailPage] CodeEditor import failed:', err);
    }
  }

  /** @returns {string} */
  getValue() { return this.#instance?.getValue() ?? ''; }

  destroy() {
    try { this.#instance?.destroy(); } catch { /* swallow */ }
    this.#instance = null;
  }
}

// ---------------------------------------------------------------------------
// ProjectDetailPage — primary class
// ---------------------------------------------------------------------------

/**
 * Project Detail page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — resolve project data, theme, saved state
 *   3. mount()               — render, mount editors, attach events
 *   4. refresh()             — patch progress-dependent regions
 *   5. destroy()             — teardown editors, listeners, DOM
 */
export default class ProjectDetailPage {

  // ---- Configuration -------------------------------------------------------

  /**
   * @type {{
   *   containerId: string,
   *   tracker:     object|null,
   *   router:      object|null,
   *   store:       object|null,
   *   projectId:   string|null,
   * }}
   */
  #config;

  // ---- State ---------------------------------------------------------------

  /** @type {boolean}       */ #mounted    = false;
  /** @type {boolean}       */ #destroyed  = false;
  /** @type {string}        */ #theme      = 'light';
  /** @type {boolean}       */ #bookmarked = false;
  /** @type {boolean}       */ #favourite  = false;
  /** @type {boolean}       */ #complete   = false;

  /** @type {ProjectData|null} */ #project = null;
  /** @type {number}           */ #startTime = 0;

  /** @type {Set<string>} — milestone IDs whose hints panel is expanded */
  #expandedHints = new Set();

  // ---- Sub-systems ---------------------------------------------------------

  /** @type {Map<string, EditorMount>} — milestoneId → EditorMount */
  #editors = new Map();

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}         */ #root       = null;
  /** @type {HTMLElement|null}         */ #liveRegion = null;
  /** @type {HTMLTextAreaElement|null} */ #notesEl    = null;

  // ---- Debounced handlers ---------------------------------------------------

  /** @type {Function & { cancel: () => void, flush: () => void }} */
  #debouncedNoteSave;

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
   *   projectId?:   string|null,
   * }} [config={}]
   */
  constructor(config = {}) {
    this.#config = Object.freeze({
      containerId: config.containerId ?? 'app-outlet',
      tracker:     config.tracker     ?? null,
      router:      config.router      ?? null,
      store:       config.store       ?? null,
      projectId:   config.projectId   ?? null,
    });

    this.#debouncedNoteSave = debounce(() => this.#persistNotes(), NOTE_AUTOSAVE_DELAY);
    this.#debouncedRefresh  = debounce(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  }

  // ---- Static router integration -------------------------------------------

  /**
   * @param {HTMLElement} outlet
   * @param {object}      ctx
   */
  static mount(outlet, ctx) {
    const instance = new ProjectDetailPage({
      containerId: outlet.id || 'app-outlet',
      tracker:     ctx?.meta?.tracker    ?? null,
      router:      ctx?.meta?.router     ?? null,
      store:       ctx?.meta?.store      ?? null,
      projectId:   ctx?.params?.projectId ?? null,
    });
    outlet.__projectDetailPage = instance;
    instance.#root             = outlet;
    instance.initialize();
    instance.mount();
  }

  /**
   * @param {HTMLElement} outlet
   */
  static unmount(outlet) {
    outlet.__projectDetailPage?.destroy();
    delete outlet.__projectDetailPage;
  }

  // ---- Public API: lifecycle -----------------------------------------------

  /**
   * Resolve project data, theme, and saved bookmark/favourite state.
   *
   * @returns {ProjectDetailPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    const id = this.#config.projectId ?? this.#extractProjectIdFromUrl();
    this.#project = resolveProject(id);

    if (this.#project) {
      this.#bookmarked = lsGet(`${BOOKMARK_KEY_PREFIX}${this.#project.id}`) === 'true';
      this.#favourite  = lsGet(`${FAVOURITE_KEY_PREFIX}${this.#project.id}`) === 'true';
    }

    return this;
  }

  /**
   * Render the page, mount editors, attach events.
   *
   * @returns {ProjectDetailPage} this
   */
  mount() {
    if (this.#mounted || this.#destroyed) return this;

    if (!this.#root) {
      this.#root = document.getElementById(this.#config.containerId);
    }
    if (!this.#root) {
      console.error(`[ProjectDetailPage] Container #${this.#config.containerId} not found.`);
      return this;
    }

    this.#startTime = Date.now();

    if (!this.#project) {
      this.#renderErrorState('Project not found.');
      return this;
    }

    this.render();
    this.#attachEventListeners();
    this.#mountEditors();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#mounted = true;

    requestAnimationFrame(() => {
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(PROJECT_DETAIL_EVENTS.MOUNTED, { id: this.#project.id, title: this.#project.title });
    this.#announce(`Project loaded: ${this.#project.title}`);

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {ProjectDetailPage} this
   */
  render() {
    if (!this.#root || !this.#project) return this;

    const p       = this.#project;
    const isDark  = this.#theme === 'dark';
    const reduced = prefersReducedMotion();
    const pct     = this.#computeCompletionPct();
    this.#complete = pct >= 100 && p.milestones.length > 0;

    this.#root.className = [
      CSS.ROOT,
      isDark   ? CSS.ROOT_DARK    : '',
      reduced  ? CSS.ROOT_REDUCED : '',
      this.#complete ? CSS.ROOT_COMPLETE : '',
    ].filter(Boolean).join(' ');

    this.#root.setAttribute('role', 'main');
    this.#root.setAttribute('aria-label', `Project: ${p.title}`);

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}" role="status" aria-live="polite" aria-atomic="true" aria-relevant="text"></div>

      ${this.#renderBreadcrumb(p)}
      ${this.#renderHero(p, pct)}
      <div id="pd-progress-region">${this.#renderProgressTracker(pct)}</div>

      <div class="${CSS.LAYOUT}">
        <main class="${CSS.MAIN}">
          ${this.#renderOverview(p)}
          ${this.#renderTechnologies(p)}
          ${this.#renderSkills(p)}
          ${this.#renderObjectives(p)}
          ${this.#renderRequirements(p)}
          ${p.prerequisites.length ? this.#renderPrerequisites(p) : ''}
          <div id="pd-milestones-region">${this.#renderMilestones(p)}</div>
          ${p.resources.length ? this.#renderResources(p) : ''}
        </main>
        <aside class="${CSS.ASIDE}">
          ${this.#renderNotes(p)}
        </aside>
      </div>

      ${this.#renderProjectNav(p)}
      ${this.#renderRelatedProjects(p)}
      ${this.#complete ? this.#renderCompleteBanner(p) : ''}
      ${this.#renderFooterCTA()}
    `;

    this.#liveRegion = this.#root.querySelector(`.${CSS.LIVE}`);
    this.#notesEl    = this.#root.querySelector(`.${CSS.NOTES_TEXTAREA}`);

    return this;
  }

  /**
   * Patch progress-dependent regions without a full re-render.
   *
   * @returns {ProjectDetailPage} this
   */
  refresh() {
    if (!this.#mounted || !this.#project) return this;

    const pct = this.#computeCompletionPct();
    const wasComplete = this.#complete;
    this.#complete = pct >= 100 && this.#project.milestones.length > 0;

    this.#updateProgressBar(pct);
    this.#refreshHeroBadge();

    if (this.#complete && !wasComplete) {
      this.#showCompletionBanner();
    }

    this.#dispatch(PROJECT_DETAIL_EVENTS.UPDATED, { id: this.#project.id, pct });
    return this;
  }

  /**
   * Tear down editors, listeners, and DOM.
   *
   * @returns {ProjectDetailPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedNoteSave.flush();
    this.#debouncedNoteSave.cancel();
    this.#debouncedRefresh.cancel();

    this.#persistScrollPosition();
    this.#destroyEditors();

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

    if (this.#project) {
      this.#dispatch(PROJECT_DETAIL_EVENTS.DESTROYED, { id: this.#project.id });
    }

    return this;
  }

  // ---- Private: rendering — breadcrumb / hero / progress ---------------------

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderBreadcrumb(p) {
    const crumbs = [
      { label: 'Projects', path: '/projects' },
      { label: p.category.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), path: `/projects?category=${encodeURIComponent(p.category)}` },
      { label: p.title, path: null },
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
      <nav class="${CSS.BREADCRUMB}" aria-label="Project breadcrumb">
        <ol class="${CSS.BREADCRUMB_LIST}" role="list">${items}</ol>
      </nav>
    `;
  }

  /**
   * @param {ProjectData} p
   * @param {number}      pct
   * @returns {string}
   */
  #renderHero(p, pct) {
    const diffLabel = p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1);

    return `
      <header class="${CSS.HERO}">
        <span class="${CSS.HERO_ICON}" aria-hidden="true" style="color:${p.accent}">${escapeHtml(p.icon)}</span>
        <span class="${CSS.HERO_BADGE} ${this.#complete ? CSS.HERO_BADGE_DONE : ''}"
              id="pd-hero-badge"
              aria-label="${this.#complete ? 'Completed' : diffLabel + ' difficulty'}">
          ${this.#complete ? '✅ Completed' : escapeHtml(diffLabel)}
        </span>
        <h1 tabindex="-1">${escapeHtml(p.title)}</h1>
        <p>${escapeHtml(p.description)}</p>
        <div class="${CSS.HERO_ACTIONS}">
          <button class="${CSS.HERO_BTN} ${this.#bookmarked ? CSS.HERO_BTN_ACTIVE : ''}"
                  id="pd-bookmark-btn" type="button" data-action="toggle-bookmark"
                  aria-pressed="${this.#bookmarked}"
                  aria-label="${this.#bookmarked ? 'Remove bookmark' : 'Bookmark this project'}">
            🔖 ${this.#bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <button class="${CSS.HERO_BTN} ${this.#favourite ? CSS.HERO_BTN_ACTIVE : ''}"
                  id="pd-favourite-btn" type="button" data-action="toggle-favourite"
                  aria-pressed="${this.#favourite}"
                  aria-label="${this.#favourite ? 'Remove from favourites' : 'Add to favourites'}">
            ❤️ ${this.#favourite ? 'Favourited' : 'Favourite'}
          </button>
          <button class="${CSS.HERO_BTN}" type="button" data-action="share-project"
                  aria-label="Share this project">
            🔗 Share
          </button>
        </div>
      </header>
    `;
  }

  /**
   * @param {number} pct
   * @returns {string}
   */
  #renderProgressTracker(pct) {
    return `
      <div class="${CSS.PROGRESS}" aria-label="Project progress">
        <div class="${CSS.PROGRESS_BAR}" id="pd-progress-bar" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Project progress: ${pct}%">
          <div class="${CSS.PROGRESS_FILL}" id="pd-progress-fill"
               style="width:${pct}%;transition:${prefersReducedMotion() ? 'none' : 'width 0.4s ease-out'}"></div>
        </div>
        <span class="${CSS.PROGRESS_LABEL}" id="pd-progress-label" aria-live="polite">${pct}% complete</span>
      </div>
    `;
  }

  // ---- Private: rendering — overview / meta ----------------------------------

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderOverview(p) {
    return `
      <section class="${CSS.SECTION}" aria-labelledby="overview-heading">
        <h2 id="overview-heading" class="sr-only">Project Overview</h2>
        <div class="${CSS.META_GRID}" role="list" aria-label="Project details">
          <div class="${CSS.META_ITEM}" role="listitem">
            <span class="${CSS.META_LABEL}">Difficulty</span>
            <span class="${CSS.META_VALUE}">${escapeHtml(p.difficulty)}</span>
          </div>
          <div class="${CSS.META_ITEM}" role="listitem">
            <span class="${CSS.META_LABEL}">Duration</span>
            <span class="${CSS.META_VALUE}">${p.estimatedHours}h</span>
          </div>
          <div class="${CSS.META_ITEM}" role="listitem">
            <span class="${CSS.META_LABEL}">XP Reward</span>
            <span class="${CSS.META_VALUE}">+${p.xpReward} XP</span>
          </div>
          <div class="${CSS.META_ITEM}" role="listitem">
            <span class="${CSS.META_LABEL}">Milestones</span>
            <span class="${CSS.META_VALUE}">${p.milestones.length}</span>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderTechnologies(p) {
    if (p.technologies.length === 0) return '';
    return `
      <section class="${CSS.SECTION}" aria-labelledby="tech-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="tech-heading">Technologies Used</h2>
        <div class="${CSS.CHIPS}" aria-label="Technologies used in this project">
          ${p.technologies.map((t) => `<span class="${CSS.CHIP}">${escapeHtml(t)}</span>`).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderSkills(p) {
    if (p.skills.length === 0) return '';
    return `
      <section class="${CSS.SECTION}" aria-labelledby="skills-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="skills-heading">Skills Learned</h2>
        <div class="${CSS.CHIPS}" aria-label="Skills learned in this project">
          ${p.skills.map((s) => `<span class="${CSS.CHIP}">${escapeHtml(s)}</span>`).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderObjectives(p) {
    if (p.objectives.length === 0) return '';
    return `
      <section class="${CSS.SECTION}" aria-labelledby="objectives-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="objectives-heading">Learning Objectives</h2>
        <ol class="${CSS.OBJECTIVES_LIST}" aria-label="Learning objectives">
          ${p.objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
        </ol>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderRequirements(p) {
    if (p.requirements.length === 0) return '';
    return `
      <section class="${CSS.SECTION}" aria-labelledby="requirements-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="requirements-heading">Requirements Checklist</h2>
        <ul class="${CSS.REQUIREMENTS_LIST}" aria-label="Requirements">
          ${p.requirements.map((r) => `
            <li><span class="${CSS.REQUIREMENTS_ICON}" aria-hidden="true">✓</span>${escapeHtml(r)}</li>
          `).join('')}
        </ul>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderPrerequisites(p) {
    return `
      <section class="${CSS.SECTION}" aria-labelledby="prereq-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="prereq-heading">Prerequisites</h2>
        <ul class="${CSS.PREREQ_LIST}" aria-label="Recommended prior tutorials">
          ${p.prerequisites.map((pr) => `
            <li class="${CSS.PREREQ_ITEM}">
              <a href="${escapeAttr(pr.path)}" data-action="navigate" data-path="${escapeAttr(pr.path)}">
                ${escapeHtml(pr.title)}
              </a>
            </li>
          `).join('')}
        </ul>
      </section>
    `;
  }

  // ---- Private: rendering — milestones ----------------------------------------

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderMilestones(p) {
    if (p.milestones.length === 0) {
      return `
        <section class="${CSS.SECTION}" aria-labelledby="milestones-heading">
          <h2 class="${CSS.SECTION_TITLE}" id="milestones-heading">Step-by-Step Milestones</h2>
          <p class="${CSS.SECTION}">Milestones for this project are being finalised.</p>
        </section>
      `;
    }

    const completedSteps = this.#getCompletedSteps();

    const blocks = p.milestones.map((m, i) => {
      const total = m.steps.length;
      const done  = m.steps.filter((s) => completedSteps[`${m.id}:${s.id}`]).length;
      const isMilestoneDone = total > 0 && done === total;

      return `
        <div class="${CSS.MILESTONE}" data-milestone-id="${escapeAttr(m.id)}">
          <div class="${CSS.MILESTONE_HEADER}">
            <span class="${CSS.MILESTONE_NUM} ${isMilestoneDone ? CSS.MILESTONE_NUM_DONE : ''}" aria-hidden="true">
              ${isMilestoneDone ? '✓' : i + 1}
            </span>
            <h3 class="${CSS.MILESTONE_TITLE}">${escapeHtml(m.title)}</h3>
          </div>
          <p class="${CSS.MILESTONE_DESC}">${escapeHtml(m.description)}</p>

          <fieldset class="${CSS.MILESTONE_CHECKLIST}">
            <legend class="sr-only">Tasks for ${escapeAttr(m.title)}</legend>
            ${m.steps.map((s) => {
              const stepKey = `${m.id}:${s.id}`;
              const checked = Boolean(completedSteps[stepKey]);
              const inputId = `pd-step-${escapeAttr(m.id)}-${escapeAttr(s.id)}`;
              return `
                <div class="${CSS.MILESTONE_CHECK_ITEM}">
                  <input class="${CSS.MILESTONE_CHECKBOX}"
                         type="checkbox"
                         id="${inputId}"
                         data-action="toggle-step"
                         data-milestone="${escapeAttr(m.id)}"
                         data-step="${escapeAttr(s.id)}"
                         ${checked ? 'checked' : ''}>
                  <label for="${inputId}">${escapeHtml(s.label)}</label>
                </div>
              `;
            }).join('')}
          </fieldset>

          ${m.hasEditor ? this.#renderMilestoneEditor(m) : ''}
          ${m.hints?.length ? this.#renderHints(m) : ''}
        </div>
      `;
    }).join('');

    return `
      <section class="${CSS.SECTION}" aria-labelledby="milestones-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="milestones-heading">Step-by-Step Milestones</h2>
        ${blocks}
      </section>
    `;
  }

  /**
   * @param {ProjectMilestone} m
   * @returns {string}
   */
  #renderMilestoneEditor(m) {
    const editorId = `pd-editor-${escapeAttr(m.id)}`;
    const outputId = `pd-output-${escapeAttr(m.id)}`;
    const statusId = `pd-status-${escapeAttr(m.id)}`;

    return `
      <div class="${CSS.EDITOR_WRAP}" data-editor-milestone="${escapeAttr(m.id)}">
        <div class="${CSS.EDITOR_HEADER}">
          <span>⌨️ Milestone Code</span>
        </div>
        <div class="${CSS.EDITOR_CONTAINER}" id="${editorId}" aria-label="Python code editor for this milestone"></div>
        <div class="${CSS.EDITOR_OUTPUT}" id="${outputId}" role="log" aria-label="Milestone output" aria-live="polite" hidden>
          <span class="${CSS.EDITOR_OUTPUT_EMPTY}">Run your code to see output here.</span>
        </div>
        <div class="${CSS.EDITOR_CONTROLS}">
          <button class="${CSS.EDITOR_BTN_RUN}" type="button" data-action="run-code"
                  data-milestone="${escapeAttr(m.id)}" aria-label="Run code for this milestone">
            ▶ Run
          </button>
          <span class="${CSS.EDITOR_STATUS}" id="${statusId}" aria-live="polite">Ready</span>
        </div>
      </div>
    `;
  }

  /**
   * @param {ProjectMilestone} m
   * @returns {string}
   */
  #renderHints(m) {
    const expanded = this.#expandedHints.has(m.id);
    return `
      <div class="${CSS.HINTS}">
        <button class="${CSS.HINTS_TOGGLE}" type="button" data-action="toggle-hints" data-milestone="${escapeAttr(m.id)}"
                aria-expanded="${expanded}" aria-controls="pd-hints-${escapeAttr(m.id)}">
          💡 ${expanded ? 'Hide Hints' : 'Show Hints'}
        </button>
        <ul class="${CSS.HINTS_LIST}" id="pd-hints-${escapeAttr(m.id)}" ${expanded ? '' : 'hidden'} aria-label="Hints for ${escapeAttr(m.title)}">
          ${m.hints.map((h) => `<li class="${CSS.HINTS_ITEM}">${escapeHtml(h)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // ---- Private: rendering — resources / notes / nav / related ----------------

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderResources(p) {
    return `
      <section class="${CSS.SECTION}" aria-labelledby="resources-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="resources-heading">📚 Resource Links</h2>
        <ul class="${CSS.RESOURCES_LIST}" aria-label="External resources">
          ${p.resources.map((r) => `
            <li>
              <a href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer"
                 aria-label="${escapeAttr(r.title)} (opens in new tab)">
                <span class="${CSS.RESOURCES_ICON}" aria-hidden="true">${resourceIcon(r.type)}</span>
                ${escapeHtml(r.title)}
              </a>
            </li>
          `).join('')}
        </ul>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderNotes(p) {
    const saved = lsGet(`${NOTES_KEY_PREFIX}${p.id}`) ?? '';
    return `
      <section class="${CSS.NOTES}" aria-labelledby="notes-heading">
        <h3 id="notes-heading">📝 My Notes</h3>
        <label for="pd-notes-textarea" class="sr-only">Personal notes for this project</label>
        <textarea class="${CSS.NOTES_TEXTAREA}" id="pd-notes-textarea"
                  placeholder="Jot down ideas, blockers, or reminders… saved automatically."
                  aria-label="Personal notes — auto-saved" rows="8" maxlength="10000">${escapeHtml(saved)}</textarea>
        <div class="${CSS.NOTES_FOOTER}">
          <span class="${CSS.NOTES_SAVED}" id="pd-notes-saved" aria-live="polite" style="opacity:0">Saved ✓</span>
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderProjectNav(p) {
    const prevHtml = p.prev ? `
      <button class="${CSS.NAV_BTN}" type="button" data-action="nav-project" data-id="${escapeAttr(p.prev.id)}"
              aria-label="Previous project: ${escapeAttr(p.prev.title)}">
        <span class="${CSS.NAV_DIR}">← Previous</span>
        <span class="${CSS.NAV_TITLE}">${escapeHtml(p.prev.title)}</span>
      </button>
    ` : '<span></span>';

    const nextHtml = p.next ? `
      <button class="${CSS.NAV_BTN}" type="button" data-action="nav-project" data-id="${escapeAttr(p.next.id)}"
              aria-label="Next project: ${escapeAttr(p.next.title)}">
        <span class="${CSS.NAV_DIR}">Next →</span>
        <span class="${CSS.NAV_TITLE}">${escapeHtml(p.next.title)}</span>
      </button>
    ` : '<span></span>';

    return `
      <nav class="${CSS.NAV}" aria-label="Project navigation">
        ${prevHtml}${nextHtml}
      </nav>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderRelatedProjects(p) {
    const related = [...PROJECT_REGISTRY.values()]
      .filter((other) => other.id !== p.id && other.category === p.category)
      .slice(0, 3);

    if (related.length === 0) return '';

    return `
      <section class="${CSS.SECTION}" aria-labelledby="related-heading">
        <h2 class="${CSS.SECTION_TITLE}" id="related-heading">Related Projects</h2>
        <div class="${CSS.RELATED_GRID}" role="list" aria-label="Related projects">
          ${related.map((r) => `
            <button class="${CSS.RELATED_CARD}" type="button" data-action="nav-project" data-id="${escapeAttr(r.id)}"
                    aria-label="Open ${escapeAttr(r.title)}">
              <span aria-hidden="true" style="color:${r.accent}">${escapeHtml(r.icon)}</span>
              <span>${escapeHtml(r.title)}</span>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  /**
   * @param {ProjectData} p
   * @returns {string}
   */
  #renderCompleteBanner(p) {
    return `
      <div class="${CSS.COMPLETE_BANNER}" id="pd-complete-banner" role="alert" tabindex="-1" aria-labelledby="pd-complete-heading">
        <span class="${CSS.COMPLETE_ICON}" aria-hidden="true">🎉</span>
        <h2 id="pd-complete-heading">Project Complete!</h2>
        <p>You finished <strong>${escapeHtml(p.title)}</strong>.</p>
        <div class="${CSS.COMPLETE_XP}" aria-label="${p.xpReward} XP earned">⭐ +${p.xpReward} XP earned</div>
        <div class="${CSS.COMPLETE_ACTIONS}">
          ${p.next ? `
            <button class="btn btn--primary" type="button" data-action="nav-project" data-id="${escapeAttr(p.next.id)}"
                    aria-label="Next project: ${escapeAttr(p.next.title)}">Next Project →</button>
          ` : ''}
          <button class="btn" type="button" data-action="navigate" data-path="/projects" aria-label="Browse more projects">
            📚 Browse Projects
          </button>
        </div>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFooterCTA() {
    return `
      <section class="${CSS.FOOTER_CTA}" aria-labelledby="pd-footer-cta-heading">
        <div class="${CSS.FOOTER_CTA_INNER}">
          <h2 id="pd-footer-cta-heading">Keep building.</h2>
          <button class="${CSS.FOOTER_CTA_BTN}" type="button" data-action="navigate" data-path="/projects"
                  aria-label="Browse more projects">Browse Projects</button>
        </div>
      </section>
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
        <button class="${CSS.ERROR_BTN}" type="button" data-action="navigate" data-path="/projects"
                aria-label="Back to projects">Back to Projects</button>
      </div>
    `;
    this.#root.addEventListener('click', (e) => this.#handleClick(e));
  }

  // ---- Private: editor lifecycle -----------------------------------------------

  /**
   * Mount a CodeEditor instance for each milestone that has one.
   */
  async #mountEditors() {
    if (!this.#project) return;
    for (const m of this.#project.milestones) {
      if (!m.hasEditor) continue;
      const storageKey = `pyai-project-draft-${this.#project.id}-${m.id}`;
      const mount = new EditorMount(`pd-editor-${m.id}`, storageKey);
      await mount.mount(m.starterCode);
      this.#editors.set(m.id, mount);
    }
  }

  #destroyEditors() {
    for (const mount of this.#editors.values()) mount.destroy();
    this.#editors.clear();
  }

  // ---- Private: progress computation ---------------------------------------------

  /**
   * @returns {Record<string, boolean>} — map of "milestoneId:stepId" → completed
   */
  #getCompletedSteps() {
    if (!this.#project || !this.#config.tracker) return {};
    try {
      const record = this.#config.tracker.getProject?.(this.#project.id);
      const steps  = record?.steps ?? {};
      return steps;
    } catch {
      return {};
    }
  }

  /**
   * Compute overall completion percentage across all milestones.
   * @returns {number}
   */
  #computeCompletionPct() {
    if (!this.#project || this.#project.milestones.length === 0) return 0;
    const completedSteps = this.#getCompletedSteps();

    const totalMilestones = this.#project.milestones.length;
    const doneMilestones = this.#project.milestones.filter((m) => {
      if (m.steps.length === 0) return false;
      return m.steps.every((s) => completedSteps[`${m.id}:${s.id}`]);
    }).length;

    return Math.round((doneMilestones / totalMilestones) * 100);
  }

  /**
   * @param {number} pct
   */
  #updateProgressBar(pct) {
    const fill  = this.#root?.querySelector('#pd-progress-fill');
    const bar   = this.#root?.querySelector('#pd-progress-bar');
    const label = this.#root?.querySelector('#pd-progress-label');
    if (fill)  fill.style.width = `${pct}%`;
    if (bar)   bar.setAttribute('aria-valuenow', String(pct));
    if (label) label.textContent = `${pct}% complete`;
  }

  #refreshHeroBadge() {
    const badge = this.#root?.querySelector('#pd-hero-badge');
    if (!badge || !this.#complete) return;
    badge.textContent = '✅ Completed';
    badge.classList.add(CSS.HERO_BADGE_DONE);
    badge.setAttribute('aria-label', 'Completed');
  }

  /**
   * Insert the completion banner if not already present, mark the tracker
   * complete, and emit project:completed.
   */
  #showCompletionBanner() {
    if (!this.#project) return;

    if (this.#config.tracker) {
      try {
        this.#config.tracker.recordProjectUpdate(this.#project.id, 'completed', {
          title: this.#project.title,
        });
      } catch { /* ignore */ }
    }

    this.#root?.classList.add(CSS.ROOT_COMPLETE);

    const existing = this.#root?.querySelector(`.${CSS.COMPLETE_BANNER}`);
    if (!existing) {
      this.#root?.insertAdjacentHTML('beforeend', this.#renderCompleteBanner(this.#project));
      requestAnimationFrame(() => {
        this.#root?.querySelector(`#pd-complete-banner`)?.focus({ preventScroll: true });
      });
    }

    this.#dispatch(PROJECT_DETAIL_EVENTS.COMPLETED, {
      id: this.#project.id, title: this.#project.title, xp: this.#project.xpReward,
    });
    this.#announce(`Project complete! You earned ${this.#project.xpReward} XP.`);
  }

  // ---- Private: notes -------------------------------------------------------------

  #persistNotes() {
    if (!this.#project || !this.#notesEl) return;
    lsSet(`${NOTES_KEY_PREFIX}${this.#project.id}`, this.#notesEl.value);
    const saved = this.#root?.querySelector('#pd-notes-saved');
    if (saved) {
      saved.style.opacity = '1';
      setTimeout(() => { saved.style.opacity = '0'; }, 2000);
    }
  }

  // ---- Private: scroll position ---------------------------------------------------

  #restoreScrollPosition() {
    if (!this.#project) return;
    const saved = lsGet(`${SCROLL_KEY_PREFIX}${this.#project.id}`);
    if (saved) {
      requestAnimationFrame(() => window.scrollTo({ top: Number(saved), behavior: 'instant' }));
    }
  }

  #persistScrollPosition() {
    if (!this.#project) return;
    lsSet(`${SCROLL_KEY_PREFIX}${this.#project.id}`, String(window.scrollY));
  }

  // ---- Private: tracker integration ------------------------------------------------

  #recordStart() {
    if (!this.#project || !this.#config.tracker) return;
    try {
      const existing = this.#config.tracker.getProject?.(this.#project.id);
      if (!existing || existing.state === 'available' || existing.state === 'locked') {
        this.#config.tracker.recordProjectUpdate(this.#project.id, 'in-progress', {
          title: this.#project.title,
        });
      }
    } catch { /* ignore */ }
  }

  // ---- Private: event listeners --------------------------------------------------

  #attachEventListeners() {
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    const onChange = (e) => this.#handleChange(e);
    this.#root?.addEventListener('change', onChange);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('change', onChange));

    const onInput = (e) => {
      if (!e.target.classList.contains(CSS.NOTES_TEXTAREA)) return;
      this.#debouncedNoteSave();
    };
    this.#root?.addEventListener('input', onInput);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('input', onInput));

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
      const params = e.detail?.params ?? {};
      const newId  = params.projectId;
      if (newId && newId !== this.#project?.id) {
        this.#loadProject(newId);
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() => document.removeEventListener('router:afterNavigate', onRouterNavigate));

    const onVisibility = () => { if (document.hidden) this.#persistScrollPosition(); };
    document.addEventListener('visibilitychange', onVisibility);
    this.#cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  /**
   * Load a different project in place (called on router navigation to a
   * different :projectId while this page instance stays mounted).
   *
   * @param {string} id
   */
  #loadProject(id) {
    this.#persistScrollPosition();
    this.#destroyEditors();

    const next = resolveProject(id);
    if (!next) {
      this.#renderErrorState(`Project "${id}" not found.`);
      return;
    }

    this.#project    = next;
    this.#complete    = false;
    this.#startTime   = Date.now();
    this.#bookmarked  = lsGet(`${BOOKMARK_KEY_PREFIX}${id}`) === 'true';
    this.#favourite   = lsGet(`${FAVOURITE_KEY_PREFIX}${id}`) === 'true';
    this.#expandedHints = new Set();

    this.render();
    this.#mountEditors();
    this.#restoreScrollPosition();
    this.#recordStart();

    this.#dispatch(PROJECT_DETAIL_EVENTS.MOUNTED, { id: next.id, title: next.title });
    this.#announce(`Project loaded: ${next.title}`);
  }

  // ---- Private: change handler (checkboxes) ---------------------------------------

  /**
   * @param {Event} e
   */
  #handleChange(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.dataset?.action !== 'toggle-step' || !this.#project) return;

    const milestoneId = input.dataset.milestone;
    const stepId       = input.dataset.step;
    if (!milestoneId || !stepId) return;

    if (this.#config.tracker) {
      try {
        if (input.checked) {
          this.#config.tracker.recordProjectStep(this.#project.id, `${milestoneId}:${stepId}`);
        }
      } catch { /* ignore */ }
    }

    const pct = this.#computeCompletionPct();
    this.#updateProgressBar(pct);
    this.#updateMilestoneNumber(milestoneId);

    this.#dispatch(PROJECT_DETAIL_EVENTS.STEP_COMPLETED, {
      id: this.#project.id, milestoneId, stepId, pct,
    });
    this.#announce(input.checked ? 'Step marked complete.' : 'Step marked incomplete.');

    if (pct >= 100 && !this.#complete) {
      this.#complete = true;
      this.#showCompletionBanner();
    }
  }

  /**
   * Update a single milestone's numbered badge to a checkmark once all its
   * steps are complete, without re-rendering the milestone block.
   *
   * @param {string} milestoneId
   */
  #updateMilestoneNumber(milestoneId) {
    if (!this.#project) return;
    const milestone = this.#project.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return;

    const completedSteps = this.#getCompletedSteps();
    const isDone = milestone.steps.length > 0 &&
      milestone.steps.every((s) => completedSteps[`${milestoneId}:${s.id}`]);

    const block = this.#root?.querySelector(`[data-milestone-id="${milestoneId}"]`);
    const numEl = block?.querySelector(`.${CSS.MILESTONE_NUM}`);
    if (numEl) {
      numEl.classList.toggle(CSS.MILESTONE_NUM_DONE, isDone);
      if (isDone) numEl.textContent = '✓';
    }
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
      case 'toggle-bookmark': {
        if (!this.#project) break;
        this.#bookmarked = !this.#bookmarked;
        lsSet(`${BOOKMARK_KEY_PREFIX}${this.#project.id}`, String(this.#bookmarked));
        const btn = this.#root?.querySelector('#pd-bookmark-btn');
        if (btn) {
          btn.classList.toggle(CSS.HERO_BTN_ACTIVE, this.#bookmarked);
          btn.setAttribute('aria-pressed', String(this.#bookmarked));
          btn.textContent = this.#bookmarked ? '🔖 Bookmarked' : '🔖 Bookmark';
        }
        this.#announce(this.#bookmarked ? 'Project bookmarked.' : 'Bookmark removed.');
        break;
      }

      case 'toggle-favourite': {
        if (!this.#project) break;
        this.#favourite = !this.#favourite;
        lsSet(`${FAVOURITE_KEY_PREFIX}${this.#project.id}`, String(this.#favourite));
        const btn = this.#root?.querySelector('#pd-favourite-btn');
        if (btn) {
          btn.classList.toggle(CSS.HERO_BTN_ACTIVE, this.#favourite);
          btn.setAttribute('aria-pressed', String(this.#favourite));
          btn.textContent = this.#favourite ? '❤️ Favourited' : '❤️ Favourite';
        }
        this.#announce(this.#favourite ? 'Added to favourites.' : 'Removed from favourites.');
        break;
      }

      case 'share-project':
        this.#shareProject();
        break;

      case 'toggle-hints': {
        const milestoneId = actionEl.dataset.milestone;
        if (!milestoneId) break;
        if (this.#expandedHints.has(milestoneId)) {
          this.#expandedHints.delete(milestoneId);
        } else {
          this.#expandedHints.add(milestoneId);
        }
        const expanded = this.#expandedHints.has(milestoneId);
        actionEl.setAttribute('aria-expanded', String(expanded));
        actionEl.textContent = expanded ? '💡 Hide Hints' : '💡 Show Hints';
        const list = this.#root?.querySelector(`#pd-hints-${milestoneId}`);
        if (list) list.hidden = !expanded;
        break;
      }

      case 'run-code': {
        const milestoneId = actionEl.dataset.milestone;
        const mount = milestoneId ? this.#editors.get(milestoneId) : null;
        if (mount) {
          const code = mount.getValue();
          this.#dispatch('editor:run', { value: code, milestoneId });
          const status = this.#root?.querySelector(`#pd-status-${milestoneId}`);
          if (status) status.textContent = 'Running…';
        }
        break;
      }

      case 'navigate': {
        const path = actionEl.dataset.path;
        if (path) this.#navigate(path);
        break;
      }

      case 'nav-project': {
        const id = actionEl.dataset.id;
        if (id) this.#navigate(`/projects/${encodeURIComponent(id)}`);
        break;
      }

      default:
        this.#dispatch('project:action', { action });
        break;
    }
  }

  /**
   * Share the current project via the Web Share API, falling back to clipboard.
   */
  #shareProject() {
    if (!this.#project) return;
    const url  = `${window.location.origin}/projects/${this.#project.id}`;
    const text = `Check out "${this.#project.title}" on Python for AI!`;

    if (navigator.share) {
      navigator.share({ title: this.#project.title, text, url }).catch(() => { /* cancelled */ });
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => this.#announce('Project link copied to clipboard.'))
        .catch(() => this.#announce('Could not copy link.'));
    }
  }

  // ---- Private: helpers -------------------------------------------------------------

  /**
   * @returns {string|null}
   */
  #extractProjectIdFromUrl() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] === 'projects') return parts[1];
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

  // ---- Private: accessibility -------------------------------------------------------

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

  // ---- Private: event bus -------------------------------------------------------------

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