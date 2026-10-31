import { defineConfig } from 'tsup';

export default defineConfig({
  // constants and contracts are separate subpaths ("@tilik/shared/constants", "@tilik/shared/contracts"),
  // intentionally kept off the root barrel.
  entry: ['src/index.ts', 'src/constants.ts', 'src/contracts.ts'],
  format: ['esm', 'cjs'], // → dist/<entry>.js (+.d.ts) and dist/<entry>.cjs (+.d.cts)
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: false,
});
