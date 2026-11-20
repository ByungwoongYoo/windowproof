const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

export function useLoopback(url) {
  return url.protocol === "http:" && LOOPBACK.has(url.hostname)
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Archive returned HTTP ${response.status}.`)
  return response.json()
}

export async function readPeerRecord(networkUrl, caseId, requestConsent, fetchImpl = fetch) {
  const url = new URL(networkUrl)
  const scope = new URL(".", url)
  const name = url.pathname.split("/").at(-1)
  if ((!useLoopback(url) && url.protocol !== "https:") || !name || url.username || url.password ||
      url.search || url.hash) {
    throw new Error("Archive address is invalid.")
  }
  if (!(await requestConsent(url.origin))) return null
  const manifest = await getJson(new URL("agent-manifest.json", scope), fetchImpl)
  if (!Array.isArray(manifest?.networks)) throw new Error("Archive manifest has no network list.")
  const entries = manifest.networks.filter((entry) => entry?.name === name)
  if (entries.length !== 1 || typeof entries[0].hocon !== "string") {
    throw new Error("Archive manifest did not publish the requested network.")
  }
  const definitionUrl = new URL(entries[0].hocon, scope)
  if (definitionUrl.origin !== url.origin || definitionUrl.username || definitionUrl.password) {
    throw new Error("Archive definition moved to an unapproved origin.")
  }
  const network = await getJson(definitionUrl, fetchImpl)
  if (!network.tools?.some((agent) => agent?.name === entries[0].front_man)) {
    throw new Error("Archive does not have its declared public agent.")
  }
  const records = network.metadata?.records
  const record = records && Object.hasOwn(records, caseId) ? records[caseId] : null
  if (!record) throw new Error("Archive has no record for this case.")
  const source = new URL(record.url)
  if (source.protocol !== "https:" || source.username || source.password) {
    throw new Error("Archive source link is invalid.")
  }
  return { ...record, capturedOn: network.metadata.capturedOn }
}
