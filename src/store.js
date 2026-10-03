// Persistencia en localStorage. Todo queda solo en este navegador.
import { MAX_BOX, today } from './srs.js'

const KEY = 'explicamelo:v1'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const emptyState = () => ({ topics: [], cards: [], sessions: [], activeDays: [] })

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// Limpia datos que vienen de localStorage o de un archivo importado.
export function normalize(data) {
  const list = value => (Array.isArray(value) ? value : [])
  const text = value => (typeof value === 'string' ? value : '')
  const date = value => (ISO_DATE.test(value) ? value : today())

  const topics = list(data?.topics)
    .filter(t => t?.id && typeof t.title === 'string')
    .map(t => ({ id: String(t.id), title: t.title, concepts: text(t.concepts), createdAt: date(t.createdAt) }))
  const topicIds = new Set(topics.map(t => t.id))

  const cards = list(data?.cards)
    .filter(c => c?.id && topicIds.has(String(c.topicId)) && typeof c.q === 'string' && typeof c.a === 'string')
    .map(c => ({
      id: String(c.id),
      topicId: String(c.topicId),
      q: c.q,
      a: c.a,
      box: Number.isInteger(c.box) ? Math.min(Math.max(c.box, 0), MAX_BOX) : 0,
      due: date(c.due),
      reviews: Number.isInteger(c.reviews) ? c.reviews : 0,
      lastReviewed: ISO_DATE.test(c.lastReviewed) ? c.lastReviewed : null,
    }))

  const sessions = list(data?.sessions)
    .filter(s => s?.id && topicIds.has(String(s.topicId)))
    .map(s => ({
      id: String(s.id),
      topicId: String(s.topicId),
      date: date(s.date),
      goal: text(s.goal),
      minutes: Number(s.minutes) || 0,
      recall: text(s.recall),
      recalledCount: Number(s.recalledCount) || 0,
      totalConcepts: Number(s.totalConcepts) || 0,
      feynman: text(s.feynman),
      gaps: list(s.gaps).filter(g => typeof g === 'string'),
      cardsCreated: Number(s.cardsCreated) || 0,
    }))

  const activeDays = [...new Set(list(data?.activeDays).filter(d => ISO_DATE.test(d)))].sort()

  return { topics, cards, sessions, activeDays }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : emptyState()
  } catch {
    return emptyState()
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}
