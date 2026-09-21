// node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { curveFromBottle, normaliseFeather }
  from '../webar-wine-label/geometry.js'

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

test('curveFromBottle: the shipped geometry', () => {
  // wines.js SHARED_LABEL: 58.6mm of chord on a 76mm bottle.
  close(curveFromBottle(58.6, 76), Math.asin(58.6 / 76) * 180 / Math.PI)
  close(curveFromBottle(58.6, 76), 50.448508572379225, 1e-9)
})

test('curveFromBottle: half the diameter is 30 degrees', () => {
  close(curveFromBottle(38, 76), 30, 1e-9)
})

test('curveFromBottle: a label wrapping to the silhouette is ~90, not NaN', () => {
  const c = curveFromBottle(76, 76)
  assert.ok(Number.isFinite(c), 'must stay finite')
  assert.ok(c > 89 && c < 90, `expected just under 90, got ${c}`)
  // The clamp exists so curved-panel's R = (w/2)/sin(t) stays finite.
  assert.ok(Math.sin(c * Math.PI / 180) < 1)
})

test('curveFromBottle: missing or absurd inputs disable the curve', () => {
  assert.equal(curveFromBottle(0, 76), 0)
  assert.equal(curveFromBottle(58.6, 0), 0)
  assert.equal(curveFromBottle(undefined, 76), 0)
  assert.equal(curveFromBottle(58.6, undefined), 0)
  assert.equal(curveFromBottle(-10, 76), 0)
  // Wider than the bottle: a measurement mistake, not a shape. Flat, not NaN.
  assert.equal(curveFromBottle(200, 76), 0)
})

test('normaliseFeather: a scalar goes to all four edges', () => {
  assert.deepEqual(normaliseFeather(0.05),
    { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 })
  assert.deepEqual(normaliseFeather(0),
    { top: 0, right: 0, bottom: 0, left: 0 })
})

test('normaliseFeather: side fills right and left only', () => {
  // The shipped shape: the top lands on the printed torn edge and stays crisp.
  assert.deepEqual(normaliseFeather({ top: 0.01, side: 0.09, bottom: 0.09 }),
    { top: 0.01, right: 0.09, bottom: 0.09, left: 0.09 })
})

test('normaliseFeather: an explicit edge beats side', () => {
  assert.deepEqual(normaliseFeather({ side: 0.05, right: 0.2 }),
    { top: 0, right: 0.2, bottom: 0, left: 0.05 })
})

test('normaliseFeather: nothing at all fades nothing', () => {
  assert.deepEqual(normaliseFeather(null),
    { top: 0, right: 0, bottom: 0, left: 0 })
  assert.deepEqual(normaliseFeather(undefined),
    { top: 0, right: 0, bottom: 0, left: 0 })
  assert.deepEqual(normaliseFeather({}),
    { top: 0, right: 0, bottom: 0, left: 0 })
})

test('normaliseFeather: an explicit zero is not treated as absent', () => {
  // ?? rather than ||, so `side: 0` really does mean no side fade even when the
  // label default has one.
  assert.deepEqual(normaliseFeather({ top: 0.01, side: 0 }),
    { top: 0.01, right: 0, bottom: 0, left: 0 })
})
