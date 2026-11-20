import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { registerHooks } from "node:module"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { auditSources } from "./public/compare.mjs"
import { readPeerRecord } from "./public/read-peer.mjs"
import { comparisonReadCount, setCurrentAudit } from "./public/site-actions.mjs"
import { demoOrigins } from "./site-config.mjs"
import { Engine } from "./public/runtime/engine.js"

const root = fileURLToPath(new URL("./", import.meta.url))
const realModel = process.env.WINDOWPROOF_VERIFY_MODEL === "1"
const proxyUrl = `${demoOrigins.desk}/local-model/v1`
const modelUrl = `${proxyUrl}/chat/completions`
const nativeFetch = globalThis.fetch
let server
let index

before(async () => {
  server = spawn(process.execPath, ["serve.mjs"], { cwd: root,
    env: { ...process.env, WINDOWPROOF_LOCAL_MODEL: realModel ? "1" : "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  let output = ""
  server.stdout.on("data", (bytes) => { output += bytes })
  server.stderr.on("data", (bytes) => { output += bytes })
  for (let count = 0; count < 100; count += 1) {
    if (server.exitCode !== null) throw new Error(`Preview server stopped. ${output}`)
    if (Object.values(demoOrigins).every((origin) => output.includes(origin))) break
    await new Promise((resolve) => setTimeout(resolve, 35))
  }
  assert.ok(Object.values(demoOrigins).every((origin) => output.includes(origin)), output)
  const response = await nativeFetch(`${demoOrigins.desk}/case-index.json`)
  assert.equal(response.status, 200)
  index = await response.json()
})

after(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const stopped = once(server, "exit")
  server.kill()
  await stopped
})

async function compare(caseId, approve = () => true, fetchImpl = nativeFetch) {
  const records = []
  for (const peer of Object.values(index.peers)) {
    records.push(await readPeerRecord(peer.url, caseId, approve, fetchImpl))
  }
  return auditSources(...records)
}

test("served archives distinguish date conflict, unknown clock and matching control", async () => {
  const full = await compare("innovateher")
  assert.equal(full.deadline, "conflict")
  assert.equal(full.eligibility, "conflict")
  assert.deepEqual(full.sources.map(({ kst }) => kst), ["2026-12-14 07:00 KST", "2026-12-14 16:59 KST"])
  assert.equal(full.earlier, "2026-12-14 07:00 KST")
  const pendo = await compare("pendo")
  assert.equal(pendo.deadline, "conflict")
  assert.deepEqual(pendo.sources.map(({ deadline }) => deadline.date), ["2026-12-28", "2027-01-15"])
  assert.deepEqual(pendo.sources.map(({ kst }) => kst), [null, null])
  assert.equal(pendo.earlier, null)
  const control = await compare("cognizant")
  assert.equal(control.status, "aligned")
  assert.equal(control.sources[0].kst, "2027-01-12 01:00 KST")
  const registration = { ...control.sources[1], deadline: { ...control.sources[1].deadline, stage: "registration" } }
  assert.equal(auditSources(control.sources[0], registration).deadline, "different_stage")
})

test("declined origin receives zero fetches and the allowed archive is public JSON", async () => {
  const contacts = []
  const fetchImpl = async (url, options) => {
    contacts.push(url.origin)
    assert.equal(options.credentials, "omit")
    assert.equal(options.redirect, "error")
    const response = await nativeFetch(url, options)
    assert.equal(response.headers.get("access-control-allow-origin"), "*")
    return response
  }
  const result = await compare("innovateher", (origin) => origin === demoOrigins.rules, fetchImpl)
  assert.equal(result.status, "incomplete")
  assert.deepEqual(contacts, [demoOrigins.rules, demoOrigins.rules])
})

let setupRuntime
async function compile(routerOverride) {
  // Node uses the same module bytes as the browser's same-origin action import.
  setupRuntime?.deregister()
  globalThis.location = new URL(demoOrigins.desk)
  const actionModule = `${demoOrigins.desk}/site-actions.mjs`
  setupRuntime = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === actionModule ? new URL("./public/site-actions.mjs", import.meta.url).href : specifier, context)
  } })
  const engine = new Engine({ originUrl: demoOrigins.desk, routerOverride,
    byokKey: "windowproof-local", modelOverride: "windowproof-qwen" })
  try {
    const { validation } = await engine.loadTop()
    assert.deepEqual(validation.errors, [])
    assert.equal(engine.actions.catalog({ base: demoOrigins.desk, network: "windowproof" }).length, 1)
    return engine
  } finally {
    setupRuntime.deregister()
    setupRuntime = null
  }
}

test("official runtime compiles and resolves the two exact peer networks before inference", async () => {
  const engine = await compile()
  for (const [name, peer] of Object.entries(index.peers)) {
    const session = await engine.resolveRemote(peer.url, [], undefined)
    assert.equal(session.network.findFrontMan(), "read_archive")
    assert.equal(session.network.name, peer.name, name)
    assert.equal(session.llm.baseUrl, engine.top.llm.baseUrl)
  }
  await assert.rejects(engine.resolveRemote(`${demoOrigins.rules}/missing`, [], undefined), /No published network/)
})

function scriptedReply(body) {
  const names = (body.tools ?? []).map((tool) => tool.function.name)
  const completed = body.messages.filter(({ role }) => role === "tool").length
  const next = ["website_read_comparison", "rules_evidence"][completed]
  const delta = names.includes(next) ? { tool_calls: [{ index: 0, id: `call_${completed}`, type: "function",
    function: { name: next, arguments: JSON.stringify(next === "rules_evidence" ? { request: "InnovateHER deadline" } : {}) } }] }
    : { content: "Integration fixture response." }
  const finish = delta.tool_calls ? "tool_calls" : "stop"
  const chunk = JSON.stringify({ model: "windowproof-test-fixture", choices: [{ index: 0, delta, finish_reason: finish }] })
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } })
}

test("reference runtime checks peer approval before contact and dispatches the evidence action", async () => {
  const audit = await compare("innovateher")
  setCurrentAudit(audit)
  const before = comparisonReadCount()
  const contacts = []
  const modelCalls = []
  const events = []
  globalThis.fetch = (target, options) => {
    const url = new URL(target)
    if ([demoOrigins.rules, demoOrigins.listings].includes(url.origin)) {
      contacts.push(url.origin)
      assert.equal(new Headers(options?.headers).has("authorization"), false)
    }
    if (url.href !== modelUrl) return nativeFetch(target, options)
    const body = JSON.parse(options.body)
    modelCalls.push(body.tools?.map((tool) => tool.function.name) ?? [])
    return Promise.resolve(scriptedReply(body))
  }
  try {
    const denied = await compile(proxyUrl)
    denied.onConsent = async () => "decline"
    await denied.runTurn("Explain InnovateHER and ask Rules archive for the deadline.")
    assert.equal(contacts.length, 0)
    const allowed = await compile(proxyUrl)
    allowed.onConsent = async ({ peerOrigin }) => {
      assert.equal(peerOrigin, new URL(demoOrigins.rules).host)
      assert.equal(contacts.length, 0)
      return "allow"
    }
    assert.equal((await allowed.runTurn("Explain InnovateHER and ask Rules archive for the deadline.")).text, "Integration fixture response.")
    events.push(...allowed.trace.export().events)
    assert.ok(comparisonReadCount() >= before + 2)
    assert.ok(events.some(({ kind, phase, status }) => kind === "remote_call" && phase === "end" && status === "ok"))
    assert.deepEqual(new Set(contacts), new Set([demoOrigins.rules]))
    assert.ok(modelCalls.some((names) => names.length === 0), "Expected one closed peer with no callable website actions")
  } finally {
    globalThis.fetch = nativeFetch
  }
})

test("official runtime runs actual Qwen through the desk-only loopback router", { skip: !realModel, timeout: 100000 }, async () => {
  const denied = await nativeFetch(modelUrl, { method: "POST", headers: { Origin: demoOrigins.rules,
    "Content-Type": "application/json" }, body: "{}" })
  assert.equal(denied.status, 403)
  const engine = await compile(proxyUrl)
  const audit = await compare("innovateher")
  setCurrentAudit({ ...audit, caseId: "innovateher", title: "InnovateHER", capturedOn: index.capturedOn })
  const before = comparisonReadCount()
  globalThis.fetch = (target, options) => {
    const url = new URL(target)
    if (url.href !== modelUrl) return nativeFetch(target, options)
    const headers = new Headers(options.headers)
    headers.set("Origin", demoOrigins.desk)
    return nativeFetch(target, { ...options, headers })
  }
  engine.onConsent = async () => "decline"
  try {
    const answer = await engine.runTurn("Call website_read_comparison once. Report both InnovateHER kst fields exactly, then explain the conflict briefly.")
    const events = engine.trace.export().events
    const models = events.filter(({ kind, phase }) => kind === "model_call" && phase === "end")
    assert.ok(models.some(({ verifiedReal, respModel }) => verifiedReal && respModel === "windowproof-qwen"), JSON.stringify(models))
    assert.ok(comparisonReadCount() > before, `No evidence action in ${JSON.stringify(models.map(({ status, error, toolCalls }) => ({ status, error, toolCalls })))}`)
    assert.match(answer.text, /(?:07:00|7:00\s+AM)\s+KST/i)
    assert.match(answer.text, /(?:16:59|4:59\s+PM)\s+KST/i)
    console.log(`Actual ${models.length} model calls. ${answer.text.trim()}`)
  } finally {
    globalThis.fetch = nativeFetch
  }
})
