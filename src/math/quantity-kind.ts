/**
 * The quantity-kind enum: the eighteen names a stored value's `kind` can take.
 *
 * A kind is the name of a quantity, never a unit: `frequency` is `hertz`, and
 * the unit words that express a kind live in the units table. Seven kinds are
 * SI base quantities, nine are derived quantities whose dimension vector the
 * engine knows, and two (`log`, `none`) are dimensionless without being counts
 * — the distinction that makes `none + voltage` a refusal.
 *
 * `kindOf`/`dimensionOf` in the engine resolve a name to its vector; nothing
 * outside them needs the arithmetic helpers that the old solver kernels used.
 */

/** The semantic category a value belongs to (drives dimensions and checks). */
export enum QuantityKind {
  // base quantities
  Time = 'time',
  Length = 'length',
  Mass = 'mass',
  Current = 'current',
  Temperature = 'temperature',
  AmountOfSubstance = 'amount-of-substance',
  LuminousIntensity = 'luminous-intensity',
  // derived quantities
  Frequency = 'frequency',
  Resistance = 'resistance',
  Capacitance = 'capacitance',
  Inductance = 'inductance',
  Voltage = 'voltage',
  Power = 'power',
  Angle = 'angle',
  Pressure = 'pressure',
  Energy = 'energy',
  // dimensionless, each with its own identity
  Log = 'log',
  None = 'none',
}

/** The kind names, derived from the enum so the two cannot drift. */
export const QUANTITY_KIND_NAMES: readonly string[] = Object.values(QuantityKind)
