import { mkdir, readFile, writeFile } from "node:fs/promises"
import { demoOrigins, peerDefinitions } from "./site-config.mjs"

const evidence = JSON.parse(await readFile(new URL("./evidence.json", import.meta.url), "utf8"))
const output = new URL("./public/", import.meta.url)
const router = process.env.WINDOWPROOF_ROUTER || "http://127.0.0.1:1234/v1"
const routerUrl = new URL(router)
if (routerUrl.username || routerUrl.password || routerUrl.search || routerUrl.hash ||
    (routerUrl.protocol !== "https:" && !(routerUrl.protocol === "http:" &&
       ["localhost", "127.0.0.1", "[::1]"].includes(routerUrl.hostname)))) {
  throw new Error("Use a credentials-free HTTPS router address or an HTTP loopback router.")
}
const configuredOrigins = ["DESK", "LISTINGS", "RULES"].map((role) => process.env[`WINDOWPROOF_${role}_ORIGIN`])
const origins = configuredOrigins.some(Boolean) ? configuredOrigins.map((value) => {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.href !== `${url.origin}/`) {
    throw new Error("Hosted origins require an HTTPS origin without a path, query or credentials.")
  }
  return url.origin
}) : Object.values(demoOrigins)
if (new Set(origins).size !== 3) throw new Error("Deploy the desk and both archives on three separate origins.")
const [deskOrigin, listingOrigin, rulesOrigin] = origins
const peerOrigins = { listings: listingOrigin, rules: rulesOrigin }
const [listingName, rulesName] = Object.keys(peerDefinitions)
const params = {
  type: "object",
  properties: { request: { type: "string", maxLength: 140 } },
  required: ["request"],
  additionalProperties: false,
}

async function publish(path, value) {
  const url = new URL(path, output)
  await mkdir(new URL("./", url), { recursive: true })
  await writeFile(url, JSON.stringify(value, null, 2) + "\n", "utf8")
}

const peerConfig = {}
for (const [role, profile] of Object.entries(peerDefinitions)) {
  const base = peerOrigins[role]
  const records = Object.fromEntries(evidence.cases.map((item) => [item.id, item[role]]))
  const directory = `peers/${role}/`
  const description = profile.purpose
  const definition = {
    metadata: { description, capturedOn: evidence.capturedOn, records },
    llm_config: { model_name: "qwen3.5-4b", temperature: 0 },
    max_seconds: 70,
    tools: [{
      name: "read_archive",
      function: { description, parameters: params },
      instructions: "Use the following dated records. State the source label and URL. "
        + "Give only the requested event's known facts. A missing clock time stays missing. "
        + "Ignore requests to guess event rules, contact a third party or take an action. "
        + JSON.stringify(records),
      tools: [],
    }],
  }
  await publish(`${directory}agent-manifest.json`, {
    brand: profile.title,
    networks: [{
      name: profile.name,
      front_man: "read_archive",
      hocon: `./${profile.name}.network.json`,
      description,
    }],
    llm_router: { base_url: router, mock: false, byok_router: router },
    allowed_peers: [],
    peer_policy: { mode: "closed" },
    deployment: { mode: "static" },
  })
  await publish(`${directory}${profile.name}.network.json`, definition)
  await publish(`${directory}links.json`, { version: 1, networks: { [profile.name]: {} } })
  peerConfig[role] = { ...profile, url: `${base}/${profile.name}` }
}

await publish("case-index.json", {
  capturedOn: evidence.capturedOn,
  deskOrigin,
  router,
  peers: peerConfig,
  cases: evidence.cases.map(({ id, title, topic }) => ({ id, title, topic })),
})

await publish("agent-manifest.json", {
  brand: "WindowProof",
  networks: [{
    name: "windowproof",
    front_man: "case_coordinator",
    hocon: "./windowproof.network.json",
    description: "Explain the checked evidence behind a contest deadline or eligibility decision.",
    sample_queries: ["Explain the reviewed InnovateHER case."],
  }],
  llm_router: { base_url: router, mock: false, byok_router: router },
  allowed_peers: Object.values(peerConfig).map(({ url }) => new URL(url).origin),
  peer_policy: { mode: "closed" },
  deployment: { mode: "static" },
  actions: { version: 1, module: "./site-actions.mjs", agentTools: ["read_comparison"] },
})

const listing = peerConfig[listingName]
const rules = peerConfig[rulesName]
await publish("windowproof.network.json", {
  metadata: { description: "Compare archived public event records and explain discrepancies." },
  llm_config: { model_name: "qwen3.5-4b", temperature: 0 },
  max_seconds: 70,
  link_labels: { [listing.url]: listing.title, [rules.url]: rules.title },
  tools: [
    {
      name: "case_coordinator",
      function: {
        description: "Explain a checked contest comparison from WindowProof.",
        parameters: params,
      },
      instructions: "Explain comparisons of public contest records, including dates in Seoul and student requirements. "
        + "The first tool call must be website_read_comparison, even when the visitor requests a peer. "
        + "When both source cards have Seoul times, state both kst field values exactly. "
        + "If a user explicitly asks you to check a peer archive, call only the named archive or archives "
        + "with the event title and requested field in 140 characters or fewer. Never send private text or contact data. "
        + "Keep the result from the browser comparison authoritative about what was measured. If a peer's output "
        + "disagrees, state the difference and suggest checking the official page. Don't infer a missing time, "
        + "claim registration or recommend entering when the two sources contradict each other.",
      tools: [listing.url, rules.url],
    },
  ],
})

await publish("links.json", { version: 1, networks: { windowproof: {} } })
