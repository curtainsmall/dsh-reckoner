/**
 * The SI vector, the table of names, and the `dim` syntax.
 *
 * A value is identified by 7 integer exponents in ISO 80000-1 order
 * (m, kg, s, A, K, mol, cd). The kind label and the names are IO only: two
 * spellings of the same vector are the same quantity, and the table holds SI
 * names only - any other unit is converted by the caller before `set`.
 */
import { fail } from '../errors.ts'
import { describe } from './describe.ts'

/** 7 exponents, ISO 80000-1 order: m, kg, s, A, K, mol, cd. */
export type SiVector = readonly [number, number, number, number, number, number, number]

/** The component order, as it appears in every message. */
export const SI_COMPONENT_ORDER = 'm,kg,s,A,K,mol,cd'

/** The zero vector's kind label and its first name. */
export const DIM_LESS = 'dim-less'

export const ZERO_SI_VECTOR: SiVector = [0, 0, 0, 0, 0, 0, 0]

/** One name of a vector, carrying its affine map `SI = x * factor + offset`. */
export interface SiNameEntry {
  readonly name: string
  readonly factor: number
  readonly offset: number
}

/** One row of the table: a vector, its kind label, and its names (the first is the one mentioned). */
export interface SiTableRow {
  readonly vector: SiVector
  readonly kind: string
  readonly names: readonly SiNameEntry[]
}

function siName(name: string): SiNameEntry {
  return { name, factor: 1, offset: 0 }
}

const DEGREE_CELSIUS: SiNameEntry = { name: 'degC', factor: 1, offset: 273.15 }

/** The single source of vector, kind and name: nothing else may spell a dimension. */
export const SI_TABLE: readonly SiTableRow[] = [
  { vector: ZERO_SI_VECTOR, kind: DIM_LESS, names: [siName(DIM_LESS), siName('radian'), siName('steradian')] },
  { vector: [0, 0, 1, 0, 0, 0, 0], kind: 'time', names: [siName('second')] },
  { vector: [1, 0, 0, 0, 0, 0, 0], kind: 'length', names: [siName('metre')] },
  { vector: [0, 1, 0, 0, 0, 0, 0], kind: 'mass', names: [siName('kilogram')] },
  { vector: [0, 0, 0, 1, 0, 0, 0], kind: 'current', names: [siName('ampere')] },
  { vector: [0, 0, 0, 0, 1, 0, 0], kind: 'temperature', names: [siName('kelvin'), DEGREE_CELSIUS] },
  { vector: [0, 0, 0, 0, 0, 1, 0], kind: 'amount-of-substance', names: [siName('mole')] },
  { vector: [0, 0, 0, 0, 0, 0, 1], kind: 'luminous-intensity', names: [siName('candela'), siName('lumen')] },
  { vector: [0, 0, -1, 0, 0, 0, 0], kind: 'frequency', names: [siName('hertz'), siName('becquerel')] },
  { vector: [1, 1, -2, 0, 0, 0, 0], kind: 'force', names: [siName('newton')] },
  { vector: [-1, 1, -2, 0, 0, 0, 0], kind: 'pressure', names: [siName('pascal')] },
  { vector: [2, 1, -2, 0, 0, 0, 0], kind: 'energy', names: [siName('joule')] },
  { vector: [2, 1, -3, 0, 0, 0, 0], kind: 'power', names: [siName('watt')] },
  { vector: [0, 0, 1, 1, 0, 0, 0], kind: 'charge', names: [siName('coulomb')] },
  { vector: [2, 1, -3, -1, 0, 0, 0], kind: 'voltage', names: [siName('volt')] },
  { vector: [-2, -1, 4, 2, 0, 0, 0], kind: 'capacitance', names: [siName('farad')] },
  { vector: [2, 1, -3, -2, 0, 0, 0], kind: 'resistance', names: [siName('ohm')] },
  { vector: [-2, -1, 3, 2, 0, 0, 0], kind: 'conductance', names: [siName('siemens')] },
  { vector: [2, 1, -2, -2, 0, 0, 0], kind: 'inductance', names: [siName('henry')] },
  { vector: [2, 1, -2, -1, 0, 0, 0], kind: 'magnetic-flux', names: [siName('weber')] },
  { vector: [0, 1, -2, -1, 0, 0, 0], kind: 'flux-density', names: [siName('tesla')] },
  { vector: [-2, 0, 0, 0, 0, 0, 1], kind: 'illuminance', names: [siName('lux')] },
  { vector: [2, 0, -2, 0, 0, 0, 0], kind: 'absorbed-dose', names: [siName('gray'), siName('sievert')] },
  { vector: [0, 0, -1, 0, 0, 1, 0], kind: 'catalytic-activity', names: [siName('katal')] },
]

interface SiNameLookup {
  readonly row: SiTableRow
  readonly entry: SiNameEntry
}

const NAMES = new Map<string, SiNameLookup>()
const ROWS = new Map<string, SiTableRow>()
for (const row of SI_TABLE) {
  ROWS.set(row.vector.join(','), row)
  for (const entry of row.names) NAMES.set(entry.name, { row, entry })
}

/** The map key of a vector: exact 7-component identity. */
export function siVectorKey(vector: SiVector): string {
  return vector.join(',')
}

/** Build a vector from 7 numbers (the caller has already validated them). */
export function toSiVector(components: readonly number[]): SiVector {
  return [components[0]!, components[1]!, components[2]!, components[3]!, components[4]!, components[5]!, components[6]!]
}

/** The names of one vector, in table order (the first is the one mentioned). */
export function siTableRow(vector: SiVector): SiTableRow | undefined {
  return ROWS.get(siVectorKey(vector))
}

/** The table name and its affine map, or undefined for a name outside the table. */
export function siNameLookup(name: string): SiNameLookup | undefined {
  return NAMES.get(name)
}

/** Every table name, in table order: the vocabulary an error message lists. */
export function allSiNames(): string[] {
  return [...NAMES.keys()]
}

/** The kind label of a vector; a vector outside the table has none. */
export function kindOfSiVector(vector: SiVector): string {
  return siTableRow(vector)?.kind ?? 'unnamed'
}

/** The 7 integers, `[1,0,-1,0,0,0,0]`. */
export function formatSiVector(vector: SiVector): string {
  return `[${vector.join(',')}]`
}

/** How a vector is mentioned: its table's first name, else the 7 integers. */
export function spellSiVector(vector: SiVector): string {
  const first = siTableRow(vector)?.names[0]
  return first === undefined ? formatSiVector(vector) : first.name
}

/** A vector as a `dim` argument, with the affine map that came with the spelling. */
export interface DimSpec {
  readonly vector: SiVector
  readonly name?: string
  readonly factor: number
  readonly offset: number
}

/** The `dim` syntax: a table name, 7 integers, or omitted (= the zero vector). */
export function parseDim(input: unknown, where: string): DimSpec {
  if (input === undefined || input === null) {
    return { vector: ZERO_SI_VECTOR, factor: 1, offset: 0 }
  }
  if (typeof input === 'string') {
    const found = siNameLookup(input)
    if (found === undefined) {
      fail(
        'ENGINE_INVALID_DIMENSION',
        `${where}: "${input}" is not an SI name. Write one of ${allSiNames().join(', ')}, or 7 integers in the order ${SI_COMPONENT_ORDER}, for example [1,0,-1,0,0,0,0] for m/s.`,
      )
    }
    return { vector: found.row.vector, name: found.entry.name, factor: found.entry.factor, offset: found.entry.offset }
  }
  if (Array.isArray(input)) {
    if (input.length !== 7) {
      fail(
        'ENGINE_INVALID_DIMENSION',
        `${where}: an SI vector needs exactly 7 exponents in the order ${SI_COMPONENT_ORDER}; got ${input.length}.`,
      )
    }
    for (const component of input) {
      if (typeof component !== 'number' || !Number.isInteger(component)) {
        fail(
          'ENGINE_INVALID_DIMENSION',
          `${where}: every exponent of an SI vector must be an integer; got ${describe(input)}.`,
        )
      }
    }
    return { vector: toSiVector(input as number[]), factor: 1, offset: 0 }
  }
  fail(
    'ENGINE_INVALID_DIMENSION',
    `${where}: expected an SI name or 7 integers in the order ${SI_COMPONENT_ORDER}; got ${describe(input)}.`,
  )
}

/** The dim of a vector already in the table, spelled by its first name. */
export function dimSpecOfVector(vector: SiVector): DimSpec {
  const first = siTableRow(vector)?.names[0]
  return first === undefined
    ? { vector, factor: 1, offset: 0 }
    : { vector, name: first.name, factor: first.factor, offset: first.offset }
}

export function siVectorsEqual(left: SiVector, right: SiVector): boolean {
  return siVectorKey(left) === siVectorKey(right)
}

export function isZeroSiVector(vector: SiVector): boolean {
  return siVectorsEqual(vector, ZERO_SI_VECTOR)
}

/** Whether every exponent is an integer: only such a vector may land in a slot. */
export function isIntegralSiVector(vector: SiVector): boolean {
  return vector.every((component) => Number.isInteger(component))
}

export function addSiVectors(left: SiVector, right: SiVector): SiVector {
  return toSiVector(left.map((component, index) => component + right[index]!))
}

export function subtractSiVectors(left: SiVector, right: SiVector): SiVector {
  return toSiVector(left.map((component, index) => component - right[index]!))
}

/** Scale every exponent: a real exponent does this to the base's vector. */
export function scaleSiVector(vector: SiVector, factor: number): SiVector {
  return toSiVector(vector.map((component) => component * factor))
}

/** `set` direction of the affine map: the written number as SI. */
export function affineForward(x: number, spec: DimSpec): number {
  return x * spec.factor + spec.offset
}

/** `get` direction of the affine map: the stored SI number as the requested spelling. */
export function affineBackward(x: number, spec: DimSpec): number {
  return (x - spec.offset) / spec.factor
}
