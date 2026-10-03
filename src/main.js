import './style.css'
import { load, save, uid, normalize } from './store.js'
import * as sync from './sync.js'
import {
  INTERVALS, MAX_BOX, today, addDays, daysBetween, nextBox, schedule,
  isDue, isMastered, streak, inDaysLabel, agoLabel,
} from './srs.js'

const app = document.querySelector('#app')
const APP_TITLE = 'Explícamelo'
const STEPS = ['Objetivo', 'Foco', 'Recordar', 'Comparar', 'Explicar', 'Tarjetas']
const STEP_KEYS = ['goal', 'focus', 'recall', 'compare', 'feynman', 'cards']

let state = load()
let storageOk = true
let route = { view: 'topics' }
let session = null // sesión de estudio en curso
let review = null // repaso de tarjetas en curso
let ticker = null
let syncStatus = 'local' // local | connecting | synced | error
let localDirty = false // hubo cambios antes de conectar con la cuenta

// ---------- utilidades ----------

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const lines = text => String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const topicById = id => state.topics.find(t => t.id === id)
const cardsOf = topicId => state.cards.filter(c => c.topicId === topicId)
const dueCards = topicId => state.cards.filter(c => isDue(c, today()) && (!topicId || c.topicId === topicId))
const lastSession = topicId =>
  state.sessions.filter(s => s.topicId === topicId).sort((a, b) => b.date.localeCompare(a.date)).at(0)

function persist() {
  storageOk = save(state)
  localDirty = true
  sync.push(state)
}

// Diálogo propio: el visor de claude.ai no muestra confirm() ni alert().
function ask({ title, message = '', confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-backdrop'
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="row end">
          ${cancelLabel ? `<button class="btn ghost" data-answer="no">${esc(cancelLabel)}</button>` : ''}
          <button class="btn ${danger ? 'danger-solid' : 'primary'}" data-answer="yes">${esc(confirmLabel)}</button>
        </div>
      </div>`
    const close = answer => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(answer)
    }
    const onKey = event => {
      if (event.key === 'Escape') close(false)
      event.stopPropagation()
    }
    overlay.addEventListener('click', event => {
      if (event.target === overlay) return close(false)
      const button = event.target.closest('[data-answer]')
      if (button) close(button.dataset.answer === 'yes')
    })
    document.addEventListener('keydown', onKey, true)
    document.body.append(overlay)
    overlay.querySelector('[data-answer="yes"]').focus()
  })
}

function notify(message) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.setAttribute('role', 'status')
  toast.textContent = message
  document.body.append(toast)
  setTimeout(() => toast.remove(), 6000)
}

function markActive() {
  const day = today()
  if (!state.activeDays.includes(day)) state.activeDays.push(day)
}

async function leaveSessionOk() {
  if (!session) return true
  const inProgress = !['goal', 'done'].includes(session.step)
  if (inProgress) {
    const leave = await ask({
      title: '¿Abandonar la sesión?',
      message: 'Se perderá lo que escribiste en esta sesión.',
      confirmLabel: 'Abandonar',
      cancelLabel: 'Seguir estudiando',
      danger: true,
    })
    if (!leave) return false
  }
  endSession()
  return true
}

function endSession() {
  stopTicker()
  session?.audio?.close?.()
  session = null
  document.title = APP_TITLE
}

async function go(view, params = {}) {
  if (!(await leaveSessionOk())) return
  route = { view, ...params }
  render()
  scrollTo(0, 0)
}

// ---------- render ----------

function render() {
  const views = { topics: viewTopics, topic: viewTopic, session: viewSession, review: viewReview, progress: viewProgress }
  const warning = storageOk || syncStatus === 'synced'
    ? ''
    : '<p class="banner">⚠️ No se pudo guardar en este navegador (¿modo privado?). Exporta tus datos desde Progreso para no perderlos.</p>'
  app.innerHTML = `${header()}<main class="main">${warning}${views[route.view]()}</main>`
  if (session?.step === 'focus') updateTimer()
  app.querySelector('[autofocus]')?.focus()
}

function header() {
  const due = dueCards().length
  const current = ['topic', 'session'].includes(route.view) ? 'topics' : route.view
  const tab = (view, label, extra = '') =>
    `<button class="tab${current === view ? ' active' : ''}" data-action="nav" data-view="${view}">${label}${extra}</button>`
  return `
    <header class="topbar">
      <div class="brand"><span aria-hidden="true">🧠</span> ${APP_TITLE}</div>
      <nav class="tabs">
        ${tab('topics', 'Temas')}
        ${tab('review', 'Repasar', due ? `<span class="badge">${due}</span>` : '')}
        ${tab('progress', 'Progreso')}
      </nav>
    </header>`
}

function howItWorks(open) {
  return `
    <details class="card how"${open ? ' open' : ''}>
      <summary>¿Cómo funciona?</summary>
      <p>Releer y subrayar <em>se siente</em> productivo, pero se olvida rápido. Esta app te hace sacar la información de tu cabeza, que es lo que la fija.</p>
      <ol class="how-list">
        <li><strong>Ideas clave en tus palabras.</strong> Si no puedes resumirlo, todavía no lo entiendes.</li>
        <li><strong>Foco (Pomodoro).</strong> Un bloque corto con un objetivo concreto.</li>
        <li><strong>Recuerdo activo.</strong> Sin mirar, escribes todo lo que recuerdas.</li>
        <li><strong>Comparar.</strong> Lo que olvidaste son tus lagunas.</li>
        <li><strong>Técnica Feynman.</strong> Lo explicas como a un niño de 10 años. Donde te trabas, no lo entiendes del todo.</li>
        <li><strong>Repetición espaciada.</strong> Tus lagunas se vuelven tarjetas que repasas justo antes de olvidarlas.</li>
      </ol>
    </details>`
}

function viewTopics() {
  const t = today()
  const list = state.topics
    .map(topic => {
      const cards = cardsOf(topic.id)
      const due = cards.filter(c => isDue(c, t)).length
      const mastered = cards.filter(isMastered).length
      const last = lastSession(topic.id)
      return `
        <article class="card topic">
          <div class="topic-head">
            <h3><button class="link" data-action="open-topic" data-id="${topic.id}">${esc(topic.title)}</button></h3>
            ${due ? `<span class="pill warn">${due} por repasar</span>` : ''}
          </div>
          <p class="meta">${plural(lines(topic.concepts).length, 'idea', 'ideas')} · ${plural(cards.length, 'tarjeta', 'tarjetas')} · ${mastered} dominadas · ${last ? `última sesión ${agoLabel(daysBetween(last.date, t))}` : 'sin sesiones aún'}</p>
          <div class="row">
            <button class="btn primary" data-action="start-session" data-id="${topic.id}">Estudiar</button>
            ${due ? `<button class="btn" data-action="review-topic" data-id="${topic.id}">Repasar</button>` : ''}
            <button class="btn ghost" data-action="open-topic" data-id="${topic.id}">Ver / editar</button>
          </div>
        </article>`
    })
    .join('')

  return `
    <h1>Tus temas</h1>
    ${howItWorks(!state.topics.length)}
    ${list}
    <form class="card stack" data-form="new-topic">
      <h2>Nuevo tema</h2>
      <label>Título
        <input name="title" required maxlength="120" placeholder="Ej: La fotosíntesis">
      </label>
      <label>Ideas clave, <em>en tus propias palabras</em> (una por línea)
        <textarea name="concepts" rows="5" required placeholder="Las plantas convierten la luz en energía química&#10;Necesitan agua, dióxido de carbono y luz&#10;Liberan oxígeno como resultado"></textarea>
      </label>
      <p class="hint">No copies el libro. Si una idea te cuesta resumirla, anótala igual: la sesión te ayudará a encontrar qué no entiendes.</p>
      <button class="btn primary">Crear tema</button>
    </form>`
}

function viewTopic() {
  const topic = topicById(route.id)
  if (!topic) {
    route = { view: 'topics' }
    return viewTopics()
  }
  const t = today()
  const cards = cardsOf(topic.id)
  const due = cards.filter(c => isDue(c, t)).length
  const sessions = state.sessions.filter(s => s.topicId === topic.id).sort((a, b) => b.date.localeCompare(a.date))

  const cardList = cards.length
    ? `<ul class="card-list">${cards
        .map(
          c => `
          <li>
            <div class="qa"><strong>${esc(c.q)}</strong><span>${esc(c.a)}</span></div>
            <div class="card-side">
              ${levelDots(c.box)}
              <small>${isDue(c, t) ? 'toca hoy' : `repaso ${inDaysLabel(daysBetween(t, c.due))}`}</small>
              <button class="btn ghost small" data-action="delete-card" data-id="${c.id}" aria-label="Eliminar tarjeta">Eliminar</button>
            </div>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="hint">Todavía no hay tarjetas. Haz una sesión de estudio y se crearán a partir de tus lagunas.</p>'

  const sessionList = sessions.length
    ? `<ul class="history">${sessions
        .map(
          s => `<li><span>${agoLabel(daysBetween(s.date, t))}</span><span>${esc(s.goal)}</span><span class="pill">${s.recalledCount}/${s.totalConcepts} recordadas · ${s.minutes} min</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="hint">Aún no hiciste sesiones de este tema.</p>'

  return `
    <button class="link back" data-action="nav" data-view="topics">← Temas</button>
    <h1>${esc(topic.title)}</h1>
    <div class="row">
      <button class="btn primary" data-action="start-session" data-id="${topic.id}">Empezar sesión de estudio</button>
      ${due ? `<button class="btn" data-action="review-topic" data-id="${topic.id}">Repasar ${plural(due, 'tarjeta', 'tarjetas')}</button>` : ''}
    </div>

    <form class="card stack" data-form="edit-topic" data-id="${topic.id}">
      <h2>Ideas clave</h2>
      <label>Título<input name="title" required maxlength="120" value="${esc(topic.title)}"></label>
      <label>Una idea por línea, en tus palabras<textarea name="concepts" rows="6" required>${esc(topic.concepts)}</textarea></label>
      <button class="btn">Guardar cambios</button>
    </form>

    <section class="card stack">
      <h2>Tarjetas (${cards.length})</h2>
      ${cardList}
      <form class="stack add-card" data-form="add-card" data-id="${topic.id}">
        <h3>Agregar tarjeta</h3>
        <label>Pregunta<input name="q" required placeholder="¿Por qué las plantas necesitan luz?"></label>
        <label>Respuesta<textarea name="a" rows="2" required></textarea></label>
        <button class="btn">Agregar</button>
      </form>
    </section>

    <section class="card stack">
      <h2>Sesiones</h2>
      ${sessionList}
    </section>

    <button class="btn danger" data-action="delete-topic" data-id="${topic.id}">Eliminar tema</button>`
}

function levelDots(box) {
  const dots = Array.from({ length: MAX_BOX + 1 }, (_, i) => `<i class="${i <= box ? 'on' : ''}"></i>`).join('')
  return `<span class="dots" title="Nivel ${box + 1} de ${MAX_BOX + 1}" aria-label="Nivel ${box + 1} de ${MAX_BOX + 1}">${dots}</span>`
}

// ---------- sesión de estudio ----------

function stepper() {
  const current = STEP_KEYS.indexOf(session.step)
  return `<ol class="steps">${STEPS.map(
    (label, i) => `<li class="${i < current ? 'done' : i === current ? 'current' : ''}">${label}</li>`,
  ).join('')}</ol>`
}

function viewSession() {
  const topic = topicById(session?.topicId)
  if (!topic) {
    endSession()
    route = { view: 'topics' }
    return viewTopics()
  }
  const concepts = lines(topic.concepts)
  const top = `<p class="eyebrow">${esc(topic.title)}</p>${session.step === 'done' ? '' : stepper()}`

  switch (session.step) {
    case 'goal':
      return `${top}
        <form class="card stack" data-form="session-goal">
          <h2>¿Qué quieres lograr en este bloque?</h2>
          <p class="hint">Un objetivo concreto ayuda a concentrarte. No “estudiar biología”, sino “entender por qué las plantas necesitan luz”.</p>
          <input name="goal" required maxlength="160" autofocus placeholder="Al terminar quiero poder explicar…">
          <fieldset class="choices">
            <legend>Duración del bloque</legend>
            ${[15, 25, 45].map(m => `<label><input type="radio" name="minutes" value="${m}"${m === 25 ? ' checked' : ''}> ${m} min</label>`).join('')}
          </fieldset>
          <button class="btn primary">Empezar a concentrarme</button>
        </form>`

    case 'focus':
      return `${top}
        <section class="card focus">
          <p class="eyebrow">Objetivo</p>
          <h2>${esc(session.goal)}</h2>
          <div class="timer" data-timer-ring><span data-timer></span></div>
          <div class="row center">
            <button class="btn" data-action="toggle-pause">${session.paused ? 'Continuar' : 'Pausar'}</button>
            <button class="btn ghost" data-action="finish-focus">Terminé antes</button>
          </div>
          <p class="hint">Estudia con tu material (libro, apuntes, video) y silencia el teléfono. Cuando termine el tiempo, te pediremos recordar <strong>sin mirar</strong>.</p>
          <details>
            <summary>Ver mis ideas clave</summary>
            <ul>${concepts.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          </details>
        </section>`

    case 'recall':
      return `${top}
        <form class="card stack" data-form="session-recall">
          <h2>Sin mirar: escribe todo lo que recuerdes</h2>
          <p class="hint">Cierra el libro. No importa si sale desordenado o incompleto: el esfuerzo de recordar es justamente lo que fija la memoria.</p>
          <textarea name="recall" rows="10" autofocus placeholder="Lo que me acuerdo es…"></textarea>
          <button class="btn primary">Comparar con mis ideas clave</button>
        </form>`

    case 'compare':
      return `${top}
        <form class="card stack" data-form="session-compare">
          <h2>Compara</h2>
          <p class="hint">Marca las ideas que sí aparecieron en lo que escribiste. Las que no, son tus lagunas: ahí vale la pena trabajar.</p>
          <div class="split">
            <div>
              <h3>Lo que recordaste</h3>
              <div class="recall-box">${session.recall ? esc(session.recall) : '<em>(no escribiste nada, ¡no pasa nada! Ahora sabes qué repasar)</em>'}</div>
            </div>
            <div>
              <h3>Tus ideas clave</h3>
              <ul class="checklist">${concepts
                .map((c, i) => `<li><label><input type="checkbox" name="recalled" value="${i}"> <span>${esc(c)}</span></label></li>`)
                .join('')}</ul>
            </div>
          </div>
          <button class="btn primary">Continuar</button>
        </form>`

    case 'feynman':
      return `${top}
        <form class="card stack" data-form="session-feynman">
          <h2>Explícalo como a un niño de 10 años</h2>
          <p class="hint">Usa palabras simples y algún ejemplo. Si necesitas una palabra técnica, explica qué significa. Donde te trabes, encontraste algo que no entiendes del todo.</p>
          <label>Tu explicación<textarea name="feynman" rows="8" autofocus placeholder="Imagina que…"></textarea></label>
          <label>¿Dónde te trabaste o qué palabra no sabrías definir? (una por línea)
            <textarea name="stuck" rows="3" placeholder="¿Qué es la clorofila?"></textarea>
          </label>
          <button class="btn primary">Continuar</button>
        </form>`

    case 'cards':
      return `${top}
        <form class="card stack" data-form="session-cards">
          <h2>Convierte tus lagunas en tarjetas</h2>
          ${session.noGaps ? '<p class="success">¡Recordaste todas tus ideas clave! 🎉 Igual puedes crear tarjetas para no olvidarlas.</p>' : ''}
          <p class="hint">Escribir la pregunta tú mismo ya es estudiar. Una tarjeta = una sola idea. Las repasarás justo antes de olvidarlas.</p>
          ${session.drafts
            .map(
              (d, i) => `
            <fieldset class="draft">
              <label class="inline"><input type="checkbox" name="use-${i}"${d.use ? ' checked' : ''}> Crear esta tarjeta</label>
              <label>Pregunta<input name="q-${i}" value="${esc(d.q)}" placeholder="¿Qué pregunta tiene como respuesta esto?"></label>
              <label>Respuesta<textarea name="a-${i}" rows="2" placeholder="Búscala en tu material si no la sabes">${esc(d.a)}</textarea></label>
            </fieldset>`,
            )
            .join('')}
          <button type="button" class="btn ghost" data-action="add-draft">+ Otra tarjeta</button>
          <button class="btn primary">Guardar y terminar</button>
        </form>`

    case 'done': {
      const s = session.summary
      return `${top}
        <section class="card stack center">
          <h2>¡Sesión terminada! 🎉</h2>
          <div class="tiles">
            <div class="tile"><b>${s.minutes}</b><span>min de foco</span></div>
            <div class="tile"><b>${s.recalledCount}/${s.totalConcepts}</b><span>ideas recordadas</span></div>
            <div class="tile"><b>${s.cardsCreated}</b><span>tarjetas nuevas</span></div>
          </div>
          ${s.gaps.length ? `<div class="left"><h3>Lagunas a trabajar</h3><ul>${s.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
          <p class="hint">Repasar ahora mismo las tarjetas nuevas es un segundo intento de recordar: muy efectivo.</p>
          <div class="row center">
            ${dueCards(topic.id).length ? `<button class="btn primary" data-action="review-topic" data-id="${topic.id}">Repasar ahora</button>` : ''}
            <button class="btn" data-action="open-topic" data-id="${topic.id}">Volver al tema</button>
          </div>
        </section>`
    }
  }
  return ''
}

async function startSession(topicId) {
  if (!(await leaveSessionOk())) return
  session = { topicId, step: 'goal' }
  route = { view: 'session' }
  render()
  scrollTo(0, 0)
}

function remainingMs() {
  return session.paused ? session.remainingMs : Math.max(0, session.endsAt - Date.now())
}

function startTicker() {
  stopTicker()
  ticker = setInterval(updateTimer, 250)
}

function stopTicker() {
  clearInterval(ticker)
  ticker = null
}

function updateTimer() {
  if (session?.step !== 'focus') return stopTicker()
  const ms = remainingMs()
  const total = session.minutes * 60000
  const secs = Math.ceil(ms / 1000)
  const label = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
  const display = app.querySelector('[data-timer]')
  if (display) display.textContent = label
  app.querySelector('[data-timer-ring]')?.style.setProperty('--p', String(1 - ms / total))
  document.title = `${session.paused ? '⏸' : '⏳'} ${label} · ${APP_TITLE}`
  if (ms <= 0) finishFocus(true)
}

function togglePause() {
  if (session.paused) {
    session.endsAt = Date.now() + session.remainingMs
    session.paused = false
  } else {
    session.remainingMs = session.endsAt - Date.now()
    session.paused = true
  }
  render()
}

function finishFocus(timeUp = false) {
  stopTicker()
  session.focusedMs = session.minutes * 60000 - remainingMs()
  if (timeUp) chime(session.audio)
  session.step = 'recall'
  document.title = APP_TITLE
  render()
}

function chime(ctx) {
  if (!ctx) return
  try {
    ctx.resume?.()
    ;[660, 880, 990].forEach((freq, i) => {
      const at = ctx.currentTime + i * 0.25
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.45)
    })
  } catch {
    // Sin sonido: el cambio de pantalla alcanza como aviso.
  }
}

function readDrafts(form) {
  return session.drafts.map((_, i) => ({
    use: form.elements[`use-${i}`].checked,
    q: form.elements[`q-${i}`].value.trim(),
    a: form.elements[`a-${i}`].value.trim(),
  }))
}

function addDraft() {
  session.drafts = readDrafts(app.querySelector('form[data-form="session-cards"]'))
  session.drafts.push({ use: true, q: '', a: '' })
  render()
  app.querySelector(`[name="q-${session.drafts.length - 1}"]`)?.focus()
}

// ---------- repaso ----------

async function startReview(topicId) {
  if (!(await leaveSessionOk())) return
  const t = today()
  const queue = state.cards
    .filter(c => isDue(c, t) && (!topicId || c.topicId === topicId))
    .sort((a, b) => a.due.localeCompare(b.due) || a.box - b.box)
    .map(c => c.id)
  review = { queue, total: queue.length, revealed: false, attempt: '', retries: new Set(), counts: { hard: 0, good: 0, easy: 0 } }
  route = { view: 'review' }
  render()
  scrollTo(0, 0)
}

function viewReview() {
  if (!review.total) {
    const upcoming = state.cards.map(c => c.due).sort().at(0)
    return `
      <h1>Repasar</h1>
      <section class="card stack center">
        <h2>No tienes tarjetas para hoy 🎉</h2>
        <p class="hint">${state.cards.length ? `Tu próximo repaso es ${inDaysLabel(daysBetween(today(), upcoming))}. Repasar antes de tiempo ayuda menos: deja que tu memoria descanse.` : 'Aún no tienes tarjetas. Crea un tema y haz una sesión de estudio.'}</p>
        <button class="btn" data-action="nav" data-view="topics">Ir a temas</button>
      </section>`
  }

  const card = state.cards.find(c => c.id === review.queue[0])
  if (!review.queue.length || !card) {
    if (review.queue.length) review.queue.shift() // tarjeta borrada mientras tanto
    if (review.queue.length) return viewReview()
    const { hard, good, easy } = review.counts
    return `
      <h1>Repasar</h1>
      <section class="card stack center">
        <h2>¡Repaso terminado! 💪</h2>
        <div class="tiles">
          <div class="tile"><b>${hard}</b><span>😣 difíciles</span></div>
          <div class="tile"><b>${good}</b><span>🙂 bien</span></div>
          <div class="tile"><b>${easy}</b><span>😎 fáciles</span></div>
        </div>
        <p class="hint">Las difíciles vuelven mañana. Las demás, cada vez más espaciadas.</p>
        <button class="btn" data-action="nav" data-view="topics">Volver a temas</button>
      </section>`
  }

  const topic = topicById(card.topicId)
  const retry = review.retries.has(card.id)
  const rateButton = (rating, emoji, label) => {
    const when = rating === 'hard' ? 'mañana, y otra vez ahora' : inDaysLabel(INTERVALS[nextBox(card.box, rating)])
    return `<button class="rate ${rating}" data-action="rate" data-rating="${rating}">${emoji} ${label}${retry ? '' : `<small>${when}</small>`}</button>`
  }

  return `
    <h1>Repasar</h1>
    <section class="card stack review">
      <p class="eyebrow">${esc(topic?.title)} · ${plural(review.queue.length, 'tarjeta restante', 'tarjetas restantes')}${retry ? ' · repaso extra' : ''}</p>
      <h2 class="question">${esc(card.q)}</h2>
      ${
        review.revealed
          ? `${review.attempt ? `<div class="attempt"><h3>Tu respuesta</h3><p>${esc(review.attempt)}</p></div>` : ''}
            <div class="answer"><h3>Respuesta</h3><p>${esc(card.a)}</p></div>
            <p><strong>¿Cómo te fue?</strong> ${retry ? '<span class="hint">(repaso extra: no cambia la próxima fecha)</span>' : ''}</p>
            <div class="ratings">
              ${rateButton('hard', '😣', 'Difícil')}
              ${rateButton('good', '🙂', 'Bien')}
              ${rateButton('easy', '😎', 'Fácil')}
            </div>
            <p class="hint keys">Atajos: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></p>`
          : `<label>Intenta responder antes de mirar (aunque sea a medias)
              <textarea data-attempt rows="4" autofocus></textarea>
            </label>
            <button class="btn primary" data-action="reveal">Mostrar respuesta</button>
            <p class="hint keys">Atajo: <kbd>Ctrl</kbd>+<kbd>Enter</kbd></p>`
      }
    </section>`
}

function reveal() {
  review.attempt = app.querySelector('[data-attempt]')?.value.trim() ?? ''
  review.revealed = true
  render()
}

function rate(rating) {
  const id = review.queue.shift()
  const index = state.cards.findIndex(c => c.id === id)
  if (index >= 0) {
    if (review.retries.has(id)) {
      // Segunda vuelta de una tarjeta difícil: es práctica extra, no reprograma.
      review.retries.delete(id)
    } else {
      state.cards[index] = schedule(state.cards[index], rating, today())
      review.counts[rating]++
      if (rating === 'hard') {
        review.queue.push(id)
        review.retries.add(id)
      }
    }
    markActive()
    persist()
  }
  review.revealed = false
  review.attempt = ''
  render()
}

// ---------- progreso ----------

function viewProgress() {
  const t = today()
  const minutes = state.sessions.reduce((sum, s) => sum + s.minutes, 0)
  const mastered = state.cards.filter(isMastered).length
  const active = new Set(state.activeDays)
  const days = Array.from({ length: 28 }, (_, i) => addDays(t, i - 27))

  const atRisk = state.topics
    .map(topic => ({ topic, due: dueCards(topic.id).length, last: lastSession(topic.id) }))
    .filter(x => x.due > 0 || (x.last && x.last.recalledCount < x.last.totalConcepts))
    .sort((a, b) => b.due - a.due)

  return `
    <h1>Progreso</h1>
    <div class="tiles">
      <div class="tile"><b>🔥 ${streak(state.activeDays, t)}</b><span>días seguidos</span></div>
      <div class="tile"><b>${state.sessions.length}</b><span>sesiones</span></div>
      <div class="tile"><b>${minutes}</b><span>min de foco</span></div>
      <div class="tile"><b>${mastered}/${state.cards.length}</b><span>tarjetas dominadas</span></div>
    </div>

    <section class="card stack">
      <h2>Últimas 4 semanas</h2>
      <div class="activity">${days
        .map(d => `<i class="${active.has(d) ? 'on' : ''}${d === t ? ' today' : ''}" title="${d}${active.has(d) ? ': estudiaste' : ''}"></i>`)
        .join('')}</div>
      <p class="hint">Estudiar un poco todos los días rinde más que mucho de golpe.</p>
    </section>

    <section class="card stack">
      <h2>En riesgo de olvido</h2>
      ${
        atRisk.length
          ? `<ul class="risk">${atRisk
              .map(
                ({ topic, due, last }) => `
              <li>
                <div>
                  <strong>${esc(topic.title)}</strong>
                  <small>${due ? `${plural(due, 'tarjeta', 'tarjetas')} por repasar` : 'al día con las tarjetas'}${last ? ` · última sesión: ${last.recalledCount}/${last.totalConcepts} ideas recordadas` : ''}</small>
                </div>
                ${due ? `<button class="btn small" data-action="review-topic" data-id="${topic.id}">Repasar</button>` : `<button class="btn small" data-action="start-session" data-id="${topic.id}">Estudiar</button>`}
              </li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">Nada en riesgo por ahora. ¡Bien!</p>'
      }
    </section>

    <section class="card stack">
      <h2>Tus datos</h2>
      ${syncMessage()}
      <p class="hint">También puedes exportar un archivo como copia de seguridad.</p>
      <div class="row">
        <button class="btn" data-action="export">Exportar</button>
        <button class="btn ghost" data-action="import">Importar</button>
        <input type="file" accept="application/json,.json" data-import hidden>
      </div>
    </section>`
}

function syncMessage() {
  const messages = {
    synced: ['ok', 'Se guardan en tu cuenta de Claude: los ves igual en el celular y en la computadora.'],
    connecting: ['', 'Conectando con tu cuenta…'],
    error: ['warn', 'No se pudieron guardar los últimos cambios en tu cuenta. Se reintentará con el próximo cambio.'],
    local: ['', 'Se guardan solo en este navegador.'],
  }
  const [tone, text] = messages[syncStatus]
  return `<p class="sync ${tone}">${esc(text)}</p>`
}

async function exportData() {
  const filename = `explicamelo-${today()}.json`
  const json = JSON.stringify(state, null, 2)
  const downloads = await sync.capability('downloads')
  if (downloads) {
    try {
      await downloads.save({ filename, data: json })
    } catch (error) {
      if (error?.code !== 'declined') notify('No se pudo exportar el archivo en este dispositivo.')
    }
    return
  }
  const blob = new Blob([json], { type: 'application/json' })
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  })
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

async function importData(file) {
  if (!file) return
  let data
  try {
    data = normalize(JSON.parse(await file.text()))
  } catch {
    notify('No se pudo leer el archivo. Elige un .json exportado desde Explícamelo.')
    return
  }
  const summary = `${plural(data.topics.length, 'tema', 'temas')} y ${plural(data.cards.length, 'tarjeta', 'tarjetas')}`
  const replace = await ask({
    title: '¿Reemplazar tus datos?',
    message: `El archivo tiene ${summary}. Reemplazará todo lo que tienes ahora.`,
    confirmLabel: 'Reemplazar',
    danger: true,
  })
  if (!replace) return
  state = data
  persist()
  render()
}

// ---------- eventos ----------

const actions = {
  nav: el => (el.dataset.view === 'review' ? startReview() : go(el.dataset.view)),
  'open-topic': el => go('topic', { id: el.dataset.id }),
  'start-session': el => startSession(el.dataset.id),
  'review-topic': el => startReview(el.dataset.id),
  'delete-topic': async el => {
    const topic = topicById(el.dataset.id)
    const remove = await ask({
      title: `¿Eliminar “${topic.title}”?`,
      message: 'Se borrarán también sus tarjetas y sesiones. No se puede deshacer.',
      confirmLabel: 'Eliminar tema',
      danger: true,
    })
    if (!remove) return
    state.topics = state.topics.filter(t => t.id !== topic.id)
    state.cards = state.cards.filter(c => c.topicId !== topic.id)
    state.sessions = state.sessions.filter(s => s.topicId !== topic.id)
    persist()
    go('topics')
  },
  'delete-card': async el => {
    if (!(await ask({ title: '¿Eliminar esta tarjeta?', confirmLabel: 'Eliminar', danger: true }))) return
    state.cards = state.cards.filter(c => c.id !== el.dataset.id)
    persist()
    render()
  },
  'toggle-pause': togglePause,
  'finish-focus': () => finishFocus(false),
  'add-draft': addDraft,
  reveal,
  rate: el => rate(el.dataset.rating),
  export: exportData,
  import: () => app.querySelector('[data-import]').click(),
}

const forms = {
  'new-topic': data => {
    const topic = { id: uid(), title: data.get('title').trim(), concepts: data.get('concepts').trim(), createdAt: today() }
    if (!topic.title || !lines(topic.concepts).length) return
    state.topics.push(topic)
    persist()
    go('topic', { id: topic.id })
  },
  'edit-topic': (data, form) => {
    const topic = topicById(form.dataset.id)
    const title = data.get('title').trim()
    const concepts = data.get('concepts').trim()
    if (!title || !lines(concepts).length) return
    Object.assign(topic, { title, concepts })
    persist()
    render()
  },
  'add-card': (data, form) => {
    const q = data.get('q').trim()
    const a = data.get('a').trim()
    if (!q || !a) return
    state.cards.push({ id: uid(), topicId: form.dataset.id, q, a, box: 0, due: today(), reviews: 0, lastReviewed: null })
    persist()
    render()
  },
  'session-goal': data => {
    session.goal = data.get('goal').trim()
    session.minutes = Number(data.get('minutes')) || 25
    try {
      // Se crea con el clic para que el navegador permita sonar al terminar.
      session.audio = new (window.AudioContext || window.webkitAudioContext)()
    } catch {
      session.audio = null
    }
    session.step = 'focus'
    session.paused = false
    session.remainingMs = session.minutes * 60000
    session.endsAt = Date.now() + session.remainingMs
    startTicker()
    render()
  },
  'session-recall': data => {
    session.recall = data.get('recall').trim()
    session.step = 'compare'
    render()
  },
  'session-compare': data => {
    session.recalled = data.getAll('recalled').map(Number)
    session.step = 'feynman'
    render()
    scrollTo(0, 0)
  },
  'session-feynman': data => {
    const concepts = lines(topicById(session.topicId).concepts)
    session.feynman = data.get('feynman').trim()
    session.forgotten = concepts.filter((_, i) => !session.recalled.includes(i))
    session.stuck = lines(data.get('stuck'))
    session.drafts = [
      ...session.forgotten.map(c => ({ use: true, q: '', a: c })),
      ...session.stuck.map(s => ({ use: true, q: s, a: '' })),
    ]
    session.noGaps = !session.drafts.length
    if (session.noGaps) session.drafts.push({ use: true, q: '', a: '' })
    session.step = 'cards'
    render()
    scrollTo(0, 0)
  },
  'session-cards': async (_, form) => {
    const drafts = readDrafts(form)
    const chosen = drafts.filter(d => d.use && (d.q || d.a))
    const complete = chosen.filter(d => d.q && d.a)
    const incomplete = chosen.length - complete.length
    if (incomplete) {
      const proceed = await ask({
        title: `${plural(incomplete, 'tarjeta incompleta', 'tarjetas incompletas')}`,
        message: `Les falta la pregunta o la respuesta y no se ${incomplete === 1 ? 'guardará' : 'guardarán'}.`,
        confirmLabel: 'Terminar igual',
        cancelLabel: 'Completarlas',
      })
      if (!proceed) {
        session.drafts = drafts
        return
      }
    }
    if (session?.step !== 'cards') return
    const t = today()
    const topic = topicById(session.topicId)
    for (const d of complete) {
      state.cards.push({ id: uid(), topicId: topic.id, q: d.q, a: d.a, box: 0, due: t, reviews: 0, lastReviewed: null })
    }
    const summary = {
      id: uid(),
      topicId: topic.id,
      date: t,
      goal: session.goal,
      minutes: Math.round((session.focusedMs ?? 0) / 60000),
      recall: session.recall,
      recalledCount: session.recalled.length,
      totalConcepts: lines(topic.concepts).length,
      feynman: session.feynman,
      gaps: [...session.forgotten, ...session.stuck],
      cardsCreated: complete.length,
    }
    state.sessions.push(summary)
    markActive()
    persist()
    session.summary = summary
    session.step = 'done'
    render()
    scrollTo(0, 0)
  },
}

app.addEventListener('click', event => {
  const el = event.target.closest('[data-action]')
  if (el) actions[el.dataset.action]?.(el, event)
})

app.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]')
  if (!form) return
  event.preventDefault()
  forms[form.dataset.form]?.(new FormData(form), form)
})

app.addEventListener('change', event => {
  if (event.target.matches('[data-import]')) {
    importData(event.target.files[0])
    event.target.value = ''
  }
})

document.addEventListener('keydown', event => {
  if (route.view !== 'review' || !review?.queue.length) return
  if (!review.revealed) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      reveal()
    }
    return
  }
  if (event.target.matches('input, textarea')) return
  const rating = { 1: 'hard', 2: 'good', 3: 'easy' }[event.key]
  if (rating) rate(rating)
})

addEventListener('beforeunload', event => {
  if (session && !['goal', 'done'].includes(session.step)) event.preventDefault()
})

// ---------- sincronización con la cuenta ----------

const busy = () =>
  session || (route.view === 'review' && review?.queue.length) || document.querySelector('.modal-backdrop') ||
  document.activeElement?.matches('input, textarea')

function mergeStates(remote, local) {
  const byId = (a, b) => [...new Map([...a, ...b].map(x => [x.id, x])).values()]
  return {
    topics: byId(remote.topics, local.topics),
    cards: byId(remote.cards, local.cards),
    sessions: byId(remote.sessions, local.sessions),
    activeDays: [...new Set([...remote.activeDays, ...local.activeDays])].sort(),
  }
}

function adopt(remote) {
  state = remote
  storageOk = save(state)
  if (!busy()) render()
}

async function startSync() {
  if (!globalThis.claude?.use) return
  syncStatus = 'connecting'
  const ok = await sync.connect(() => {
    syncStatus = 'error'
    notify('No se pudieron guardar los cambios en tu cuenta. Revisa tu conexión.')
  })
  if (!ok) {
    syncStatus = 'local'
    return
  }
  try {
    const remote = await sync.pull()
    syncStatus = 'synced'
    if (!remote) {
      sync.push(state) // primera vez: sube lo que hubiera en este navegador
    } else if (localDirty) {
      adopt(mergeStates(remote, state)) // cambios hechos mientras conectaba
      sync.push(state)
    } else {
      adopt(remote)
    }
  } catch {
    syncStatus = 'error'
  }
  if (route.view === 'progress' && !busy()) render()
}

// Al volver a la app (por ejemplo, después de usarla en el celular), trae
// lo último guardado en la cuenta.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !sync.connected() || !sync.idle() || busy()) return
  try {
    const remote = await sync.pull()
    if (remote && JSON.stringify(remote) !== JSON.stringify(normalize(state)) && sync.idle() && !busy()) {
      adopt(remote)
    }
  } catch {
    // Sin conexión: se sigue con lo que hay en pantalla.
  }
})

render()
startSync()
