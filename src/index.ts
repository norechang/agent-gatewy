import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { initOpenCode, shutdownOpenCode, getClient } from "./opencode.js"
import { runRoute, validateAgents, getGatewayAgents } from "./routes/agent.js"

const PORT = Number(process.env.PORT ?? 3000)
const HOSTNAME = process.env.HOSTNAME ?? "127.0.0.1"

// ---------------------------------------------------------------------------
// Connect to or spawn OpenCode server
// Set OPENCODE_SERVER_URL to skip spawning and connect to an existing instance.
// ---------------------------------------------------------------------------
const opencodeUrl = process.env.OPENCODE_SERVER_URL

console.log("[gateway] Starting OpenCode Agent Gateway...")

await initOpenCode(opencodeUrl ? { baseUrl: opencodeUrl } : {})

// ---------------------------------------------------------------------------
// Validate gateway agents are available in OpenCode
// ---------------------------------------------------------------------------
try {
  await validateAgents(getClient())
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n[gateway] ${message}\n`)
  shutdownOpenCode()
  process.exit(1)
}


// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------
const app = new Hono()

// Health check
app.get("/health", (c) => c.json({ ok: true, service: "opencode-gateway" }))

// List available agents
app.get("/agents", (c) => {
  const agents = getGatewayAgents()
  return c.json({ agents })
})

// Agent execution endpoint
app.route("/run", runRoute)

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404))

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = serve({ fetch: app.fetch, port: PORT, hostname: HOSTNAME }, (info) => {
  console.log(`[gateway] Listening on http://${info.address}:${info.port}`)
  console.log(`[gateway] POST http://${info.address}:${info.port}/run  — invoke an agent`)
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown() {
  console.log("\n[gateway] Shutting down...")
  server.close()
  shutdownOpenCode()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
