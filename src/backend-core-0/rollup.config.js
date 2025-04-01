import { defineConfig } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default defineConfig([
  // ESM build
  {
    input: 'src/exports.js',
    output: {
      dir: 'dist/esm',
      format: 'es',
      preserveModules: true
    },
    plugins: [nodeResolve()]
  },
  // CJS build
  {
    input: 'src/exports.js',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      preserveModules: true,
      entryFileNames: '[name].cjs',
    },
    plugins: [nodeResolve(), commonjs()]
  }
]);
