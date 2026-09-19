import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.next-node/**',
    '.vinext/**',
    '.vite/**',
    '.wrangler/**',
    'archive/**',
    'dist/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'data/**',
  ]),
]);

export default eslintConfig;
