// Sincronización con la cuenta de Claude cuando la app se abre como Artifact
// en claude.ai. Fuera de ahí (npm run dev, otro hosting) todo queda en
// localStorage y este módulo no hace nada.
//
// Estructura: data/users/<id>/profile guarda los días activos, y cada tema
// es un documento en data/users/<id>/profile/topics/<topicId> con sus
// tarjetas y sesiones. Así ningún documento se acerca al límite de 256 KiB.
import { normalize } from './store.js'

const DELETE = Symbol('delete')
const MAX_DOC_BYTES = 240_000

let db = null
let base = null
const desired = new Map() // ruta -> JSON enviado (o en camino) al servidor
const pending = new Map() // ruta -> próxima escritura
const running = new Set()
let onError = () => {}

export async function capability(name) {
  try {
    return (await globalThis.claude?.use?.(name)) ?? null
  } catch {
    return null
  }
}

export async function connect(handleError) {
  if (!globalThis.claude?.use) return false
  const [store, user] = await Promise.all([capability('db'), capability('user')])
  const id = await user?.id()
  if (!store || !id) return false
  db = store
  base = `data/users/${id}`
  onError = handleError
  return true
}

export const connected = () => db !== null
export const idle = () => running.size === 0 && pending.size === 0

const profilePath = () => `${base}/profile`
const topicPath = id => `${base}/profile/topics/${id}`

function fitTopicDoc(body) {
  let json = JSON.stringify(body)
  // Si un tema crece demasiado, se descartan los textos largos de las
  // sesiones más antiguas (los números y lagunas se conservan).
  const sessions = [...body.sessions].sort((a, b) => a.date.localeCompare(b.date))
  for (const s of sessions) {
    if (json.length <= MAX_DOC_BYTES) break
    s.recall = ''
    s.feynman = ''
    json = JSON.stringify(body)
  }
  return json
}

function serialize(state) {
  const docs = new Map([[profilePath(), JSON.stringify({ activeDays: state.activeDays })]])
  for (const topic of state.topics) {
    const body = {
      topic,
      cards: state.cards.filter(c => c.topicId === topic.id),
      sessions: state.sessions.filter(s => s.topicId === topic.id).map(s => ({ ...s })),
    }
    docs.set(topicPath(topic.id), fitTopicDoc(body))
  }
  return docs
}

export async function pull() {
  const profileRef = db.doc(profilePath())
  const [profile, topics] = await Promise.all([profileRef.get(), profileRef.collection('topics').limit(1000).get()])
  if (!profile.exists && topics.empty) return null
  const data = { activeDays: profile.data()?.activeDays ?? [], topics: [], cards: [], sessions: [] }
  for (const doc of topics.docs) {
    const body = doc.data() ?? {}
    if (body.topic) data.topics.push(body.topic)
    data.cards.push(...(body.cards ?? []))
    data.sessions.push(...(body.sessions ?? []))
  }
  const state = normalize(data)
  desired.clear()
  for (const [path, json] of serialize(state)) desired.set(path, json)
  return state
}

export function push(state) {
  if (!db) return
  const docs = serialize(state)
  for (const [path, json] of docs) {
    if (desired.get(path) !== json) enqueue(path, json)
  }
  for (const path of [...desired.keys()]) {
    if (!docs.has(path)) enqueue(path, DELETE)
  }
}

function enqueue(path, op) {
  if (op === DELETE) desired.delete(path)
  else desired.set(path, op)
  pending.set(path, op)
  if (!running.has(path)) run(path)
}

// Una escritura a la vez por documento; si llegan varias seguidas, solo se
// envía la última.
async function run(path) {
  running.add(path)
  while (pending.has(path)) {
    const op = pending.get(path)
    pending.delete(path)
    try {
      await write(path, op)
    } catch (error) {
      if (error?.code === 'unavailable') {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
        try {
          await write(path, op)
          continue
        } catch (retryError) {
          error = retryError
        }
      }
      // Marcarlo como desconocido hace que el próximo guardado lo reintente.
      desired.set(path, null)
      onError(error)
    }
  }
  running.delete(path)
}

function write(path, op) {
  return op === DELETE ? db.doc(path).delete() : db.doc(path).set(JSON.parse(op))
}
