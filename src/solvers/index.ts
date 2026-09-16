/**
 * Kernel solver collection: all math/* kernels are registered via register.
 * The per-domain files were migrated from the legacy tool modules; once aggregated, the host registers them into the engine registry.
 */
import type { SolverDef } from '../engine/registry.ts'
import { expressionSolvers } from './expression.ts'
import { circuitSolvers } from './circuit.ts'
import { smithSolvers } from './smith.ts'
import { dftSolvers } from './dft.ts'
import { polynomialSolvers } from './polynomial.ts'
import { transferSolvers } from './transfer.ts'
import { noiseSolvers } from './noise.ts'
import { transmissionSolvers } from './transmission.ts'
import { electronicsSolvers } from './electronics.ts'
import { filterSolvers } from './filter.ts'
import { seriesSolvers } from './series.ts'
import { signalQualitySolvers } from './signal-quality.ts'

export function registerKernelSolvers(): SolverDef[] {
  return [
    ...expressionSolvers,
    ...circuitSolvers,
    ...smithSolvers,
    ...dftSolvers,
    ...polynomialSolvers,
    ...transferSolvers,
    ...noiseSolvers,
    ...transmissionSolvers,
    ...electronicsSolvers,
    ...filterSolvers,
    ...seriesSolvers,
    ...signalQualitySolvers,
  ]
}
