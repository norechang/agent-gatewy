import { createOpencode, createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk"

let client: OpencodeClient | null = null
let cleanup: (() => void) | null = null

export interface OpenCodeOptions {
  /** Connect to an already-running opencode server instead of spawning one */
  baseUrl?: string
  port?: number
  hostname?: string
}

/**
 * Initialize the OpenCode server connection.
 * If baseUrl is provided, connects to an existing server.
 * Otherwise, spawns a managed opencode serve process.
 */
export async function initOpenCode(opts: OpenCodeOptions = {}): Promise<OpencodeClient> {
  if (client) return client

  if (opts.baseUrl) {
    console.log(`[opencode] Connecting to existing server at ${opts.baseUrl}`)
    client = createOpencodeClient({ baseUrl: opts.baseUrl })
    return client
  }

  console.log("[opencode] Spawning managed opencode server...")
  const instance = await createOpencode({
    hostname: opts.hostname ?? "127.0.0.1",
    port: opts.port ?? 4096,
    timeout: 15_000,
  })

  client = instance.client
  cleanup = () => instance.server.close()

  console.log(`[opencode] Server ready at ${instance.server.url}`)
  return client
}

export function getClient(): OpencodeClient {
  if (!client) throw new Error("OpenCode not initialized. Call initOpenCode() first.")
  return client
}

export function shutdownOpenCode(): void {
  cleanup?.()
  client = null
  cleanup = null
}
