import { Hono } from "hono"
import { OpencodeClient } from "@opencode-ai/sdk"
import { getClient } from "../opencode.js"
import { runReporter, type ReporterRequest } from "../agents/reporter.js"

// ---------------------------------------------------------------------------
// Supported agents registry
// Add new agents here as the gateway grows.
// ---------------------------------------------------------------------------

type AgentName = "reporter"

export interface AgentMetadata {
  name: string
  description: string
  handler: (req: Record<string, unknown>) => Promise<unknown>
}

export const AGENTS: Record<AgentName, AgentMetadata> = {
  reporter: {
    name: "reporter",
    description: "A text processing specialist that executes arbitrary text transformation, extraction, classification, and analysis tasks as directed by the caller's instruction prompt. Always returns structured JSON results.",
    handler: (req) => runReporter(getClient(), req as unknown as ReporterRequest),
  },
}

export const AGENT_NAMES = Object.keys(AGENTS) as AgentName[]

// ---------------------------------------------------------------------------
// Agent validation
// ---------------------------------------------------------------------------

/**
 * Validates that all gateway-registered agents are available in the OpenCode server.
 * Throws an error with actionable recommendations if validation fails.
 */
export async function validateAgents(client: OpencodeClient): Promise<void> {
  const result = await client.app.agents()
  
  if (result.error) {
    throw new Error(
      `Failed to fetch agents from OpenCode server: ${JSON.stringify(result.error)}\n\n` +
      "Recommendation: Verify that the OpenCode server is running and accessible."
    )
  }

  const serverAgents = result.data ?? []
  const serverAgentNames = new Set(serverAgents.map((a) => a.name))
  const missingAgents: string[] = []

  for (const agentName of AGENT_NAMES) {
    if (!serverAgentNames.has(agentName)) {
      missingAgents.push(agentName)
    }
  }

  if (missingAgents.length > 0) {
    const agentList = missingAgents.map(name => `  - ${name}`).join("\n")
    throw new Error(
      `Gateway agent validation failed. The following agents are registered in the gateway but not found in OpenCode:\n\n` +
      `${agentList}\n\n` +
      `Recommendation:\n` +
      `1. Verify that agent definition files exist in .opencode/agents/ directory:\n` +
      missingAgents.map(name => `   - .opencode/agents/${name}.md`).join("\n") + "\n" +
      `2. Restart the OpenCode server to load new agent definitions\n` +
      `3. Check agent definition file format (must have valid frontmatter with mode, description, etc.)\n` +
      `4. Run 'opencode serve' manually to see detailed error messages`
    )
  }

  console.log(`[gateway] Agent validation passed: ${AGENT_NAMES.join(", ")}`)
}

/**
 * Returns metadata for gateway-registered agents only (not all OpenCode system agents)
 */
export function getGatewayAgents(): Array<{ name: string; description: string }> {
  return AGENT_NAMES.map(name => ({
    name: AGENTS[name].name,
    description: AGENTS[name].description,
  }))
}


// ---------------------------------------------------------------------------
// Route: POST /run
// Body: { agent: string, instruction: string, text: string, output_schema?: object }
// ---------------------------------------------------------------------------

export const runRoute = new Hono()

runRoute.post("/", async (c) => {
  let body: Record<string, unknown>

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  const agentName = body.agent as string | undefined
  if (!agentName) {
    return c.json({ error: 'Missing required field: "agent"' }, 400)
  }

  const handler = AGENTS[agentName as AgentName]
  if (!handler) {
    const available = Object.keys(AGENTS).join(", ")
    return c.json({ error: `Unknown agent "${agentName}". Available: ${available}` }, 404)
  }

  // Validate agent-specific required fields
  if (agentName === "reporter") {
    if (!body.instruction) return c.json({ error: 'Missing required field: "instruction"' }, 400)
    if (!body.text) return c.json({ error: 'Missing required field: "text"' }, 400)
  }

  try {
    const result = await handler.handler(body)
    return c.json({ ok: true, ...result as object })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[run/${agentName}] Error:`, message)
    return c.json({ ok: false, error: message }, 500)
  }
})
