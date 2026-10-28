import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // TypeScript already reports undefined identifiers (and knows DOM/worker globals).
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'svelte/no-at-html-tags': 'error',
    },
  },
  {
    // Procedural generation (P8): deterministic code only (D1). To lift the trigonometry
    // restriction for the texture renderer, add `ignores: ['src/procgen/textures/**']` here.
    files: ['src/procgen/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          'random',
          'sin',
          'cos',
          'tan',
          'asin',
          'acos',
          'atan',
          'atan2',
          'exp',
          'log',
          'log2',
          'log10',
          'pow',
          'hypot',
          'cbrt',
          'expm1',
          'log1p',
          'sinh',
          'cosh',
          'tanh',
        ].map((property) => ({
          object: 'Math',
          property,
          message: 'Non-deterministic or non-portable maths are forbidden in procgen (D1).',
        })),
        { object: 'Date', property: 'now', message: 'Clock access is forbidden in procgen (D1).' },
        {
          object: 'performance',
          property: 'now',
          message: 'Clock access is forbidden in procgen (D1).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Clock access is forbidden in procgen (D1).' },
        { name: 'performance', message: 'Clock access is forbidden in procgen (D1).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message: 'Use multiplication instead of ** (D1).',
        },
        {
          selector: "MemberExpression[property.name='getRandomValues']",
          message: 'Randomness comes from the seeded Rng (D1).',
        },
      ],
    },
  },
  {
    // Node tooling files.
    files: ['*.config.js', '*.config.ts', 'build/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
