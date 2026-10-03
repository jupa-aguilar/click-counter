import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, daysBetween, schedule, isDue, isMastered, streak, MAX_BOX } from './srs.js'

test('addDays cruza meses y años', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('daysBetween', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3)
  assert.equal(daysBetween('2026-10-04', '2026-10-01'), -3)
})

test('schedule: difícil vuelve al nivel 0 y toca mañana', () => {
  const card = schedule({ box: 4, due: '2026-10-03' }, 'hard', '2026-10-03')
  assert.equal(card.box, 0)
  assert.equal(card.due, '2026-10-04')
  assert.equal(card.reviews, 1)
})

test('schedule: bien sube un nivel, fácil sube dos', () => {
  assert.deepEqual(
    [schedule({ box: 0 }, 'good', '2026-10-03').due, schedule({ box: 0 }, 'easy', '2026-10-03').due],
    ['2026-10-06', '2026-10-10'],
  )
})

test('schedule no pasa del nivel máximo', () => {
  assert.equal(schedule({ box: MAX_BOX }, 'easy', '2026-10-03').box, MAX_BOX)
})

test('isDue e isMastered', () => {
  assert.ok(isDue({ due: '2026-10-03' }, '2026-10-03'))
  assert.ok(!isDue({ due: '2026-10-04' }, '2026-10-03'))
  assert.ok(isMastered({ box: 3 }))
  assert.ok(!isMastered({ box: 2 }))
})

test('streak cuenta días seguidos hasta hoy o ayer', () => {
  assert.equal(streak(['2026-10-01', '2026-10-02', '2026-10-03'], '2026-10-03'), 3)
  assert.equal(streak(['2026-10-01', '2026-10-02'], '2026-10-03'), 2)
  assert.equal(streak(['2026-09-30', '2026-10-02'], '2026-10-03'), 1)
  assert.equal(streak(['2026-10-01'], '2026-10-03'), 0)
})
