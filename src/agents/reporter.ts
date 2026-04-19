import { OpencodeClient } from "@opencode-ai/sdk"

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface ReporterRequest {
  /** The instruction prompt describing what text processing operation to perform */
  instruction: string
  /** The text content to be processed */
  text: string
  /** Optional: caller-provided JSON Schema for the output shape.
   *  If omitted, the default general-purpose schema is used. */
  output_schema?: Record<string, unknown>
  /** Optional: custom system prompt override.
   *  If omitted, a sensible default is used. */
  system?: string
}

export interface ReporterResponse {
  agent: "reporter"
  session_id: string
  result: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Default output JSON Schema
// A flexible, general-purpose schema that covers the most common text
// processing results. Callers may supply their own schema via `output_schema`
// when they need a task-specific output shape.
// ---------------------------------------------------------------------------

const DEFAULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    // NOTE: some providers (eg. GitHub Copilot) expose a StructuredOutput "function"
    // that expects particular parameter shapes. Including a generic top-level
    // `output` property without a concrete type can cause provider-side
    // validation errors (e.g. "'output' is not of type 'array'"). To avoid
    // that class of error, omit the generic `output` property here. Callers can
    // use `items`, `summary`, `labels`, or provide a custom `output_schema`
    // when they need a specific shape.
    summary: {
      type: ["string", "null"],
      description: "A brief summary of what was done and what was found (1–3 sentences)",
    },
    items: {
      type: "array",
      items: {},
      description:
        "A list of extracted, transformed, or classified items when the instruction yields multiple results",
    },
    labels: {
      type: "array",
      items: { type: "string" },
      description: "Classification labels or tags assigned to the text, if applicable",
    },
    score: {
      type: ["number", "null"],
      description: "A numeric score or rating if the instruction requests one (e.g. sentiment score, relevance)",
    },
    metadata: {
      type: "object",
      description: "Supporting metadata inferred from the text or the processing result",
      properties: {
        language: { type: ["string", "null"] },
        word_count: { type: ["number", "null"] },
        text_type: { type: ["string", "null"] },
      },
    },
  },
  // Keep schema permissive by not requiring a specific top-level property.
  required: [],
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function runReporter(
  client: OpencodeClient,
  req: ReporterRequest,
): Promise<ReporterResponse> {
  // 1. Create an isolated session for this request
  const sessionResult = await client.session.create({
    body: { title: `reporter-${Date.now()}` },
  })

  if (sessionResult.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(sessionResult.error)}`)
  }

  const session = sessionResult.data
  const sessionId = session.id

  try {
    const schema = inferSchema(req)
    const systemPrompt =
      req.system ??
      "Return only valid JSON that conforms to the provided schema. Use null for unknown values. Do not include explanatory text."

    // 2. Send to the reporter agent.
    //    The `format` field is supported by the OpenCode server API but not yet
    //    reflected in the SDK TypeScript types (SDK v1.4.17). We cast to bypass
    //    the type gap — the API accepts and processes it correctly at runtime.
    const promptResult = await client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "reporter",
        system: systemPrompt,
        parts: [{ type: "text", text: buildPrompt(req) }],
        format: { type: "json_schema", schema },
      } as unknown as Parameters<typeof client.session.prompt>[0]["body"],
    })

    if (promptResult.error) {
      throw new Error(`Reporter agent error: ${JSON.stringify(promptResult.error)}`)
    }

    // 3. Extract structured output.
    //    Prefer `structured` from the message info (server-side validated),
    //    fall back to parsing JSON from text parts if the SDK version is older.
    const info = promptResult.data?.info as Record<string, unknown> | undefined
    const parts = promptResult.data?.parts ?? []

    const result = extractStructuredOutput(info, parts)

    return { agent: "reporter", session_id: sessionId, result }
  } finally {
    // 4. Best-effort session cleanup
    await client.session.delete({ path: { id: sessionId } }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infers a reasonable schema based on the instruction.
 * If the user is asking for extraction (names, dates, entities, etc.),
 * provide a schema with an items array. Otherwise use the default schema.
 */
function inferSchema(req: ReporterRequest): Record<string, unknown> {
  if (req.output_schema) {
    return req.output_schema
  }

  // Check if instruction suggests extraction of multiple items
  const extractionKeywords = [
    "extract",
    "find all",
    "list all",
    "identify all",
    "get all",
    "parse",
  ]

  const isExtraction = extractionKeywords.some((kw) =>
    req.instruction.toLowerCase().includes(kw),
  )

  if (isExtraction) {
    // Try to infer the entity type from the instruction
    const instruction = req.instruction.toLowerCase()
    let arrayName = "items"

    if (instruction.includes("person") || instruction.includes("people") || instruction.includes("names")) {
      arrayName = "people"
    } else if (instruction.includes("date")) {
      arrayName = "dates"
    } else if (instruction.includes("entit")) {
      arrayName = "entities"
    } else if (instruction.includes("event")) {
      arrayName = "events"
    }

    return {
      type: "object",
      properties: {
        [arrayName]: {
          type: "array",
          items: {
            type: "object",
            description: `Extracted ${arrayName} from the text`,
          },
        },
      },
      required: [arrayName],
    }
  }

  return DEFAULT_SCHEMA
}

function buildPrompt(req: ReporterRequest): string {
  return `## Instruction\n\n${req.instruction}\n\n## Text\n\n${req.text}`
}

/**
 * Extract the JSON result from the response.
 * Tries `info.structured` first (server-validated JSON schema output),
 * then falls back to `info.structured_output` for backwards compatibility,
 * then falls back to finding a JSON code block in the assistant text parts.
 */
function extractStructuredOutput(
  info: Record<string, unknown> | undefined,
  parts: unknown[],
): Record<string, unknown> {
  // Primary: server-side structured output (current format)
  if (info?.structured && typeof info.structured === "object") {
    return info.structured as Record<string, unknown>
  }

  // Backwards compatibility: older format
  if (info?.structured_output && typeof info.structured_output === "object") {
    return info.structured_output as Record<string, unknown>
  }

  // Fallback: parse JSON from the first text part
  for (const part of parts) {
    const p = part as Record<string, unknown>
    if (p.type === "text" && typeof p.text === "string") {
      const parsed = tryParseJson(p.text)
      if (parsed) return parsed
    }
  }

  // Provide a concise diagnostic to help debug why structured output wasn't found.
  // Log a short preview (best-effort) and include minimal info in the thrown error.
  const hasStructured = !!(
    (info?.structured && typeof info.structured === "object") ||
    (info?.structured_output && typeof info.structured_output === "object")
  )
  const partsCount = parts.length
  let preview = ""
  if (partsCount > 0) {
    const first = parts[0] as Record<string, unknown>
    if (typeof first.text === "string") {
      preview = first.text.slice(0, 1000)
    }
  }

  console.error(
    `[reporter] Structured output not found. structured_output=${String(hasStructured)} parts=${partsCount} preview="${
      preview.slice(0, 200)
    }"`,
  )

  throw new Error(
    `Reporter agent did not return structured JSON output. structured_output=${String(
      hasStructured,
    )} parts=${partsCount} preview=${preview ? preview.slice(0, 200) : "(none)"}. ` +
      "Ensure the reporter agent is configured and the model supports structured output. " +
      "You can call GET /agents to verify the agent is present on the server.",
  )
}

function tryParseJson(text: string): Record<string, unknown> | null {
  // Try raw parse first
  try {
    const v = JSON.parse(text.trim())
    if (v && typeof v === "object" && !Array.isArray(v)) return v
  } catch {
    // ignore
  }

  // Try extracting from a ```json ... ``` code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    try {
      const v = JSON.parse(match[1].trim())
      if (v && typeof v === "object" && !Array.isArray(v)) return v
    } catch {
      // ignore
    }
  }

  return null
}
