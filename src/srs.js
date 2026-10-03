// Repetición espaciada (sistema Leitner) y utilidades de fechas.
// Las fechas se manejan como texto "AAAA-MM-DD" en hora local.

// Días hasta el próximo repaso según el nivel (caja) de la tarjeta.
export const INTERVALS = [1, 3, 7, 15, 30, 60]
export const MAX_BOX = INTERVALS.length - 1
// A partir de este nivel la tarjeta se considera dominada (repaso cada 15+ días).
export const MASTERED_BOX = 3

const pad = n => String(n).padStart(2, '0')

export function today(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

export function nextBox(box, rating) {
  if (rating === 'hard') return 0
  if (rating === 'good') return Math.min(box + 1, MAX_BOX)
  if (rating === 'easy') return Math.min(box + 2, MAX_BOX)
  throw new Error(`Calificación desconocida: ${rating}`)
}

// Devuelve una copia de la tarjeta reprogramada según cómo le fue al estudiante.
export function schedule(card, rating, on) {
  const box = nextBox(card.box ?? 0, rating)
  return {
    ...card,
    box,
    due: addDays(on, INTERVALS[box]),
    reviews: (card.reviews ?? 0) + 1,
    lastReviewed: on,
  }
}

export const isDue = (card, on) => card.due <= on
export const isMastered = card => (card.box ?? 0) >= MASTERED_BOX

// Días seguidos con actividad, terminando hoy (o ayer, si hoy todavía no estudió).
export function streak(activeDays, on) {
  const days = new Set(activeDays)
  let day = days.has(on) ? on : addDays(on, -1)
  let count = 0
  while (days.has(day)) {
    count++
    day = addDays(day, -1)
  }
  return count
}

export function inDaysLabel(days) {
  if (days <= 0) return 'hoy'
  if (days === 1) return 'mañana'
  return `en ${days} días`
}

export function agoLabel(days) {
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}
