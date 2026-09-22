/**
 * tsdown build for dsh-reckoner: the host-half lib (lib/index.js, ESM node).
 *
 * Types ship from lib/types (tsc -p tsconfig.build.json), not from tsdown.
 */
import type { UserConfig } from 'tsdown'

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    // clean stays off: the build script removes lib/ wholesale before tsc, so
    // a tsdown clean here would wipe the lib/types declarations tsc just emitted.
    clean: false,
  },
] satisfies UserConfig[]
