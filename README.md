# OpenCode Agent Gateway

A lightweight HTTP gateway that exposes [OpenCode](https://opencode.ai) agents as structured JSON API endpoints. Built with [Hono](https://hono.dev) and the official [`@opencode-ai/sdk`](https://opencode.ai/docs/sdk).

---

## How it works

```
HTTP Client
    │  POST /run  { agent, instruction, text }
    ▼
OpenCode Gateway  (Hono, port 3000)
    │  @opencode-ai/sdk
    ▼
opencode serve  (spawned subprocess, port 4096)
    │
    ▼
Agent (reporter, ...) → LLM Provider
```

The gateway spawns `opencode serve` as a managed subprocess on startup. Each inbound `/run` request creates an isolated OpenCode session, routes it to the named agent, waits for the structured JSON result, cleans up the session, and returns the result to the caller.

---

## Project structure

```
opencode-gateway/
├── src/
│   ├── index.ts              # Gateway entry point + graceful shutdown
│   ├── opencode.ts           # OpenCode server lifecycle manager
│   ├── agents/
│   │   └── reporter.ts       # Reporter agent handler + JSON schema
│   └── routes/
│       └── agent.ts          # POST /run dispatcher
├── .opencode/
│   └── agents/
│       └── reporter.md       # OpenCode reporter agent definition
├── package.json
└── tsconfig.json
```

---

## Prerequisites

### 1. Node.js 18 or later

```bash
node --version   # must be >= 18
```

### 2. OpenCode CLI

The gateway spawns the `opencode` binary as a subprocess. It must be installed and available in `PATH`.

```bash
# Using the install script (recommended)
curl -fsSL https://opencode.ai/install | bash

# Or via npm
npm install -g opencode-ai

# Verify
opencode --version
```

### 3. Configure an LLM provider via the OpenCode TUI

OpenCode requires at least one LLM provider to be configured before the gateway can run. Use the interactive TUI to connect your provider — credentials are saved to `~/.config/opencode/` and reused automatically by the spawned server.

```bash
# Launch the TUI from any directory
opencode
```

Inside the TUI, run the connect command and follow the prompts:

```
/connect
```

Select your provider (Anthropic, OpenAI, etc.), enter your API key when prompted, and confirm. Once connected, exit the TUI with `Ctrl+C` or `q`.

> This step only needs to be done once per machine. The credentials persist across gateway restarts.

---

## Development

### Install dependencies

```bash
npm install
```

### Start the gateway

```bash
npm run dev
```

Expected output:

```
[gateway] Starting OpenCode Agent Gateway...
[opencode] Spawning managed opencode server...
[opencode] Server ready at http://127.0.0.1:4096
[gateway] Agent validation passed: reporter
[gateway] Listening on http://127.0.0.1:3000
[gateway] POST http://127.0.0.1:3000/run  — invoke an agent
```

The gateway validates on startup that all locally-registered agents are available in the OpenCode server. If any agents are missing, the gateway will report an error with actionable recommendations and terminate.

**Example validation failure:**

```
[gateway] Starting OpenCode Agent Gateway...
[opencode] Spawning managed opencode server...
[opencode] Server ready at http://127.0.0.1:4096

[gateway] Gateway agent validation failed. The following agents are registered in the gateway but not found in OpenCode:

  - myagent

Recommendation:
1. Verify that agent definition files exist in .opencode/agents/ directory:
   - .opencode/agents/myagent.md
2. Restart the OpenCode server to load new agent definitions
3. Check agent definition file format (must have valid frontmatter with mode, description, etc.)
4. Run 'opencode serve' manually to see detailed error messages
```

---

## Available Agents

The gateway currently supports **1 agent**:

- **`reporter`** — A text processing specialist for extraction, transformation, classification, summarization, and analysis tasks. [See details below](#reporter).

Additional agents can be added by:
1. Creating an agent definition in `.opencode/agents/<name>.md`
2. Implementing the handler in `src/agents/<name>.ts`
3. Registering it in `src/routes/agent.ts`

See [Adding a new agent](#adding-a-new-agent) for details.

---

## API Endpoints

The gateway exposes three HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check for monitoring |
| `/agents` | GET | List gateway-registered agents |
| `/run` | POST | Execute an agent with instruction and text |

---

### `GET /health`

Health check endpoint for monitoring and load balancers.

**Response:**

```json
{ "ok": true, "service": "opencode-gateway" }
```

**Example:**

```bash
curl http://localhost:3000/health
```

---

### `GET /agents`

Lists all agents registered in the gateway (does not include OpenCode system-level agents).

**Response:**

```json
{
  "agents": [
    {
      "name": "reporter",
      "description": "A text processing specialist that executes arbitrary text transformation, extraction, classification, and analysis tasks as directed by the caller's instruction prompt. Always returns structured JSON results."
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/agents
```

---

### `POST /run`

Invokes an agent with an instruction and text input, returns a structured JSON result.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent` | string | yes | Agent name to invoke (e.g. `"reporter"`) |
| `instruction` | string | yes | Natural language instruction describing the task |
| `text` | string | yes | The text content to be processed |
| `output_schema` | object | no | Custom [JSON Schema](https://json-schema.org) for the response shape. If omitted, a schema is inferred from the instruction. |
| `system` | string | no | Custom system prompt override. Default: `"Return only valid JSON that conforms to the provided schema. Use null for unknown values. Do not include explanatory text."` |

**Response body:**

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` on success, `false` on error |
| `agent` | string | Name of the agent that handled the request |
| `session_id` | string | OpenCode session ID (for debugging) |
| `result` | object | Structured JSON output from the agent |
| `error` | string | Error message (only present when `ok` is `false`) |

---

## Agents

### `reporter`

A text processing specialist. Accepts any instruction and text, and always returns a structured JSON result.

**Capabilities:** extraction, transformation, classification, summarization, translation, scoring, reformatting, and any other text operation described in the instruction.

**Schema inference:**

The reporter agent automatically infers an appropriate output schema based on keywords in your instruction:

- **Extraction tasks** (contains "extract", "find all", "list all", etc.) → Returns an array with a field name inferred from the entity type:
  - People/names → `{ people: [...] }`
  - Dates → `{ dates: [...] }`
  - Events → `{ events: [...] }`
  - Entities → `{ entities: [...] }`
  - Other → `{ items: [...] }`

- **Other tasks** → Returns a flexible schema with optional fields:
  - `summary` — Brief summary of results (1-3 sentences)
  - `items` — Array of extracted items
  - `labels` — Classification tags
  - `score` — Numeric score or rating
  - `metadata` — Supporting information (language, word_count, text_type)

Supply `output_schema` in the request body to override automatic inference with a task-specific shape.

**Example — named entity extraction:**

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all person names and their roles from the text",
    "text": "The meeting was attended by Alice Chen (CTO), Bob Smith (Lead Engineer), and Carol White (Product Manager)."
  }'
```

```json
{
  "ok": true,
  "agent": "reporter",
  "session_id": "ses_...",
  "result": {
    "people": [
      { "name": "Alice Chen",   "role": "CTO" },
      { "name": "Bob Smith",    "role": "Lead Engineer" },
      { "name": "Carol White",  "role": "Product Manager" }
    ]
  }
}
```

**Example — sentiment classification with a custom schema:**

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Classify the sentiment and extract the main complaint topic",
    "text": "I have been waiting 3 weeks for my order and still nothing. This is completely unacceptable.",
    "output_schema": {
      "type": "object",
      "properties": {
        "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral"] },
        "topic":     { "type": "string" },
        "urgency":   { "type": "string", "enum": ["low", "medium", "high"] }
      },
      "required": ["sentiment", "topic", "urgency"]
    }
  }'
```

```json
{
  "ok": true,
  "agent": "reporter",
  "session_id": "ses_...",
  "result": {
    "sentiment": "negative",
    "topic": "delayed order",
    "urgency": "high"
  }
}
```

---

## Deployment

### Additional prerequisites

- **Node.js 18+** on the target machine or container
- **OpenCode CLI** installed and in `PATH` (same install steps as development)
- **Provider credentials configured** — run the TUI `/connect` flow once on the deployment machine before starting the gateway service

### Bind address

By default the gateway binds to `127.0.0.1`. When running inside a container or VM, set `HOSTNAME=0.0.0.0` so the port is reachable from outside:

```bash
HOSTNAME=0.0.0.0 npm start
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Gateway listen port |
| `HOSTNAME` | `127.0.0.1` | Gateway bind address |
| `OPENCODE_SERVER_URL` | _(unset)_ | Connect to an already-running `opencode serve` instance instead of spawning one |

### Running opencode as a separate service (optional)

For production it can be preferable to run `opencode serve` as a separate sidecar so that the gateway can be restarted independently:

```bash
# Start opencode server
opencode serve --port 4096

# Start gateway, pointing at the running server
OPENCODE_SERVER_URL=http://localhost:4096 npm start
```

### Dockerfile example

```dockerfile
FROM node:20-slim

# Install opencode CLI
RUN curl -fsSL https://opencode.ai/install | bash

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000
CMD ["npm", "start"]
```

> **Important:** Provider credentials must be configured on the host and mounted into the container, or the `/connect` flow must be run inside the container before the gateway starts.
>
> ```bash
> # Mount host opencode config into the container
> docker run -v ~/.config/opencode:/root/.config/opencode -p 3000:3000 opencode-gateway
> ```

---

## Adding a new agent

1. Create `.opencode/agents/<name>.md` with the agent's system prompt and configuration.
2. Create `src/agents/<name>.ts` with the request/response types, JSON schema, and handler function.
3. Register the agent in `src/routes/agent.ts` — add the name to the `AgentName` union type, add an entry to the `AGENTS` map, and add field validation in the route handler.
