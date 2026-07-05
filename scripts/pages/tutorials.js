/**
 * =============================================================================
 * TUTORIALS PAGE MODULE
 * scripts/pages/tutorials.js
 * -----------------------------------------------------------------------------
 * Primary course browser for the Python for AI educational platform.
 * Provides live search, multi-axis filtering, progress tracking, bookmarking,
 * sorting, and reactive updates driven by the platform event bus.
 *
 * ARCHITECTURE:
 *   TutorialsPage (default export)
 *     └─ Self-contained: reads progress from the injected ProgressTracker
 *        instance and navigates via the injected Router. All filter and search
 *        state is held in private fields. No sub-components are imported.
 *
 * SECTIONS (rendered in document order):
 *   1.  Page Header        — title, subtitle, total count
 *   2.  Controls Bar       — search input, category chips, difficulty chips,
 *                            learning-path chips, sort selector
 *   3.  Active Filters     — dismissible chips for current filter state
 *   4.  Featured Tutorials — horizontally scrollable row of highlighted courses
 *   5.  Continue Learning  — cards for every in-progress tutorial
 *   6.  Tutorial Grid      — paginated grid of all matching tutorial cards
 *   7.  Recently Viewed    — last-visited tutorials from tracker records
 *   8.  Recommended        — dynamically derived from completion patterns
 *   9.  Popular            — sorted by lesson count (highest first)
 *  10.  Empty State        — shown when search/filter produces zero results
 *  11.  Loading State      — skeleton cards while data hydrates
 *  12.  Error State        — graceful error display with retry affordance
 *
 * FILTER ARCHITECTURE:
 *   All active filters are stored in #filter (a plain object). Changing any
 *   filter calls #applyFilters() which computes #filteredTutorials from
 *   TUTORIAL_CATALOGUE, then calls #renderGrid() to surgically replace only
 *   the grid section without touching the controls or surrounding layout.
 *   The URL query string is updated via replaceState so browser back/forward
 *   restores the filter state.
 *
 * REACTIVE UPDATES:
 *   • progress:updated   → refresh completion %, bookmarks, continue-learning strip
 *   • state:updated      → refresh user name in the page header
 *   • theme:changed      → toggle dark-mode root class
 *   • router:afterNavigate → parse URL query params and apply as filter preset
 *
 * EVENT EMISSIONS:
 *   tutorials:mounted    { pathname }
 *   tutorials:updated    { timestamp }
 *   tutorials:opened     { id, title }
 *   tutorials:bookmarked { id, bookmarked }
 *   tutorials:favourited { id, favourited }
 *   tutorials:destroyed  { pathname }
 *
 * ACCESSIBILITY:
 *   • ARIA live region announces search result counts and filter changes
 *   • Every interactive element has a visible label or aria-label
 *   • Keyboard navigation: Tab through controls, Enter/Space activates buttons
 *   • Focus is restored to the search input after filter chip dismissal
 *   • Reduced motion: card entrance animations are suppressed
 *   • Role landmarks: main, search, region, list, article
 *
 * PERFORMANCE:
 *   • Search is debounced at 250 ms
 *   • The tutorial grid is rendered lazily: only the first PAGE_SIZE cards are
 *     painted immediately; an IntersectionObserver sentinel triggers subsequent
 *     pages (infinite scroll hook)
 *   • Filter computation is O(N) over the catalogue — no sorting on re-render
 *   • #filteredTutorials is cached between renders; only recomputed when filters change
 *
 * USAGE (router component loader):
 *   {
 *     path:      '/tutorials',
 *     title:     'Tutorials',
 *     component: () => import('./pages/tutorials.js'),
 *   }
 *   // router calls TutorialsPage.mount(outlet, ctx) and TutorialsPage.unmount(outlet)
 *
 * EXPORTS:
 *   TutorialsPage   — primary class (default export)
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
  MOUNTED:    'tutorials:mounted',
  UPDATED:    'tutorials:updated',
  OPENED:     'tutorials:opened',
  BOOKMARKED: 'tutorials:bookmarked',
  FAVOURITED: 'tutorials:favourited',
  DESTROYED:  'tutorials:destroyed',
});

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Number of tutorial cards rendered per infinite-scroll page */
const PAGE_SIZE = 12;

/** Valid sort options */
const SORT_OPTIONS = Object.freeze([
  { value: 'recommended',   label: 'Recommended'      },
  { value: 'newest',        label: 'Newest First'      },
  { value: 'popular',       label: 'Most Popular'      },
  { value: 'duration-asc',  label: 'Shortest First'    },
  { value: 'duration-desc', label: 'Longest First'     },
  { value: 'alpha-asc',     label: 'A → Z'             },
  { value: 'alpha-desc',    label: 'Z → A'             },
]);

/** Difficulty levels */
const DIFFICULTIES = Object.freeze(['beginner', 'intermediate', 'advanced']);

/** Category definitions */
const CATEGORIES = Object.freeze([
  { value: 'all',         label: 'All'              },
  { value: 'python',      label: 'Python'           },
  { value: 'data-science',label: 'Data Science'     },
  { value: 'machine-learning', label: 'Machine Learning' },
  { value: 'deep-learning',    label: 'Deep Learning'    },
  { value: 'nlp',         label: 'NLP'              },
  { value: 'computer-vision', label: 'Computer Vision' },
  { value: 'projects',    label: 'Projects'         },
]);

/** Learning path definitions (used as a filter axis) */
const LEARNING_PATHS = Object.freeze([
  { value: 'all',          label: 'All Paths'       },
  { value: 'foundations',  label: 'AI Foundations'  },
  { value: 'ml-engineer',  label: 'ML Engineer'     },
  { value: 'dl-specialist',label: 'DL Specialist'   },
]);

// ---------------------------------------------------------------------------
// Tutorial catalogue (static seed data — replaced by API fetch in production)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id:                   string,
 *   title:                string,
 *   description:          string,
 *   difficulty:           'beginner'|'intermediate'|'advanced',
 *   category:             string,
 *   path:                 string,
 *   duration:             string,
 *   lessonCount:          number,
 *   estimatedHours:       number,
 *   completionPercentage: number,
 *   isBookmarked:         boolean,
 *   isFavourite:          boolean,
 *   lastOpened:           number|null,
 *   author:               string,
 *   icon:                 string,
 *   accent:               string,
 *   tags:                 string[],
 *   isFeatured:           boolean,
 *   isNew:                boolean,
 *   lessonPath:           string,
 *   publishedAt:          number,
 *   popularityScore:      number,
 * }} Tutorial
 */

/** @type {ReadonlyArray<Tutorial>} */
const TUTORIAL_CATALOGUE = Object.freeze([
  {
    id:                   'python-basics',
    title:                'Python Basics',
    description:          'Learn Python syntax, variables, data types, conditionals, and loops from scratch. The essential first step for every AI learner.',
    difficulty:           'beginner',
    category:             'python',
    path:                 'foundations',
    duration:             '2h 30m',
    lessonCount:          14,
    estimatedHours:       2.5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🐍',
    accent:               'var(--color-success)',
    tags:                 ['python', 'syntax', 'variables', 'loops'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/python-basics',
    publishedAt:          1_700_000_000_000,
    popularityScore:      98,
  },
  {
    id:                   'python-functions',
    title:                'Functions & Scope',
    description:          'Master function definitions, arguments, return values, closures, and decorators in Python.',
    difficulty:           'beginner',
    category:             'python',
    path:                 'foundations',
    duration:             '1h 45m',
    lessonCount:          10,
    estimatedHours:       1.75,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '⚙️',
    accent:               'var(--color-primary)',
    tags:                 ['functions', 'closures', 'decorators'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/python-functions',
    publishedAt:          1_700_100_000_000,
    popularityScore:      87,
  },
  {
    id:                   'python-oop',
    title:                'Object-Oriented Python',
    description:          'Classes, inheritance, polymorphism, and dunder methods — the OOP patterns used throughout every major ML library.',
    difficulty:           'intermediate',
    category:             'python',
    path:                 'foundations',
    duration:             '3h 00m',
    lessonCount:          16,
    estimatedHours:       3,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🏛️',
    accent:               'var(--color-accent)',
    tags:                 ['oop', 'classes', 'inheritance'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/python-oop',
    publishedAt:          1_700_200_000_000,
    popularityScore:      80,
  },
  {
    id:                   'numpy-fundamentals',
    title:                'NumPy Fundamentals',
    description:          'Arrays, indexing, broadcasting, and vectorised operations — the numerical backbone of every data science workflow.',
    difficulty:           'beginner',
    category:             'data-science',
    path:                 'foundations',
    duration:             '2h 15m',
    lessonCount:          13,
    estimatedHours:       2.25,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🔢',
    accent:               'var(--color-primary)',
    tags:                 ['numpy', 'arrays', 'vectorisation'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/numpy-fundamentals',
    publishedAt:          1_700_300_000_000,
    popularityScore:      95,
  },
  {
    id:                   'pandas-data-analysis',
    title:                'Data Analysis with Pandas',
    description:          'Load, clean, transform, aggregate, and visualise tabular data with the industry-standard Pandas library.',
    difficulty:           'intermediate',
    category:             'data-science',
    path:                 'foundations',
    duration:             '4h 00m',
    lessonCount:          22,
    estimatedHours:       4,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '📊',
    accent:               'var(--color-warning)',
    tags:                 ['pandas', 'dataframes', 'csv'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/pandas-data-analysis',
    publishedAt:          1_700_400_000_000,
    popularityScore:      96,
  },
  {
    id:                   'data-visualisation',
    title:                'Data Visualisation',
    description:          'Create compelling charts, plots, and dashboards using Matplotlib, Seaborn, and Plotly.',
    difficulty:           'beginner',
    category:             'data-science',
    path:                 'foundations',
    duration:             '2h 30m',
    lessonCount:          14,
    estimatedHours:       2.5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '📈',
    accent:               'var(--color-success)',
    tags:                 ['matplotlib', 'seaborn', 'plotly'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/data-visualisation',
    publishedAt:          1_700_500_000_000,
    popularityScore:      84,
  },
  {
    id:                   'ml-regression',
    title:                'Linear & Logistic Regression',
    description:          'Build your first predictive models from scratch, then with scikit-learn. Understand gradient descent, loss, and model evaluation.',
    difficulty:           'intermediate',
    category:             'machine-learning',
    path:                 'ml-engineer',
    duration:             '3h 30m',
    lessonCount:          18,
    estimatedHours:       3.5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '📉',
    accent:               'var(--color-accent)',
    tags:                 ['regression', 'sklearn', 'gradient-descent'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/ml-regression',
    publishedAt:          1_700_600_000_000,
    popularityScore:      91,
  },
  {
    id:                   'ml-classification',
    title:                'Classification Algorithms',
    description:          'Decision trees, random forests, SVMs, and k-NN — compare classifiers on real datasets and choose the right tool.',
    difficulty:           'intermediate',
    category:             'machine-learning',
    path:                 'ml-engineer',
    duration:             '4h 00m',
    lessonCount:          20,
    estimatedHours:       4,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🌳',
    accent:               'var(--color-success)',
    tags:                 ['classification', 'random-forest', 'svm'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/ml-classification',
    publishedAt:          1_700_700_000_000,
    popularityScore:      88,
  },
  {
    id:                   'feature-engineering',
    title:                'Feature Engineering',
    description:          'Transform raw data into powerful predictive features. Encoding, scaling, imputation, and feature selection techniques.',
    difficulty:           'intermediate',
    category:             'machine-learning',
    path:                 'ml-engineer',
    duration:             '3h 00m',
    lessonCount:          16,
    estimatedHours:       3,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '⚗️',
    accent:               'var(--color-warning)',
    tags:                 ['features', 'encoding', 'scaling'],
    isFeatured:           false,
    isNew:                true,
    lessonPath:           '/tutorials/feature-engineering',
    publishedAt:          1_710_000_000_000,
    popularityScore:      76,
  },
  {
    id:                   'model-evaluation',
    title:                'Model Evaluation & Validation',
    description:          'Cross-validation, precision/recall, ROC curves, confusion matrices, and avoiding overfitting.',
    difficulty:           'intermediate',
    category:             'machine-learning',
    path:                 'ml-engineer',
    duration:             '2h 45m',
    lessonCount:          15,
    estimatedHours:       2.75,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '✅',
    accent:               'var(--color-primary)',
    tags:                 ['evaluation', 'cross-validation', 'roc'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/model-evaluation',
    publishedAt:          1_700_800_000_000,
    popularityScore:      83,
  },
  {
    id:                   'neural-networks-intro',
    title:                'Introduction to Neural Networks',
    description:          'Perceptrons, activation functions, backpropagation, and your first MLP trained with PyTorch.',
    difficulty:           'advanced',
    category:             'deep-learning',
    path:                 'dl-specialist',
    duration:             '5h 00m',
    lessonCount:          25,
    estimatedHours:       5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🧠',
    accent:               'var(--color-danger)',
    tags:                 ['neural-networks', 'pytorch', 'backprop'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/neural-networks-intro',
    publishedAt:          1_700_900_000_000,
    popularityScore:      93,
  },
  {
    id:                   'convolutional-neural-networks',
    title:                'Convolutional Neural Networks',
    description:          'Filters, pooling, LeNet, ResNet, and transfer learning for image classification tasks.',
    difficulty:           'advanced',
    category:             'deep-learning',
    path:                 'dl-specialist',
    duration:             '6h 30m',
    lessonCount:          30,
    estimatedHours:       6.5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🖼️',
    accent:               'var(--color-accent)',
    tags:                 ['cnn', 'image-classification', 'resnet'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/convolutional-neural-networks',
    publishedAt:          1_701_000_000_000,
    popularityScore:      89,
  },
  {
    id:                   'transformers-attention',
    title:                'Attention & Transformers',
    description:          'Self-attention, multi-head attention, positional encoding, and the full Transformer architecture from scratch.',
    difficulty:           'advanced',
    category:             'nlp',
    path:                 'dl-specialist',
    duration:             '7h 00m',
    lessonCount:          34,
    estimatedHours:       7,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🔄',
    accent:               'var(--color-primary)',
    tags:                 ['transformers', 'attention', 'nlp'],
    isFeatured:           true,
    isNew:                false,
    lessonPath:           '/tutorials/transformers-attention',
    publishedAt:          1_701_100_000_000,
    popularityScore:      97,
  },
  {
    id:                   'bert-fine-tuning',
    title:                'Fine-Tuning BERT',
    description:          'Use HuggingFace Transformers to fine-tune BERT for text classification, NER, and question answering.',
    difficulty:           'advanced',
    category:             'nlp',
    path:                 'dl-specialist',
    duration:             '5h 30m',
    lessonCount:          26,
    estimatedHours:       5.5,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '💬',
    accent:               'var(--color-warning)',
    tags:                 ['bert', 'fine-tuning', 'huggingface'],
    isFeatured:           false,
    isNew:                true,
    lessonPath:           '/tutorials/bert-fine-tuning',
    publishedAt:          1_712_000_000_000,
    popularityScore:      90,
  },
  {
    id:                   'computer-vision-opencv',
    title:                'Computer Vision with OpenCV',
    description:          'Image manipulation, edge detection, object tracking, and feature matching using OpenCV and Python.',
    difficulty:           'intermediate',
    category:             'computer-vision',
    path:                 'dl-specialist',
    duration:             '4h 15m',
    lessonCount:          22,
    estimatedHours:       4.25,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '👁️',
    accent:               'var(--color-success)',
    tags:                 ['opencv', 'image-processing', 'detection'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/computer-vision-opencv',
    publishedAt:          1_701_200_000_000,
    popularityScore:      82,
  },
  {
    id:                   'build-image-classifier',
    title:                'Build an Image Classifier',
    description:          'End-to-end project: collect data, train a CNN, evaluate it, and deploy a simple REST API.',
    difficulty:           'advanced',
    category:             'projects',
    path:                 'dl-specialist',
    duration:             '6h 00m',
    lessonCount:          20,
    estimatedHours:       6,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🏗️',
    accent:               'var(--color-danger)',
    tags:                 ['project', 'cnn', 'deployment'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/build-image-classifier',
    publishedAt:          1_701_300_000_000,
    popularityScore:      86,
  },
  {
    id:                   'sentiment-analysis',
    title:                'Sentiment Analysis Pipeline',
    description:          'Build a full text classification pipeline: tokenisation, TF-IDF, logistic regression, and BERT comparison.',
    difficulty:           'intermediate',
    category:             'nlp',
    path:                 'ml-engineer',
    duration:             '3h 45m',
    lessonCount:          19,
    estimatedHours:       3.75,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '😊',
    accent:               'var(--color-warning)',
    tags:                 ['nlp', 'sentiment', 'text-classification'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/sentiment-analysis',
    publishedAt:          1_701_400_000_000,
    popularityScore:      85,
  },
  {
    id:                   'time-series-forecasting',
    title:                'Time Series Forecasting',
    description:          'ARIMA, Prophet, and LSTM-based forecasting for stock prices, weather, and sales data.',
    difficulty:           'advanced',
    category:             'machine-learning',
    path:                 'ml-engineer',
    duration:             '5h 15m',
    lessonCount:          27,
    estimatedHours:       5.25,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '⏱️',
    accent:               'var(--color-primary)',
    tags:                 ['time-series', 'arima', 'lstm'],
    isFeatured:           false,
    isNew:                false,
    lessonPath:           '/tutorials/time-series-forecasting',
    publishedAt:          1_701_500_000_000,
    popularityScore:      79,
  },
  {
    id:                   'reinforcement-learning',
    title:                'Reinforcement Learning Basics',
    description:          'Q-learning, policy gradients, and training an agent to solve OpenAI Gym environments.',
    difficulty:           'advanced',
    category:             'machine-learning',
    path:                 'dl-specialist',
    duration:             '6h 45m',
    lessonCount:          33,
    estimatedHours:       6.75,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🎮',
    accent:               'var(--color-accent)',
    tags:                 ['reinforcement-learning', 'q-learning', 'gym'],
    isFeatured:           false,
    isNew:                true,
    lessonPath:           '/tutorials/reinforcement-learning',
    publishedAt:          1_713_000_000_000,
    popularityScore:      78,
  },
  {
    id:                   'generative-ai-intro',
    title:                'Intro to Generative AI',
    description:          'GANs, VAEs, and diffusion models — understand how machines generate images, text, and audio.',
    difficulty:           'advanced',
    category:             'deep-learning',
    path:                 'dl-specialist',
    duration:             '5h 45m',
    lessonCount:          28,
    estimatedHours:       5.75,
    completionPercentage: 0,
    isBookmarked:         false,
    isFavourite:          false,
    lastOpened:           null,
    author:               'Python for AI Team',
    icon:                 '🎨',
    accent:               'var(--color-primary)',
    tags:                 ['generative-ai', 'gans', 'diffusion'],
    isFeatured:           true,
    isNew:                true,
    lessonPath:           '/tutorials/generative-ai-intro',
    publishedAt:          1_714_000_000_000,
    popularityScore:      99,
  },
]);

// ---------------------------------------------------------------------------
// CSS BEM class names
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const CSS = Object.freeze({
  ROOT:                   'tutorials-page',
  ROOT_DARK:              'tutorials-page--dark',
  ROOT_REDUCED:           'tutorials-page--reduced-motion',
  LIVE:                   'tutorials-page__live',

  // Header
  HEADER:                 'tutorials-header',
  HEADER_INNER:           'tutorials-header__inner',
  HEADER_TITLE:           'tutorials-header__title',
  HEADER_SUB:             'tutorials-header__sub',
  HEADER_COUNT:           'tutorials-header__count',

  // Controls bar
  CONTROLS:               'tutorials-controls',
  CONTROLS_INNER:         'tutorials-controls__inner',
  SEARCH_WRAP:            'tutorials-controls__search-wrap',
  SEARCH_INPUT:           'tutorials-controls__search-input',
  SEARCH_ICON:            'tutorials-controls__search-icon',
  SEARCH_CLEAR:           'tutorials-controls__search-clear',
  CONTROLS_SORT:          'tutorials-controls__sort',
  CONTROLS_SORT_SELECT:   'tutorials-controls__sort-select',

  // Filter groups
  FILTERS:                'tutorials-filters',
  FILTERS_INNER:          'tutorials-filters__inner',
  FILTER_GROUP:           'tutorials-filters__group',
  FILTER_LABEL:           'tutorials-filters__group-label',
  FILTER_CHIPS:           'tutorials-filters__chips',
  FILTER_CHIP:            'tutorials-filters__chip',
  FILTER_CHIP_ACTIVE:     'tutorials-filters__chip--active',

  // Active filters bar
  ACTIVE_FILTERS:         'tutorials-active-filters',
  ACTIVE_FILTER_TAG:      'tutorials-active-filters__tag',
  ACTIVE_FILTER_REMOVE:   'tutorials-active-filters__remove',
  ACTIVE_FILTER_CLEAR:    'tutorials-active-filters__clear-all',

  // Section scaffold
  SECTION:                'tutorials-section',
  SECTION_INNER:          'tutorials-section__inner',
  SECTION_HEADER:         'tutorials-section__header',
  SECTION_TITLE:          'tutorials-section__title',
  SECTION_LINK:           'tutorials-section__link',

  // Featured row
  FEATURED:               'tutorials-featured',
  FEATURED_SCROLLER:      'tutorials-featured__scroller',
  FEATURED_CARD:          'tutorials-featured__card',

  // Continue learning strip
  CONTINUE:               'tutorials-continue',
  CONTINUE_GRID:          'tutorials-continue__grid',
  CONTINUE_CARD:          'tutorials-continue__card',
  CONTINUE_ICON:          'tutorials-continue__icon',
  CONTINUE_BODY:          'tutorials-continue__body',
  CONTINUE_TITLE:         'tutorials-continue__title',
  CONTINUE_META:          'tutorials-continue__meta',
  CONTINUE_BAR:           'tutorials-continue__bar',
  CONTINUE_BAR_FILL:      'tutorials-continue__bar-fill',

  // Tutorial card (main grid)
  GRID:                   'tutorials-grid',
  CARD:                   'tutorials-card',
  CARD_THUMB:             'tutorials-card__thumb',
  CARD_BADGE_NEW:         'tutorials-card__badge--new',
  CARD_BADGE_DIFF:        'tutorials-card__badge-diff',
  CARD_BADGE_BEG:         'tutorials-card__badge-diff--beginner',
  CARD_BADGE_INT:         'tutorials-card__badge-diff--intermediate',
  CARD_BADGE_ADV:         'tutorials-card__badge-diff--advanced',
  CARD_ACTIONS:           'tutorials-card__actions',
  CARD_BTN_BOOKMARK:      'tutorials-card__btn-bookmark',
  CARD_BTN_BOOKMARK_ON:   'tutorials-card__btn-bookmark--active',
  CARD_BTN_FAV:           'tutorials-card__btn-fav',
  CARD_BTN_FAV_ON:        'tutorials-card__btn-fav--active',
  CARD_BODY:              'tutorials-card__body',
  CARD_TITLE:             'tutorials-card__title',
  CARD_DESC:              'tutorials-card__desc',
  CARD_META:              'tutorials-card__meta',
  CARD_META_ITEM:         'tutorials-card__meta-item',
  CARD_BAR:               'tutorials-card__bar',
  CARD_BAR_FILL:          'tutorials-card__bar-fill',
  CARD_BAR_LABEL:         'tutorials-card__bar-label',
  CARD_CTA:               'tutorials-card__cta',

  // Load more sentinel / pagination
  SENTINEL:               'tutorials-sentinel',
  LOAD_MORE:              'tutorials-load-more',

  // Sidebar sections
  RECENTLY_VIEWED:        'tutorials-recently-viewed',
  RECOMMENDED:            'tutorials-recommended',
  POPULAR:                'tutorials-popular',
  SIDEBAR_LIST:           'tutorials-sidebar__list',
  SIDEBAR_ITEM:           'tutorials-sidebar__item',
  SIDEBAR_ICON:           'tutorials-sidebar__icon',
  SIDEBAR_BODY:           'tutorials-sidebar__body',
  SIDEBAR_TITLE:          'tutorials-sidebar__title',
  SIDEBAR_META:           'tutorials-sidebar__meta',

  // States
  EMPTY:                  'tutorials-empty',
  EMPTY_ICON:             'tutorials-empty__icon',
  EMPTY_TITLE:            'tutorials-empty__title',
  EMPTY_SUB:              'tutorials-empty__sub',
  EMPTY_BTN:              'tutorials-empty__btn',
  SKELETON:               'tutorials-skeleton',
  SKELETON_CARD:          'tutorials-skeleton__card',
  ERROR_STATE:            'tutorials-error',
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
 * @param {number} ts
 * @returns {string}
 */
function relativeTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * Normalise a string for search comparison.
 * @param {string} s
 * @returns {string}
 */
function normalise(s) {
  return String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Get a summary from the tracker or return a zero-state fallback.
 * @param {object|null} tracker
 * @returns {object}
 */
function getSummary(tracker) {
  if (!tracker?.getSummary) {
    return {
      tutorials: { started: 0, completed: 0, pct: 0, records: {} },
      quizzes:   { attempted: 0, passed: 0, accuracy: 0, pct: 0, records: {} },
      projects:  { total: 0, completed: 0, pct: 0, records: {} },
    };
  }
  try { return tracker.getSummary(); } catch { return getSummary(null); }
}

/**
 * Merge tracker progress data into the catalogue (non-mutating).
 * Returns a new array of Tutorial objects with live completion and bookmark state.
 *
 * @param {ReadonlyArray<Tutorial>} catalogue
 * @param {object}                  summary
 * @returns {Tutorial[]}
 */
function hydrateCatalogue(catalogue, summary) {
  const records   = summary?.tutorials?.records ?? {};

  return catalogue.map((t) => {
    const record = records[t.id];
    if (!record) return { ...t };

    const pct = record.completedAt ? 100
      : (record.lastSection && record.totalSections
        ? Math.round((record.lastSection / record.totalSections) * 100)
        : 0);

    return {
      ...t,
      completionPercentage: pct,
      lastOpened:           record.startedAt ?? null,
      isBookmarked:         t.isBookmarked,
      isFavourite:          t.isFavourite,
    };
  });
}

// ---------------------------------------------------------------------------
// Filter state factory
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   search:     string,
 *   category:   string,
 *   difficulty: string,
 *   path:       string,
 *   sort:       string,
 *   bookmarked: boolean,
 *   inProgress: boolean,
 * }} FilterState
 */

/**
 * @returns {FilterState}
 */
function defaultFilter() {
  return {
    search:     '',
    category:   'all',
    difficulty: 'all',
    path:       'all',
    sort:       'recommended',
    bookmarked: false,
    inProgress: false,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort a Tutorial array according to the sort option.
 *
 * @param {Tutorial[]} list
 * @param {string}     sort
 * @returns {Tutorial[]}
 */
function sortTutorials(list, sort) {
  const copy = [...list];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.publishedAt - a.publishedAt);
    case 'popular':
      return copy.sort((a, b) => b.popularityScore - a.popularityScore);
    case 'duration-asc':
      return copy.sort((a, b) => a.estimatedHours - b.estimatedHours);
    case 'duration-desc':
      return copy.sort((a, b) => b.estimatedHours - a.estimatedHours);
    case 'alpha-asc':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'alpha-desc':
      return copy.sort((a, b) => b.title.localeCompare(a.title));
    case 'recommended':
    default:
      return copy.sort((a, b) => b.popularityScore - a.popularityScore);
  }
}

// ---------------------------------------------------------------------------
// TutorialsPage — primary class
// ---------------------------------------------------------------------------

/**
 * Tutorials browser page for the Python for AI platform.
 *
 * Lifecycle:
 *   1. constructor(config)  — no DOM side-effects
 *   2. initialize()         — parse URL params, hydrate catalogue
 *   3. mount()              — render + attach events
 *   4. refresh()            — re-hydrate data, update grid
 *   5. destroy()            — teardown all listeners, timers, DOM
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

  /** @type {boolean}     */ #mounted   = false;
  /** @type {boolean}     */ #destroyed = false;
  /** @type {string}      */ #theme     = 'light';

  /** @type {Tutorial[]} — hydrated catalogue (updated on progress:updated) */
  #catalogue = [];

  /** @type {Tutorial[]} — result of applying #filter to #catalogue */
  #filteredTutorials = [];

  /** @type {FilterState} */
  #filter = defaultFilter();

  /** @type {Set<string>} — bookmarked tutorial IDs (UI state, mirrored from storage) */
  #bookmarks = new Set();

  /** @type {Set<string>} — favourited tutorial IDs */
  #favourites = new Set();

  /** @type {number} — how many tutorial pages have been loaded (infinite scroll) */
  #loadedPages = 1;

  // ---- DOM references ------------------------------------------------------

  /** @type {HTMLElement|null}       */ #root       = null;
  /** @type {HTMLElement|null}       */ #liveRegion = null;
  /** @type {HTMLInputElement|null}  */ #searchInput = null;
  /** @type {IntersectionObserver|null} */ #scrollObserver = null;

  // ---- Debounced handlers --------------------------------------------------

  /** @type {Function & { cancel: () => void }} */
  #debouncedSearch;

  /** @type {Function & { cancel: () => void }} */
  #debouncedRefresh;

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

    this.#debouncedSearch  = debounce(() => this.#applyFilters(), 250);
    this.#debouncedRefresh = debounce(() => this.refresh(), 300);
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
   * Parse URL query params, resolve theme, hydrate the catalogue.
   *
   * @returns {TutorialsPage} this
   */
  initialize() {
    if (this.#mounted || this.#destroyed) return this;

    // Resolve theme
    if (this.#config.store) {
      try { this.#theme = this.#config.store.getTheme()?.resolvedMode ?? 'light'; } catch { /* ignore */ }
    }

    // Parse URL query params into the initial filter
    this.#parseUrlParams();

    // Hydrate catalogue with live progress data
    const summary    = getSummary(this.#config.tracker);
    this.#catalogue  = hydrateCatalogue(TUTORIAL_CATALOGUE, summary);

    // Apply initial filter
    this.#computeFilteredList();

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
    this.#attachScrollObserver();

    this.#mounted = true;

    // Move focus to search input for keyboard users
    requestAnimationFrame(() => {
      this.#searchInput = this.#root?.querySelector(`.${CSS.SEARCH_INPUT}`) ?? null;
      this.#root?.querySelector('h1')?.focus({ preventScroll: true });
    });

    this.#dispatch(TUTORIALS_EVENTS.MOUNTED, { pathname: '/tutorials' });
    this.#announce('Tutorials page loaded.');

    return this;
  }

  /**
   * Generate and inject the complete page HTML.
   *
   * @returns {TutorialsPage} this
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
    this.#root.setAttribute('aria-label', 'Tutorials — Python for AI');

    const summary = getSummary(this.#config.tracker);

    this.#root.innerHTML = `
      <div class="${CSS.LIVE}"
           role="status"
           aria-live="polite"
           aria-atomic="true"
           aria-relevant="text"></div>

      ${this.#renderPageHeader()}
      ${this.#renderControlsBar()}
      ${this.#renderFilterChips()}
      ${this.#renderActiveFilters()}
      ${this.#renderFeatured()}
      ${this.#renderContinueLearning(summary)}

      <div class="${CSS.SECTION} tutorials-main-layout">
        <div class="${CSS.SECTION_INNER}">
          <div id="tutorials-grid-region">
            ${this.#renderGrid()}
          </div>
        </div>
      </div>

      ${this.#renderSidebarSections(summary)}
    `;

    this.#liveRegion  = this.#root.querySelector(`.${CSS.LIVE}`);
    this.#searchInput = this.#root.querySelector(`.${CSS.SEARCH_INPUT}`);

    // Restore search input value
    if (this.#searchInput && this.#filter.search) {
      this.#searchInput.value = this.#filter.search;
    }

    return this;
  }

  /**
   * Re-hydrate data from the tracker and refresh dynamic regions.
   *
   * @returns {TutorialsPage} this
   */
  refresh() {
    if (!this.#mounted || this.#destroyed) return this;

    const summary    = getSummary(this.#config.tracker);
    this.#catalogue  = hydrateCatalogue(TUTORIAL_CATALOGUE, summary);
    this.#computeFilteredList();

    // Surgical updates
    this.#replaceRegion('tutorials-grid-region', this.#renderGrid());
    this.#replaceRegion('tutorials-continue-region', this.#renderContinueLearningInner(summary));
    this.#replaceRegion('tutorials-sidebar-region', this.#renderSidebarContent(summary));
    this.#updateHeaderCount();

    this.#dispatch(TUTORIALS_EVENTS.UPDATED, { timestamp: Date.now() });
    return this;
  }

  /**
   * Tear down listeners, disconnect observers, and clear DOM.
   *
   * @returns {TutorialsPage} this
   */
  destroy() {
    if (this.#destroyed) return this;

    this.#debouncedSearch.cancel();
    this.#debouncedRefresh.cancel();

    this.#scrollObserver?.disconnect();
    this.#scrollObserver = null;

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

  // ---- Private: rendering --------------------------------------------------

  /**
   * @returns {string}
   */
  #renderPageHeader() {
    const total    = TUTORIAL_CATALOGUE.length;
    const filtered = this.#filteredTutorials.length;
    const hasFilter = this.#hasActiveFilter();
    const countLabel = hasFilter
      ? `${filtered} of ${total} tutorials`
      : `${total} tutorials`;

    return `
      <header class="${CSS.HEADER}">
        <div class="${CSS.HEADER_INNER}">
          <div>
            <h1 class="${CSS.HEADER_TITLE}" tabindex="-1" id="tutorials-page-h1">
              Tutorials
            </h1>
            <p class="${CSS.HEADER_SUB}">
              Hands-on Python and AI courses with live code editors and instant feedback.
            </p>
          </div>
          <span class="${CSS.HEADER_COUNT}"
                id="tutorials-count-label"
                aria-live="polite"
                aria-atomic="true">
            ${escapeHtml(countLabel)}
          </span>
        </div>
      </header>
    `;
  }

  /**
   * @returns {string}
   */
  #renderControlsBar() {
    const sortOptions = SORT_OPTIONS.map((o) => `
      <option value="${escapeAttr(o.value)}"
              ${this.#filter.sort === o.value ? 'selected' : ''}>
        ${escapeHtml(o.label)}
      </option>
    `).join('');

    return `
      <div class="${CSS.CONTROLS}" role="search" aria-label="Tutorial search and filters">
        <div class="${CSS.CONTROLS_INNER}">
          <div class="${CSS.SEARCH_WRAP}">
            <span class="${CSS.SEARCH_ICON}" aria-hidden="true">🔍</span>
            <input class="${CSS.SEARCH_INPUT}"
                   id="tutorials-search"
                   type="search"
                   name="search"
                   placeholder="Search tutorials, topics, or tags…"
                   autocomplete="off"
                   autocorrect="off"
                   autocapitalize="off"
                   spellcheck="false"
                   aria-label="Search tutorials"
                   aria-controls="tutorials-grid-region"
                   value="${escapeAttr(this.#filter.search)}">
            ${this.#filter.search ? `
              <button class="${CSS.SEARCH_CLEAR}"
                      type="button"
                      data-action="clear-search"
                      aria-label="Clear search">✕</button>
            ` : ''}
          </div>
          <div class="${CSS.CONTROLS_SORT}">
            <label for="tutorials-sort" class="sr-only">Sort tutorials by</label>
            <select class="${CSS.CONTROLS_SORT_SELECT}"
                    id="tutorials-sort"
                    aria-label="Sort tutorials"
                    data-action="sort">
              ${sortOptions}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFilterChips() {
    const catChips = CATEGORIES.map((cat) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.category === cat.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="filter-category"
              data-value="${escapeAttr(cat.value)}"
              aria-pressed="${this.#filter.category === cat.value}"
              aria-label="Filter by ${escapeAttr(cat.label)}">
        ${escapeHtml(cat.label)}
      </button>
    `).join('');

    const diffChips = [{ value: 'all', label: 'All Levels' }, ...DIFFICULTIES.map((d) => ({
      value: d,
      label: d.charAt(0).toUpperCase() + d.slice(1),
    }))].map((d) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.difficulty === d.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="filter-difficulty"
              data-value="${escapeAttr(d.value)}"
              aria-pressed="${this.#filter.difficulty === d.value}"
              aria-label="Difficulty: ${escapeAttr(d.label)}">
        ${escapeHtml(d.label)}
      </button>
    `).join('');

    const pathChips = LEARNING_PATHS.map((p) => `
      <button class="${CSS.FILTER_CHIP} ${this.#filter.path === p.value ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="filter-path"
              data-value="${escapeAttr(p.value)}"
              aria-pressed="${this.#filter.path === p.value}"
              aria-label="Learning path: ${escapeAttr(p.label)}">
        ${escapeHtml(p.label)}
      </button>
    `).join('');

    const toggleChips = [
      {
        action:  'filter-bookmarked',
        label:   '🔖 Bookmarked',
        active:  this.#filter.bookmarked,
      },
      {
        action:  'filter-in-progress',
        label:   '▶ In Progress',
        active:  this.#filter.inProgress,
      },
    ].map((t) => `
      <button class="${CSS.FILTER_CHIP} ${t.active ? CSS.FILTER_CHIP_ACTIVE : ''}"
              type="button"
              data-action="${escapeAttr(t.action)}"
              aria-pressed="${t.active}"
              aria-label="${escapeAttr(t.label)}">
        ${escapeHtml(t.label)}
      </button>
    `).join('');

    return `
      <div class="${CSS.FILTERS}" aria-label="Tutorial filters">
        <div class="${CSS.FILTERS_INNER}">
          <div class="${CSS.FILTER_GROUP}">
            <span class="${CSS.FILTER_LABEL}" id="cat-filter-label">Category</span>
            <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="cat-filter-label">
              ${catChips}
            </div>
          </div>
          <div class="${CSS.FILTER_GROUP}">
            <span class="${CSS.FILTER_LABEL}" id="diff-filter-label">Difficulty</span>
            <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="diff-filter-label">
              ${diffChips}
            </div>
          </div>
          <div class="${CSS.FILTER_GROUP}">
            <span class="${CSS.FILTER_LABEL}" id="path-filter-label">Learning Path</span>
            <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="path-filter-label">
              ${pathChips}
            </div>
          </div>
          <div class="${CSS.FILTER_GROUP}">
            <span class="${CSS.FILTER_LABEL}" id="toggle-filter-label">Show</span>
            <div class="${CSS.FILTER_CHIPS}" role="group" aria-labelledby="toggle-filter-label">
              ${toggleChips}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderActiveFilters() {
    const tags = [];

    if (this.#filter.search)                  tags.push({ label: `"${this.#filter.search}"`,   action: 'remove-search'     });
    if (this.#filter.category !== 'all')      tags.push({ label: this.#filter.category,         action: 'remove-category'   });
    if (this.#filter.difficulty !== 'all')    tags.push({ label: this.#filter.difficulty,        action: 'remove-difficulty' });
    if (this.#filter.path !== 'all')          tags.push({ label: this.#filter.path,              action: 'remove-path'       });
    if (this.#filter.bookmarked)              tags.push({ label: 'Bookmarked',                   action: 'remove-bookmarked' });
    if (this.#filter.inProgress)             tags.push({ label: 'In Progress',                  action: 'remove-in-progress'});

    if (tags.length === 0) return '';

    const tagHtml = tags.map((t) => `
      <span class="${CSS.ACTIVE_FILTER_TAG}">
        ${escapeHtml(t.label)}
        <button class="${CSS.ACTIVE_FILTER_REMOVE}"
                type="button"
                data-action="${escapeAttr(t.action)}"
                aria-label="Remove filter: ${escapeAttr(t.label)}">✕</button>
      </span>
    `).join('');

    return `
      <div class="${CSS.ACTIVE_FILTERS}"
           aria-label="Active filters"
           aria-live="polite">
        ${tagHtml}
        <button class="${CSS.ACTIVE_FILTER_CLEAR}"
                type="button"
                data-action="clear-all-filters"
                aria-label="Clear all filters">
          Clear all
        </button>
      </div>
    `;
  }

  /**
   * @returns {string}
   */
  #renderFeatured() {
    const featured = this.#catalogue.filter((t) => t.isFeatured);
    if (featured.length === 0) return '';

    const cards = featured.map((t) => `
      <article class="${CSS.FEATURED_CARD}"
               aria-labelledby="feat-${escapeAttr(t.id)}">
        <div class="${CSS.CARD_THUMB}"
             style="background:${t.accent}20;color:${t.accent}"
             aria-hidden="true">
          <span style="font-size:2rem">${escapeHtml(t.icon)}</span>
        </div>
        <h3 class="${CSS.CARD_TITLE}" id="feat-${escapeAttr(t.id)}">
          ${escapeHtml(t.title)}
        </h3>
        <p class="${CSS.CARD_META_ITEM}">${escapeHtml(t.duration)} · ${t.lessonCount} lessons</p>
        <button class="${CSS.CARD_CTA}"
                type="button"
                data-action="open-tutorial"
                data-id="${escapeAttr(t.id)}"
                data-path="${escapeAttr(t.lessonPath)}"
                aria-label="${t.completionPercentage > 0 ? 'Continue' : 'Start'}: ${escapeAttr(t.title)}"
                style="--cta-accent:${t.accent}">
          ${t.completionPercentage > 0 ? 'Continue' : 'Start'}
        </button>
      </article>
    `).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.FEATURED}"
               aria-labelledby="featured-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="featured-heading">Featured</h2>
          </div>
          <div class="${CSS.FEATURED_SCROLLER}"
               role="list"
               aria-label="Featured tutorials">
            ${cards}
          </div>
        </div>
      </section>
    `;
  }

  /**
   * @param {object} summary
   * @returns {string}
   */
  #renderContinueLearning(summary) {
    return `
      <section class="${CSS.SECTION} ${CSS.CONTINUE}"
               id="tutorials-continue-region"
               aria-labelledby="continue-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="continue-heading">Continue Learning</h2>
          </div>
          ${this.#renderContinueLearningInner(summary)}
        </div>
      </section>
    `;
  }

  /**
   * @param {object} summary
   * @returns {string}
   */
  #renderContinueLearningInner(summary) {
    const records = summary?.tutorials?.records ?? {};
    const inProgress = this.#catalogue
      .filter((t) => {
        const r = records[t.id];
        return r?.startedAt && !r?.completedAt;
      })
      .sort((a, b) => (records[b.id]?.startedAt ?? 0) - (records[a.id]?.startedAt ?? 0))
      .slice(0, 4);

    if (inProgress.length === 0) {
      return `
        <p style="color:var(--color-text-secondary)">
          Start a tutorial to track your progress here.
        </p>
      `;
    }

    const cards = inProgress.map((t) => {
      const pct = t.completionPercentage;
      return `
        <button class="${CSS.CONTINUE_CARD}"
                type="button"
                data-action="open-tutorial"
                data-id="${escapeAttr(t.id)}"
                data-path="${escapeAttr(t.lessonPath)}"
                aria-label="Continue ${escapeAttr(t.title)}, ${pct}% complete">
          <span class="${CSS.CONTINUE_ICON}"
                aria-hidden="true"
                style="color:${t.accent}">${escapeHtml(t.icon)}</span>
          <span class="${CSS.CONTINUE_BODY}">
            <span class="${CSS.CONTINUE_TITLE}">${escapeHtml(t.title)}</span>
            <span class="${CSS.CONTINUE_META}">
              ${pct}% · ${relativeTime(t.lastOpened)}
            </span>
            <span class="${CSS.CONTINUE_BAR}"
                  role="progressbar"
                  aria-valuenow="${pct}"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label="${pct}% complete">
              <span class="${CSS.CONTINUE_BAR_FILL}"
                    style="width:${pct}%;background:${t.accent}"></span>
            </span>
          </span>
        </button>
      `;
    }).join('');

    return `<div class="${CSS.CONTINUE_GRID}">${cards}</div>`;
  }

  /**
   * Render the full tutorial grid for the current filtered/sorted list.
   *
   * @returns {string}
   */
  #renderGrid() {
    if (this.#filteredTutorials.length === 0) {
      return this.#renderEmptyState();
    }

    const visible = this.#filteredTutorials.slice(0, this.#loadedPages * PAGE_SIZE);

    const cards = visible.map((t) => this.#renderCard(t)).join('');

    const hasMore = visible.length < this.#filteredTutorials.length;

    return `
      <div class="${CSS.GRID}"
           id="tutorials-grid"
           role="list"
           aria-label="${this.#filteredTutorials.length} tutorials">
        ${cards}
      </div>
      ${hasMore ? `
        <div class="${CSS.SENTINEL}"
             id="tutorials-sentinel"
             aria-hidden="true"
             style="height:4px"></div>
        <button class="${CSS.LOAD_MORE}"
                type="button"
                data-action="load-more"
                aria-label="Load more tutorials">
          Load more tutorials
        </button>
      ` : ''}
    `;
  }

  /**
   * Render a single tutorial card.
   *
   * @param {Tutorial} t
   * @returns {string}
   */
  #renderCard(t) {
    const diffLabel = t.difficulty.charAt(0).toUpperCase() + t.difficulty.slice(1);
    const diffClass = {
      beginner:     CSS.CARD_BADGE_BEG,
      intermediate: CSS.CARD_BADGE_INT,
      advanced:     CSS.CARD_BADGE_ADV,
    }[t.difficulty] ?? '';

    const pct           = t.completionPercentage;
    const isBookmarked  = this.#bookmarks.has(t.id) || t.isBookmarked;
    const isFavourite   = this.#favourites.has(t.id) || t.isFavourite;
    const ctaLabel      = pct === 100 ? 'Review' : pct > 0 ? 'Continue' : 'Start';

    return `
      <article class="${CSS.CARD}"
               role="listitem"
               data-id="${escapeAttr(t.id)}"
               aria-labelledby="card-title-${escapeAttr(t.id)}">

        <!-- Thumbnail -->
        <div class="${CSS.CARD_THUMB}"
             style="background:${t.accent}18;color:${t.accent}"
             aria-hidden="true">
          <span style="font-size:2.25rem">${escapeHtml(t.icon)}</span>
          ${t.isNew ? `<span class="${CSS.CARD_BADGE_NEW}" aria-label="New tutorial">New</span>` : ''}
        </div>

        <!-- Quick actions -->
        <div class="${CSS.CARD_ACTIONS}">
          <button class="${CSS.CARD_BTN_BOOKMARK} ${isBookmarked ? CSS.CARD_BTN_BOOKMARK_ON : ''}"
                  type="button"
                  data-action="toggle-bookmark"
                  data-id="${escapeAttr(t.id)}"
                  aria-pressed="${isBookmarked}"
                  aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark'} ${escapeAttr(t.title)}">
            🔖
          </button>
          <button class="${CSS.CARD_BTN_FAV} ${isFavourite ? CSS.CARD_BTN_FAV_ON : ''}"
                  type="button"
                  data-action="toggle-favourite"
                  data-id="${escapeAttr(t.id)}"
                  aria-pressed="${isFavourite}"
                  aria-label="${isFavourite ? 'Remove from favourites' : 'Add to favourites'}: ${escapeAttr(t.title)}">
            ❤️
          </button>
        </div>

        <!-- Body -->
        <div class="${CSS.CARD_BODY}">
          <span class="${CSS.CARD_BADGE_DIFF} ${diffClass}">${escapeHtml(diffLabel)}</span>
          <h3 class="${CSS.CARD_TITLE}" id="card-title-${escapeAttr(t.id)}">
            ${escapeHtml(t.title)}
          </h3>
          <p class="${CSS.CARD_DESC}">${escapeHtml(t.description)}</p>

          <div class="${CSS.CARD_META}">
            <span class="${CSS.CARD_META_ITEM}" aria-label="${escapeAttr(t.duration)} duration">
              🕐 ${escapeHtml(t.duration)}
            </span>
            <span class="${CSS.CARD_META_ITEM}" aria-label="${t.lessonCount} lessons">
              📝 ${t.lessonCount} lessons
            </span>
          </div>

          ${pct > 0 ? `
            <div class="${CSS.CARD_BAR}"
                 role="progressbar"
                 aria-valuenow="${pct}"
                 aria-valuemin="0"
                 aria-valuemax="100"
                 aria-label="${pct}% complete">
              <div class="${CSS.CARD_BAR_FILL}"
                   style="width:${pct}%;background:${t.accent}"></div>
            </div>
            <span class="${CSS.CARD_BAR_LABEL}">${pct}% complete</span>
          ` : ''}

          <button class="${CSS.CARD_CTA}"
                  type="button"
                  data-action="open-tutorial"
                  data-id="${escapeAttr(t.id)}"
                  data-path="${escapeAttr(t.lessonPath)}"
                  aria-label="${escapeAttr(ctaLabel)}: ${escapeAttr(t.title)}"
                  style="--cta-accent:${t.accent}">
            ${ctaLabel} Tutorial
          </button>
        </div>
      </article>
    `;
  }

  /**
   * @returns {string}
   */
  #renderEmptyState() {
    const hasFilter = this.#hasActiveFilter();
    return `
      <div class="${CSS.EMPTY}" role="status" aria-live="polite">
        <span class="${CSS.EMPTY_ICON}" aria-hidden="true">🔍</span>
        <h3 class="${CSS.EMPTY_TITLE}">
          ${hasFilter ? 'No tutorials found' : 'No tutorials yet'}
        </h3>
        <p class="${CSS.EMPTY_SUB}">
          ${hasFilter
            ? 'Try adjusting your search terms or removing some filters.'
            : 'Check back soon — new tutorials are added every week.'}
        </p>
        ${hasFilter ? `
          <button class="${CSS.EMPTY_BTN}"
                  type="button"
                  data-action="clear-all-filters"
                  aria-label="Clear all filters and show all tutorials">
            Clear filters
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render sidebar sections (recently viewed, recommended, popular).
   *
   * @param {object} summary
   * @returns {string}
   */
  #renderSidebarSections(summary) {
    return `
      <div id="tutorials-sidebar-region">
        ${this.#renderSidebarContent(summary)}
      </div>
    `;
  }

  /**
   * @param {object} summary
   * @returns {string}
   */
  #renderSidebarContent(summary) {
    return `
      ${this.#renderRecentlyViewed(summary)}
      ${this.#renderRecommended(summary)}
      ${this.#renderPopular()}
    `;
  }

  /**
   * @param {object} summary
   * @returns {string}
   */
  #renderRecentlyViewed(summary) {
    const records = summary?.tutorials?.records ?? {};
    const recent  = this.#catalogue
      .filter((t) => records[t.id]?.startedAt)
      .sort((a, b) => (records[b.id]?.startedAt ?? 0) - (records[a.id]?.startedAt ?? 0))
      .slice(0, 5);

    if (recent.length === 0) return '';

    const items = recent.map((t) => this.#renderSidebarItem(t, relativeTime(t.lastOpened))).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.RECENTLY_VIEWED}"
               aria-labelledby="recently-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="recently-heading">Recently Viewed</h2>
          </div>
          <ul class="${CSS.SIDEBAR_LIST}" role="list" aria-label="Recently viewed tutorials">
            ${items}
          </ul>
        </div>
      </section>
    `;
  }

  /**
   * @param {object} summary
   * @returns {string}
   */
  #renderRecommended(summary) {
    const records   = summary?.tutorials?.records ?? {};
    const completed = new Set(
      Object.entries(records)
        .filter(([, r]) => r.completedAt)
        .map(([id]) => id)
    );

    // Recommend tutorials in the same category as the most-recently-completed
    const lastCompleted = this.#catalogue
      .filter((t) => completed.has(t.id))
      .sort((a, b) => (records[b.id]?.completedAt ?? 0) - (records[a.id]?.completedAt ?? 0))[0];

    const recommended = this.#catalogue
      .filter((t) =>
        !completed.has(t.id) &&
        (!lastCompleted || t.category === lastCompleted.category)
      )
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, 5);

    if (recommended.length === 0) return '';

    const items = recommended.map((t) => this.#renderSidebarItem(t, `${t.lessonCount} lessons`)).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.RECOMMENDED}"
               aria-labelledby="recommended-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="recommended-heading">Recommended</h2>
          </div>
          <ul class="${CSS.SIDEBAR_LIST}" role="list" aria-label="Recommended tutorials">
            ${items}
          </ul>
        </div>
      </section>
    `;
  }

  /**
   * @returns {string}
   */
  #renderPopular() {
    const popular = [...this.#catalogue]
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, 5);

    const items = popular.map((t) => this.#renderSidebarItem(t, `${t.duration}`)).join('');

    return `
      <section class="${CSS.SECTION} ${CSS.POPULAR}"
               aria-labelledby="popular-heading">
        <div class="${CSS.SECTION_INNER}">
          <div class="${CSS.SECTION_HEADER}">
            <h2 class="${CSS.SECTION_TITLE}" id="popular-heading">Popular</h2>
          </div>
          <ul class="${CSS.SIDEBAR_LIST}" role="list" aria-label="Popular tutorials">
            ${items}
          </ul>
        </div>
      </section>
    `;
  }

  /**
   * @param {Tutorial} t
   * @param {string}   metaText
   * @returns {string}
   */
  #renderSidebarItem(t, metaText) {
    return `
      <li class="${CSS.SIDEBAR_ITEM}" role="listitem">
        <button type="button"
                data-action="open-tutorial"
                data-id="${escapeAttr(t.id)}"
                data-path="${escapeAttr(t.lessonPath)}"
                aria-label="Open ${escapeAttr(t.title)}">
          <span class="${CSS.SIDEBAR_ICON}" aria-hidden="true"
                style="color:${t.accent}">${escapeHtml(t.icon)}</span>
          <span class="${CSS.SIDEBAR_BODY}">
            <span class="${CSS.SIDEBAR_TITLE}">${escapeHtml(t.title)}</span>
            <span class="${CSS.SIDEBAR_META}">${escapeHtml(metaText)}</span>
          </span>
        </button>
      </li>
    `;
  }

  // ---- Private: filtering logic -------------------------------------------

  /**
   * Run the full filter + sort pipeline, update #filteredTutorials,
   * then patch the DOM grid in place.
   */
  #applyFilters() {
    this.#loadedPages = 1;
    this.#computeFilteredList();
    this.#syncUrlParams();
    this.#replaceRegion('tutorials-grid-region', this.#renderGrid());
    this.#updateHeaderCount();
    this.#refreshFilterChips();
    this.#refreshActiveFilters();

    const count = this.#filteredTutorials.length;
    const msg   = count === 0
      ? 'No tutorials found.'
      : `${count} tutorial${count === 1 ? '' : 's'} found.`;
    this.#announce(msg);
  }

  /**
   * Compute and cache #filteredTutorials from #catalogue + #filter.
   */
  #computeFilteredList() {
    const f = this.#filter;
    const q = normalise(f.search);

    let result = this.#catalogue.filter((t) => {
      if (f.category   !== 'all' && t.category   !== f.category)   return false;
      if (f.difficulty !== 'all' && t.difficulty !== f.difficulty) return false;
      if (f.path       !== 'all' && t.path       !== f.path)       return false;
      if (f.bookmarked && !this.#bookmarks.has(t.id) && !t.isBookmarked) return false;
      if (f.inProgress && t.completionPercentage <= 0)             return false;

      if (q) {
        const haystack = [t.title, t.description, t.category, ...t.tags].map(normalise).join(' ');
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    this.#filteredTutorials = sortTutorials(result, f.sort);
  }

  /**
   * @returns {boolean}
   */
  #hasActiveFilter() {
    const f = this.#filter;
    return (
      f.search !== '' ||
      f.category !== 'all' ||
      f.difficulty !== 'all' ||
      f.path !== 'all' ||
      f.bookmarked ||
      f.inProgress
    );
  }

  // ---- Private: URL sync --------------------------------------------------

  /**
   * Parse URL query parameters and apply them to #filter.
   */
  #parseUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('q'))          this.#filter.search     = params.get('q');
      if (params.get('category'))   this.#filter.category   = params.get('category');
      if (params.get('difficulty')) this.#filter.difficulty = params.get('difficulty');
      if (params.get('path'))       this.#filter.path       = params.get('path');
      if (params.get('sort'))       this.#filter.sort       = params.get('sort');
      if (params.get('bookmarked')) this.#filter.bookmarked = params.get('bookmarked') === 'true';
      if (params.get('inProgress')) this.#filter.inProgress = params.get('inProgress') === 'true';
    } catch { /* ignore */ }
  }

  /**
   * Write the current filter state to the browser URL query string
   * without triggering a navigation event.
   */
  #syncUrlParams() {
    try {
      const f      = this.#filter;
      const params = new URLSearchParams();
      if (f.search)             params.set('q',          f.search);
      if (f.category !== 'all') params.set('category',   f.category);
      if (f.difficulty !== 'all') params.set('difficulty', f.difficulty);
      if (f.path !== 'all')     params.set('path',       f.path);
      if (f.sort !== 'recommended') params.set('sort',   f.sort);
      if (f.bookmarked)         params.set('bookmarked', 'true');
      if (f.inProgress)         params.set('inProgress', 'true');

      const qs    = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
    } catch { /* ignore */ }
  }

  // ---- Private: surgical DOM patches -------------------------------------

  /**
   * Replace the innerHTML of the element with the given id.
   *
   * @param {string} id
   * @param {string} html
   */
  #replaceRegion(id, html) {
    const el = this.#root?.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  /**
   * Update the count label in the page header without re-rendering the header.
   */
  #updateHeaderCount() {
    const el = this.#root?.querySelector('#tutorials-count-label');
    if (!el) return;
    const total    = TUTORIAL_CATALOGUE.length;
    const filtered = this.#filteredTutorials.length;
    el.textContent = this.#hasActiveFilter()
      ? `${filtered} of ${total} tutorials`
      : `${total} tutorials`;
  }

  /**
   * Re-render all filter chip rows without touching the search input.
   */
  #refreshFilterChips() {
    const filtersEl = this.#root?.querySelector(`.${CSS.FILTERS}`);
    if (!filtersEl) return;
    const tmp        = document.createElement('div');
    tmp.innerHTML    = this.#renderFilterChips();
    filtersEl.replaceWith(tmp.firstElementChild);
  }

  /**
   * Re-render the active-filters bar.
   */
  #refreshActiveFilters() {
    const existing = this.#root?.querySelector(`.${CSS.ACTIVE_FILTERS}`);
    const html     = this.#renderActiveFilters();

    if (existing) {
      if (!html) {
        existing.remove();
      } else {
        const tmp     = document.createElement('div');
        tmp.innerHTML = html;
        existing.replaceWith(tmp.firstElementChild);
      }
    } else if (html) {
      const controls = this.#root?.querySelector(`.${CSS.FILTERS}`);
      if (controls) {
        controls.insertAdjacentHTML('afterend', html);
      }
    }
  }

  // ---- Private: infinite scroll ------------------------------------------

  /**
   * Attach an IntersectionObserver to the sentinel element at the bottom
   * of the grid to trigger loading the next page of results.
   */
  #attachScrollObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    this.#scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#loadMoreTutorials();
          }
        }
      },
      { rootMargin: '200px' }
    );

    const attachSentinel = () => {
      const sentinel = this.#root?.querySelector(`#tutorials-sentinel`);
      if (sentinel) this.#scrollObserver?.observe(sentinel);
    };

    attachSentinel();

    // Re-attach when the grid is re-rendered
    const observer = new MutationObserver(attachSentinel);
    const grid     = this.#root?.querySelector(`#tutorials-grid-region`);
    if (grid) {
      observer.observe(grid, { childList: true });
      this.#cleanupFns.push(() => observer.disconnect());
    }
  }

  /**
   * Load the next page of tutorial cards.
   */
  #loadMoreTutorials() {
    const maxPages = Math.ceil(this.#filteredTutorials.length / PAGE_SIZE);
    if (this.#loadedPages >= maxPages) return;

    this.#loadedPages++;
    this.#replaceRegion('tutorials-grid-region', this.#renderGrid());
  }

  // ---- Private: event listeners -------------------------------------------

  /**
   * Attach all external event subscriptions and DOM event delegation.
   */
  #attachEventListeners() {
    // ── Search input ──────────────────────────────────────────────────────
    const onSearchInput = (e) => {
      if (!e.target.classList.contains(CSS.SEARCH_INPUT)) return;
      this.#filter.search = e.target.value;
      this.#debouncedSearch();
    };
    this.#root?.addEventListener('input', onSearchInput);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('input', onSearchInput));

    // ── Sort select ───────────────────────────────────────────────────────
    const onSortChange = (e) => {
      if (!e.target.classList.contains(CSS.CONTROLS_SORT_SELECT)) return;
      this.#filter.sort = e.target.value;
      this.#applyFilters();
    };
    this.#root?.addEventListener('change', onSortChange);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('change', onSortChange));

    // ── Click delegation ──────────────────────────────────────────────────
    const onClick = (e) => this.#handleClick(e);
    this.#root?.addEventListener('click', onClick);
    this.#cleanupFns.push(() => this.#root?.removeEventListener('click', onClick));

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    const onKeydown = (e) => {
      // Ctrl/Cmd + K → focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.#searchInput?.focus();
      }
      // Escape → clear search if input is focused
      if (e.key === 'Escape' && document.activeElement === this.#searchInput) {
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
      }
    };
    document.addEventListener('keydown', onKeydown);
    this.#cleanupFns.push(() => document.removeEventListener('keydown', onKeydown));

    // ── External events ───────────────────────────────────────────────────
    const onProgressUpdated = () => this.#debouncedRefresh();
    document.addEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated);
    this.#cleanupFns.push(() =>
      document.removeEventListener(PROGRESS_EVENTS.UPDATED, onProgressUpdated)
    );

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

    const onRouterNavigate = (e) => {
      if (e.detail?.pathname === '/tutorials') {
        this.#parseUrlParams();
        this.#applyFilters();
      }
    };
    document.addEventListener('router:afterNavigate', onRouterNavigate);
    this.#cleanupFns.push(() =>
      document.removeEventListener('router:afterNavigate', onRouterNavigate)
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
    const id     = actionEl.dataset.id ?? '';
    const path   = actionEl.dataset.path ?? '';
    const value  = actionEl.dataset.value ?? '';

    switch (action) {
      // Tutorial open
      case 'open-tutorial': {
        const tutorial = this.#catalogue.find((t) => t.id === id);
        this.#navigate(path || `/tutorials/${encodeURIComponent(id)}`);
        this.#dispatch(TUTORIALS_EVENTS.OPENED, {
          id,
          title: tutorial?.title ?? id,
        });
        break;
      }

      // Bookmarking
      case 'toggle-bookmark': {
        const wasBookmarked = this.#bookmarks.has(id) ||
          this.#catalogue.find((t) => t.id === id)?.isBookmarked;
        if (wasBookmarked) {
          this.#bookmarks.delete(id);
        } else {
          this.#bookmarks.add(id);
        }
        const nowBookmarked = !wasBookmarked;
        this.#updateCardActionButton(id, 'bookmark', nowBookmarked);
        this.#dispatch(TUTORIALS_EVENTS.BOOKMARKED, { id, bookmarked: nowBookmarked });
        this.#announce(nowBookmarked ? 'Tutorial bookmarked.' : 'Bookmark removed.');
        break;
      }

      // Favouriting
      case 'toggle-favourite': {
        const wasFav = this.#favourites.has(id) ||
          this.#catalogue.find((t) => t.id === id)?.isFavourite;
        if (wasFav) {
          this.#favourites.delete(id);
        } else {
          this.#favourites.add(id);
        }
        const nowFav = !wasFav;
        this.#updateCardActionButton(id, 'favourite', nowFav);
        this.#dispatch(TUTORIALS_EVENTS.FAVOURITED, { id, favourited: nowFav });
        this.#announce(nowFav ? 'Added to favourites.' : 'Removed from favourites.');
        break;
      }

      // Category filter
      case 'filter-category':
        this.#filter.category = value;
        this.#applyFilters();
        break;

      // Difficulty filter
      case 'filter-difficulty':
        this.#filter.difficulty = value;
        this.#applyFilters();
        break;

      // Learning path filter
      case 'filter-path':
        this.#filter.path = value;
        this.#applyFilters();
        break;

      // Toggle bookmarked filter
      case 'filter-bookmarked':
        this.#filter.bookmarked = !this.#filter.bookmarked;
        this.#applyFilters();
        break;

      // Toggle in-progress filter
      case 'filter-in-progress':
        this.#filter.inProgress = !this.#filter.inProgress;
        this.#applyFilters();
        break;

      // Clear individual filters
      case 'clear-search':
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        this.#searchInput?.focus();
        break;

      case 'remove-search':
        this.#filter.search = '';
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        this.#searchInput?.focus();
        break;

      case 'remove-category':
        this.#filter.category = 'all';
        this.#applyFilters();
        break;

      case 'remove-difficulty':
        this.#filter.difficulty = 'all';
        this.#applyFilters();
        break;

      case 'remove-path':
        this.#filter.path = 'all';
        this.#applyFilters();
        break;

      case 'remove-bookmarked':
        this.#filter.bookmarked = false;
        this.#applyFilters();
        break;

      case 'remove-in-progress':
        this.#filter.inProgress = false;
        this.#applyFilters();
        break;

      // Clear all filters
      case 'clear-all-filters':
        this.#filter = defaultFilter();
        if (this.#searchInput) this.#searchInput.value = '';
        this.#applyFilters();
        this.#searchInput?.focus();
        break;

      // Load more (manual fallback for users without JS IntersectionObserver)
      case 'load-more':
        this.#loadMoreTutorials();
        break;

      default:
        this.#dispatch('tutorials:action', { action, id, value });
        break;
    }
  }

  /**
   * Update the pressed state of a bookmark or favourite button without
   * re-rendering the whole card.
   *
   * @param {string}  id
   * @param {'bookmark'|'favourite'} type
   * @param {boolean} active
   */
  #updateCardActionButton(id, type, active) {
    const card  = this.#root?.querySelector(`[data-id="${CSS.escape ? CSS.escape(id) : id}"].${CSS.CARD}`);
    if (!card) return;

    const btnAction = type === 'bookmark' ? 'toggle-bookmark' : 'toggle-favourite';
    const btn = card.querySelector(`[data-action="${btnAction}"]`);
    if (!btn) return;

    const activeClass = type === 'bookmark' ? CSS.CARD_BTN_BOOKMARK_ON : CSS.CARD_BTN_FAV_ON;
    btn.classList.toggle(activeClass, active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute(
      'aria-label',
      `${active
        ? (type === 'bookmark' ? 'Remove bookmark' : 'Remove from favourites')
        : (type === 'bookmark' ? 'Bookmark' : 'Add to favourites')}: ${id}`
    );
  }

  // ---- Private: navigation helper -----------------------------------------

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