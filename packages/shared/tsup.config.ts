import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/constants.ts'], // constants is a separate "@tilik/shared/constants" subpath
  format: ['esm', 'cjs'], // → dist/<entry>.js (+.d.ts) and dist/<entry>.cjs (+.d.cts)
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: false,
});
