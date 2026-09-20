import { describe, expect, it } from 'vitest'
import {
  addableMeasure, checkDimension, describeDimension, describeMeasure, dimensionOf,
  divideDimension, divideMeasure, isDimensionless, measureOf, multiplyDimension,
  multiplyMeasure, powerMeasure, sameDimension,
} from '../../src/engine/dimension.ts'
import { QuantityKind } from '../../src/math/quantity-kind.ts'

describe('dimension vectors', () => {
  it('maps every kind to its SI base dimensions', () => {
    expect(dimensionOf(QuantityKind.Voltage)).toEqual([1, 2, -3, -1, 0, 0, 0])
    expect(dimensionOf(QuantityKind.Resistance)).toEqual([1, 2, -3, -2, 0, 0, 0])
    expect(dimensionOf(QuantityKind.Current)).toEqual([0, 0, 0, 1, 0, 0, 0])
    expect(dimensionOf(QuantityKind.Power)).toEqual([1, 2, -3, 0, 0, 0, 0])
  })

  it('keeps the three dimensionless kinds distinguishable', () => {
    for (const kind of [QuantityKind.None, QuantityKind.Angle, QuantityKind.Log]) {
      expect(isDimensionless(dimensionOf(kind))).toBe(true)
    }
    expect(dimensionOf(QuantityKind.None)).not.toEqual(dimensionOf(QuantityKind.Time))
  })

  it('describes a vector for an error message', () => {
    expect(describeDimension(dimensionOf(QuantityKind.Voltage))).toBe('kg·m^2·s^-3·A^-1')
    expect(describeDimension(dimensionOf(QuantityKind.None))).toBe('dimensionless')
  })
})

describe('dimension arithmetic', () => {
  it('OHM times AMP is VOLT', () => {
    const z = dimensionOf(QuantityKind.Resistance)
    const i = dimensionOf(QuantityKind.Current)
    expect(sameDimension(multiplyDimension(z, i), dimensionOf(QuantityKind.Voltage))).toBe(true)
  })

  it('VOLT divided by AMP is OHM', () => {
    const v = dimensionOf(QuantityKind.Voltage)
    const i = dimensionOf(QuantityKind.Current)
    expect(sameDimension(divideDimension(v, i), dimensionOf(QuantityKind.Resistance))).toBe(true)
  })

  it('VOLT times AMP is POWER', () => {
    const v = dimensionOf(QuantityKind.Voltage)
    const i = dimensionOf(QuantityKind.Current)
    expect(sameDimension(multiplyDimension(v, i), dimensionOf(QuantityKind.Power))).toBe(true)
  })

  it('OHM times FARAD is TIME — the RC time constant', () => {
    const r = dimensionOf(QuantityKind.Resistance)
    const c = dimensionOf(QuantityKind.Capacitance)
    expect(sameDimension(multiplyDimension(r, c), dimensionOf(QuantityKind.Time))).toBe(true)
  })

  it('HENRY over OHM is TIME — the L/R time constant', () => {
    const l = dimensionOf(QuantityKind.Inductance)
    const r = dimensionOf(QuantityKind.Resistance)
    expect(sameDimension(divideDimension(l, r), dimensionOf(QuantityKind.Time))).toBe(true)
  })

  it('ONE over TIME is FREQUENCY', () => {
    const none = dimensionOf(QuantityKind.None)
    const t = dimensionOf(QuantityKind.Time)
    expect(sameDimension(divideDimension(none, t), dimensionOf(QuantityKind.Frequency))).toBe(true)
  })
})

describe('kind checks', () => {
  it('accepts an exact kind match and refuses anything else', () => {
    expect(checkDimension('voltage', 'voltage')).toBeUndefined()
    expect(checkDimension('current', 'voltage')).toMatch(/expected voltage \(kg·m\^2·s\^-3·A\^-1\), got current/)
  })

  it('refuses two dimensionless kinds that differ', () => {
    expect(checkDimension('none', 'angle')).toMatch(/both are dimensionless/)
    expect(checkDimension('log', 'none')).toMatch(/both are dimensionless/)
  })
})

describe('addition', () => {
  it('accepts the same kind', () => {
    expect(addableMeasure(measureOf('voltage'), measureOf('voltage'))).toBeUndefined()
    expect(addableMeasure(measureOf('none'), measureOf('none'))).toBeUndefined()
    expect(addableMeasure(measureOf('angle'), measureOf('angle'))).toBeUndefined()
  })

  it('refuses a bare count added to a quantity — 5 + @V_in is ambiguous', () => {
    expect(addableMeasure(measureOf('none'), measureOf('voltage'))).toMatch(/cannot add a plain count to voltage/)
  })

  it('refuses two dimensionless kinds that differ', () => {
    expect(addableMeasure(measureOf('none'), measureOf('angle'))).toMatch(/both are dimensionless/)
    expect(addableMeasure(measureOf('angle'), measureOf('log'))).toMatch(/both are dimensionless/)
  })

  it('refuses two different quantities and says why', () => {
    expect(addableMeasure(measureOf('voltage'), measureOf('current'))).toMatch(/their dimensions differ/)
  })

  it('adds two unnamed measures of one dimension — volt^2 + volt^2 is not ambiguous', () => {
    const squared = powerMeasure(measureOf('voltage'), 2)
    expect(squared.kind).toBeNull()
    expect(addableMeasure(squared, squared)).toBeUndefined()
  })

  it('names the operation it refused', () => {
    expect(addableMeasure(measureOf('voltage'), measureOf('current'), 'compare')).toMatch(/cannot compare/)
  })
})

describe('measures', () => {
  it('keeps the kind when a plain count multiplies a quantity', () => {
    expect(multiplyMeasure(measureOf('none'), measureOf('resistance')).kind).toBe('resistance')
    expect(multiplyMeasure(measureOf('resistance'), measureOf('none')).kind).toBe('resistance')
    expect(multiplyMeasure(measureOf('none'), measureOf('none')).kind).toBe('none')
  })

  it('names a product by its dimension, and leaves an unnamed dimension unnamed', () => {
    expect(multiplyMeasure(measureOf('voltage'), measureOf('current')).kind).toBe('power')
    expect(multiplyMeasure(measureOf('voltage'), measureOf('voltage')).kind).toBeNull()
  })

  it('recovers the name when an unnamed dimension divides back into one', () => {
    const squared = powerMeasure(measureOf('voltage'), 2)
    expect(divideMeasure(squared, measureOf('resistance')).kind).toBe('power')
  })

  it('treats a dimensionless quotient as a plain count, so @V1/@V2 is a ratio', () => {
    expect(divideMeasure(measureOf('voltage'), measureOf('voltage')).kind).toBe('none')
    expect(divideMeasure(measureOf('angle'), measureOf('angle')).kind).toBe('none')
  })

  it('scales the dimension with the exponent: (4ohm)^2 is an unnamed dimension', () => {
    expect(powerMeasure(measureOf('resistance'), 1).kind).toBe('resistance')
    expect(powerMeasure(measureOf('resistance'), 0).kind).toBe('none')
    const squared = powerMeasure(measureOf('resistance'), 2)
    expect(squared.kind).toBeNull()
    expect(describeMeasure(squared)).toMatch(/unnamed/)
  })

  it('describes an unnamed measure by its dimension', () => {
    expect(describeMeasure(measureOf('voltage'))).toBe('voltage (kg·m^2·s^-3·A^-1)')
    expect(describeMeasure({ kind: null, dim: dimensionOf('voltage') })).toBe('an unnamed kg·m^2·s^-3·A^-1')
    expect(describeMeasure({ kind: null, dim: dimensionOf('none') })).toBe('a dimensionless value with no kind')
  })
})
