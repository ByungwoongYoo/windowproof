import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { extname, resolve, relative, sep } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { demoOrigins } from "./site-config.mjs"

const publicDir = fileURLToPath(new URL("./public/", import.meta.url))
const modelPath = "/local-model/v1/chat/completions"
const localRouter = "http://127.0.0.1:1234/v1/chat/completions"
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

async function localCompletion(request, response, origin) {
  if (request.method !== "POST" || request.headers.origin !== origin ||
      request.headers["content-type"] !== "application/json") {
    response.writeHead(403).end()
    return
  }
  const chunks = []
  let total = 0
  try {
    for await (const chunk of request) {
      total += chunk.byteLength
      if (total > 65536) return response.writeHead(413).end()
      chunks.push(chunk)
    }
    const { model, messages, tools, tool_choice } = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!["qwen3.5-4b", "windowproof-qwen"].includes(model) || !Array.isArray(messages)) {
      response.writeHead(400).end()
      return
    }
    const upstream = await fetch(localRouter, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice, stream: true,
        temperature: 0, max_tokens: 160, reasoning_effort: "none",
        chat_template_kwargs: { enable_thinking: false } }),
      signal: AbortSignal.timeout(65000),
    })
    if (!upstream.ok || !upstream.body) {
      response.writeHead(502, { "Content-Type": contentTypes[".txt"] })
        .end(`The local LM Studio router returned HTTP ${upstream.status}.`)
      return
    }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" })
    await pipeline(Readable.fromWeb(upstream.body), response)
  } catch {
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": contentTypes[".txt"] })
        .end("The local LM Studio router did not respond.")
    }
  }
}

for (const [role, origin] of Object.entries(demoOrigins)) {
  const address = new URL(origin)
  const root = role === "desk" ? publicDir : resolve(publicDir, "peers", role)
  const server = createServer(async (request, response) => {
    if (process.env.WINDOWPROOF_TRACE === "1") {
      console.log(JSON.stringify({
        role, path: request.url,
        authorization: Boolean(request.headers.authorization), cookies: Boolean(request.headers.cookie),
      }))
    }
    if (role === "desk" && request.url === modelPath && process.env.WINDOWPROOF_LOCAL_MODEL === "1") {
      await localCompletion(request, response, origin)
      return
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname)
      const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`)
      const localPath = relative(root, path)
      if (localPath.startsWith(`..${sep}`) || localPath === ".." || !contentTypes[extname(path)]) {
        response.writeHead(404).end()
        return
      }
      const content = await readFile(path)
      const headers = {
        "Content-Type": contentTypes[extname(path)],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }
      if (extname(path) === ".json") headers["Access-Control-Allow-Origin"] = "*"
      response.writeHead(200, headers).end(request.method === "HEAD" ? undefined : content)
    } catch {
      response.writeHead(404).end()
    }
  })
  server.on("error", (error) => { console.error(error.message); process.exit(1) })
  const bind = role === "rules" ? "::1" : "127.0.0.1"
  server.listen(Number(address.port), bind, () => console.log(`${role} ${origin}`))
}
