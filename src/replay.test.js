import assert from 'node:assert/strict'
import test from 'node:test'
import { HUMAN, KILLER, COURTYARD_LAYOUT, GATE_LAYOUT } from './game.js'
import { loadLastReplay, saveLastReplay } from './replay.js'

test('only the latest complete replay is retained in browser storage', () => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const spawn = { round: 0, positions: { killer: 6, human: 8 }, health: 2, repaired: [], count: 0, pallets: {}, winner: null }
  const first = [spawn, { ...spawn, round: 1, positions: { killer: 8, human: 8 }, health: 0, winner: KILLER }]
  const courtyard = { ...spawn, layout: COURTYARD_LAYOUT }
  const second = [courtyard, { ...courtyard, round: 1, positions: { killer: 8, human: 2 }, repaired: [5, 9, 25], count: 3, winner: HUMAN }]
  assert.equal(loadLastReplay(storage), null)
  saveLastReplay(first, storage)
  assert.deepEqual(loadLastReplay(storage), first)
  saveLastReplay([spawn, { ...spawn, round: 1 }], storage)
  assert.deepEqual(loadLastReplay(storage), first)
  saveLastReplay(second, storage)
  assert.equal(entries.size, 1)
  assert.deepEqual(loadLastReplay(storage), second)
})

test('missing or damaged replay storage does not prevent loading the app', () => {
  const unreadable = { getItem: () => '{' }
  const malformed = { getItem: () => JSON.stringify([null, { winner: HUMAN }]) }
  assert.equal(loadLastReplay(unreadable), null)
  assert.equal(loadLastReplay(malformed), null)
})

test('a gate replay keeps the final frame when the escaped human has no position', () => {
  const start = { layout: GATE_LAYOUT, round: 0, positions: { killer: 6, human: 15 },
    health: 2, repaired: [], count: 0, pallets: {}, winner: null }
  const end = { ...start, round: 1, positions: { killer: 6, human: null }, repaired: [5, 9, 25],
    count: 3, winner: HUMAN, escapedThrough: 2 }
  assert.deepEqual(loadLastReplay({ getItem: () => JSON.stringify([start, end]) }), [start, end])
})
