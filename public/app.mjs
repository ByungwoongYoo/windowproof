import { auditSources } from "./compare.mjs"
import { readPeerRecord, useLoopback } from "./read-peer.mjs"
import { comparisonReadCount, setCurrentAudit } from "./site-actions.mjs"

const get = (id) => document.getElementById(id)
const labels = { required: "Students only", open: "Non-students allowed", unknown: "Student rule unclear" }
const records = new Map()
let selected = null
let index = null
let busy = false

function element(name, value, className) {
  const item = document.createElement(name)
  item.textContent = value
  if (className) item.className = className
  return item
}

function verdict(kind, title, detail) {
  get("verdict").dataset.kind = kind
  get("verdict-title").textContent = title
  get("verdict-detail").textContent = detail
}

function sourceCard(source) {
  const card = element("article", "", "source")
  const link = element("a", source.label)
  link.href = source.url
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  const title = element("h2", "")
  title.append(link)
  const { date, time, zone, stage, instant } = source.deadline
  const deadline = element("time", source.kst ?? `${date} · time unspecified`)
  deadline.dateTime = instant === null ? date : new Date(instant).toISOString()
  card.append(
    title, deadline,
    element("small", `${date}${time ? " " + time : ""} ${zone} · ${stage}`, "muted"),
    element("p", labels[source.student], "student"),
    element("p", source.evidence, "evidence"),
  )
  return card
}

function showAudit(audit) {
  const grid = get("source-grid")
  grid.replaceChildren()
  grid.hidden = !audit?.sources?.length
  if (!audit) {
    verdict("idle", "Ready to compare", "Review the two archived sources for this case.")
    return
  }
  if (audit.status === "aligned") {
    verdict("aligned", "Sources agree", "The paired records match on the deadline and student requirement.")
  } else if (audit.status === "conflict") {
    const title = audit.deadline === "conflict"
      ? audit.eligibility === "conflict" ? "Deadline and student eligibility differ" : "Deadlines differ"
      : "Student eligibility differs"
    const planning = audit.earlier ? ` Earlier planning time: ${audit.earlier}.` : ""
    verdict("conflict", title, "Verify the live form before relying on either record." + planning)
  } else {
    verdict("idle", "Comparison incomplete", audit.notice ?? "At least one field needs confirmation.")
  }
  grid.append(...(audit.sources ?? []).map(sourceCard))
}

function updateButtons() {
  get("check").disabled = !selected || busy
  get("ask").disabled = !(records.get(selected?.id)?.audit.sources?.length) || busy
  get("case-list").querySelectorAll("button").forEach((button) => {
    button.disabled = busy
    button.setAttribute("aria-pressed", String(button.dataset.id === selected?.id))
  })
}

function selectCase(item) {
  selected = item
  get("case-title").textContent = item.title
  get("case-topic").textContent = item.topic
  get("agent-answer").textContent = ""
  const audit = records.get(item.id)
  setCurrentAudit(audit?.audit ?? null)
  showAudit(audit?.audit)
  updateButtons()
}

function confirmAccess({ title, origin, purpose }) {
  const dialog = get("consent")
  get("consent-title").textContent = `Open ${title}?`
  get("consent-origin").textContent = origin
  get("consent-purpose").textContent = purpose
  dialog.returnValue = "decline"
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "allow"), { once: true })
    dialog.showModal()
  })
}

async function compare() {
  if (!selected || busy) return
  busy = true
  records.delete(selected.id)
  setCurrentAudit(null)
  updateButtons()
  get("source-grid").hidden = true
  get("agent-answer").textContent = ""
  verdict("idle", "Comparing sources", "Two archive reads need approval.")
  const sources = []
  const messages = []
  try {
    for (const peer of Object.values(index.peers)) {
      try {
        const source = await readPeerRecord(peer.url, selected.id, (origin) =>
          confirmAccess({ title: peer.title, origin, purpose: peer.purpose }))
        sources.push(source)
        if (!source) messages.push(`${peer.title} skipped.`)
      } catch (error) {
        sources.push(null)
        messages.push(`${peer.title}: ${error.message}`)
      }
    }
    const audit = auditSources(...sources)
    if (messages.length) {
      audit.notice = messages.join(" ") || audit.notice
    }
    const full = { ...audit, caseId: selected.id, title: selected.title, capturedOn: index.capturedOn }
    records.set(selected.id, { audit: full })
    setCurrentAudit(full)
    showAudit(full)
  } catch (error) {
    verdict("idle", "Comparison unavailable", error.message)
  } finally {
    busy = false
    updateButtons()
  }
}

function routerSettings() {
  const router = new URL(get("router").value.trim())
  const model = get("model").value.trim()
  if ((!useLoopback(router) && router.protocol !== "https:") || router.username || router.password ||
      router.search || router.hash || !model) {
    throw new Error("Enter an HTTPS router and model, or use an HTTP loopback router.")
  }
  const key = get("key").value.trim()
  return { router, model, key: key || (useLoopback(router) ? "windowproof-local" : "") }
}

async function askRulesArchive(engine, caseTitle) {
  const peer = index.peers.rules
  const url = new URL(peer.url)
  const question = `What deadline do your archived rules record for ${caseTitle}? Reply in one sentence.`
  const allowed = await confirmAccess({ title: `${peer.title} agent`, origin: url.origin, purpose: question })
  if (!allowed) return "Rules archive agent skipped."
  try {
    const chain = [`${engine.top.base}::${engine.top.network.name}`]
    const session = await engine.resolveRemote(url.href, chain, undefined)
    const answer = await session.invoke({ user_message: { text: question } }, { chain })
    const response = typeof answer === "string" ? "" : answer?.text?.trim()
    return response ? `Rules archive agent\n${response}` : "The rules archive agent returned no answer."
  } catch {
    return "The rules archive agent is unavailable."
  }
}

async function askAgent(event) {
  event.preventDefault()
  const current = records.get(selected?.id)
  if (!current || busy) return
  busy = true
  updateButtons()
  const output = get("agent-answer")
  output.textContent = "Reading the saved comparison…"
  try {
    const { router, model, key } = routerSettings()
    const usePeer = get("peer-agent").checked
    const { Engine } = await import("./runtime/engine.js")
    const engine = new Engine({
      originUrl: new URL(".", import.meta.url).href,
      routerOverride: router.href,
      byokKey: key,
      modelOverride: model,
    })
    engine.onConsent = async () => "decline"
    await engine.loadTop()
    const request = `Call website_read_comparison first. Explain ${selected.title} in two plain-text sentences. Use only the checked comparison.`
    const readsBefore = comparisonReadCount()
    const result = await engine.runTurn(request)
    const explanation = comparisonReadCount() === readsBefore
      ? "The model did not consult the checked evidence. Use the source comparison above."
      : result.text?.trim() || "The model returned no explanation."
    output.textContent = explanation
    if (usePeer) output.textContent += `\n\n${await askRulesArchive(engine, selected.title)}`
  } catch (error) {
    output.textContent = `Agent unavailable. ${error.message}`
  } finally {
    busy = false
    updateButtons()
  }
}

try {
  const response = await fetch(new URL("case-index.json", import.meta.url), { credentials: "omit" })
  if (!response.ok) throw new Error("Case index is unavailable.")
  index = await response.json()
  get("capture-date").textContent = `Snapshots recorded ${index.capturedOn}`
  get("router").value = index.router
  for (const item of index.cases) {
    const button = element("button", item.title)
    button.type = "button"
    button.dataset.id = item.id
    button.addEventListener("click", () => selectCase(item))
    get("case-list").append(button)
  }
  selectCase(index.cases[0])
  get("check").addEventListener("click", compare)
  get("agent-form").addEventListener("submit", askAgent)
} catch (error) {
  verdict("idle", "WindowProof could not start", error.message)
}
