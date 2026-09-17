/**
 * Transmission-line solvers (migrated from tools/transmission-tools.ts):
 * wavelength, coaxial-line characterization, and rise-time/bandwidth
 * conversion. Kinds mirror the old tool declarations.
 */
import {
  calcBandwidthFromRiseTime,
  calcCoaxialParameters,
  calcRiseTimeFromBandwidth,
  calcWavelength,
} from '../math/transmission.ts'
import { toScalar, type ValuePayload } from '../math/convert.ts'
import { QuantityKind } from '../math/quantity-kind.ts'
import type { SolverDef } from '../engine/registry.ts'

export const transmissionSolvers: SolverDef[] = [
  {
    id: 'wavelength_frequency',
    summary: 'Wavelength from frequency (velocity factor aware)',
    parameters: {
      frequency: { type: 'complex', kind: QuantityKind.Frequency },
      velocityFactor: { type: 'complex', kind: QuantityKind.None, optional: true },
    },
    returns: {
      type: 'object',
      fields: {
        frequency: { type: 'complex', kind: QuantityKind.Frequency },
        velocityFactor: { type: 'complex', kind: QuantityKind.None },
        wavelength: { type: 'complex', kind: QuantityKind.None },
      },
    },
    run: (args) => {
      const frequency = toScalar(args.frequency as ValuePayload)
      const velocityFactor = args.velocityFactor === undefined ? 1 : toScalar(args.velocityFactor as ValuePayload)
      return {
        frequency,
        velocityFactor,
        wavelength: calcWavelength(frequency, velocityFactor),
      }
    },
  },
  {
    id: 'coaxial_parameters',
    summary: 'Coaxial-line characterization from geometry (impedance, velocity factor, per-meter C and L)',
    parameters: {
      innerDiameter: { type: 'complex', kind: QuantityKind.None },
      outerDiameter: { type: 'complex', kind: QuantityKind.None },
      relativePermittivity: { type: 'complex', kind: QuantityKind.None },
    },
    returns: {
      type: 'object',
      fields: {
        impedance: { type: 'complex', kind: QuantityKind.Resistance },
        velocityFactor: { type: 'complex', kind: QuantityKind.None },
        capacitancePerMeter: { type: 'complex', kind: QuantityKind.Capacitance },
        inductancePerMeter: { type: 'complex', kind: QuantityKind.Inductance },
      },
    },
    run: (args) => {
      const innerDiameter = toScalar(args.innerDiameter as ValuePayload)
      const outerDiameter = toScalar(args.outerDiameter as ValuePayload)
      const relativePermittivity = toScalar(args.relativePermittivity as ValuePayload)
      const result = calcCoaxialParameters(innerDiameter, outerDiameter, relativePermittivity)
      return {
        impedance: result.impedance,
        velocityFactor: result.velocityFactor,
        capacitancePerMeter: result.capacitancePerMeter,
        inductancePerMeter: result.inductancePerMeter,
      }
    },
  },
  {
    id: 'rise_time_bandwidth',
    summary: 'Convert between rise time and bandwidth (tr ≈ 0.35/BW)',
    parameters: {
      bandwidth: { type: 'complex', kind: QuantityKind.Frequency, optional: true },
      riseTime: { type: 'complex', kind: QuantityKind.Time, optional: true },
    },
    returns: {
      type: 'object',
      fields: {
        bandwidth: { type: 'complex', kind: QuantityKind.Frequency },
        riseTime: { type: 'complex', kind: QuantityKind.Time },
      },
    },
    run: (args) => {
      const bandwidth = args.bandwidth === undefined ? undefined : toScalar(args.bandwidth as ValuePayload)
      const riseTime = args.riseTime === undefined ? undefined : toScalar(args.riseTime as ValuePayload)
      if ((bandwidth === undefined) === (riseTime === undefined)) {
        throw new Error('provide exactly one of bandwidth or riseTime')
      }
      return bandwidth !== undefined
        ? { bandwidth, riseTime: calcRiseTimeFromBandwidth(bandwidth) }
        : { bandwidth: calcBandwidthFromRiseTime(riseTime!), riseTime: riseTime! }
    },
  },
]
