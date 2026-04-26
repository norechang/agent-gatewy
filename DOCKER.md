# Docker Deployment Guide

This guide covers deploying the OpenCode Agent Gateway using Docker Compose with separate services for the gateway and OpenCode server.

## Architecture

The deployment consists of two services:

1. **opencode-server**: Runs `opencode serve` with access to:
   - User-level OpenCode configuration (`~/.config/opencode`)
   - Project-level agent definitions (`.opencode/agents/`)
   - Agent dependencies (`.opencode/node_modules/`)

2. **gateway**: Runs the Hono HTTP gateway that connects to the OpenCode server

Both services communicate over a private Docker network.

## Prerequisites

### 1. Docker and Docker Compose

```bash
# Verify installation
docker --version          # Should be 20.10+
docker-compose --version  # Should be 1.29+ or 2.0+
```

### 2. OpenCode Configuration

The OpenCode server requires LLM provider credentials. You must configure these on your host machine before starting the containers.

```bash
# Install OpenCode CLI on your host
curl -fsSL https://opencode.ai/install | bash

# Run the TUI to configure your provider
opencode

# Inside the TUI, connect your provider
/connect
```

Follow the prompts to add your Anthropic, OpenAI, or other provider credentials. These will be saved to `~/.config/opencode/` and mounted into the container.

## Quick Start

### 1. Create environment file

```bash
cp .env.example .env
```

Edit `.env` if needed:

```bash
# Gateway port (exposed to host)
PORT=3000

# Path to OpenCode config (contains credentials)
# Leave commented to use $HOME/.config/opencode by default
# Or set to absolute path (no tilde expansion)
#OPENCODE_CONFIG_PATH=/home/username/.config/opencode
```

### 2. Start the services

```bash
docker-compose up -d
```

This will:
- Pull the Node.js base image
- Build the gateway container
- Start the OpenCode server (installs CLI, loads agents)
- Start the gateway (connects to server)

### 3. Check status

```bash
# View logs
docker-compose logs -f

# Check individual service logs
docker-compose logs -f opencode-server
docker-compose logs -f gateway

# Check health
curl http://localhost:3000/health
```

Expected output:
```json
{"ok":true,"service":"opencode-gateway"}
```

### 4. Test the gateway

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all person names from the text",
    "text": "The meeting was attended by Alice Chen (CTO) and Bob Smith (Engineer)."
  }'
```

## Managing the Deployment

### View running containers

```bash
docker-compose ps
```

### Stop services

```bash
docker-compose down
```

### Restart services

```bash
docker-compose restart

# Restart individual service
docker-compose restart gateway
docker-compose restart opencode-server
```

### View logs

```bash
# All services
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100

# Specific service
docker-compose logs -f gateway
```

### Rebuild after code changes

```bash
# Rebuild gateway image
docker-compose build gateway

# Rebuild and restart
docker-compose up -d --build
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Gateway HTTP port |
| `OPENCODE_CONFIG_PATH` | `$HOME/.config/opencode` | Path to OpenCode user config (must be absolute path) |

### Volume Mounts

The `docker-compose.yml` mounts:

1. **OpenCode user config** (`$HOME/.config/opencode` → `/root/.config/opencode`)
   - Contains LLM provider credentials
   - Mounted read-only for security
   - Uses `$HOME` environment variable (not `~`) for proper expansion

2. **Project agent definitions** (`./.opencode` → `/app/.opencode`)
   - Agent definition files (`agents/reporter.md`)
   - Agent dependencies (`node_modules/`)
   - Mounted read-only

### Ports

- `3000`: Gateway HTTP API (configurable via `PORT` env var)
- `4096`: OpenCode server (only accessible within Docker network)

## Adding Custom Agents

To add a new agent to the deployed gateway:

1. Create the agent definition file in `.opencode/agents/<name>.md`
2. Implement the handler in `src/agents/<name>.ts`
3. Register in `src/routes/agent.ts`
4. Rebuild and restart:

```bash
docker-compose down
docker-compose up -d --build
```

The new agent definition will be automatically loaded by the OpenCode server.

## Updating Agent Dependencies

If your agents require npm packages (defined in `.opencode/package.json`):

```bash
# On host, install dependencies
cd .opencode
npm install <package-name>

# Restart services to pick up new dependencies
docker-compose restart opencode-server
```

## Troubleshooting

### Container fails to start

```bash
# Check logs for errors
docker-compose logs opencode-server
docker-compose logs gateway

# Common issues:
# 1. Missing OpenCode config - verify ~/.config/opencode exists
# 2. Missing credentials - run `opencode` TUI and `/connect` on host
# 3. Port already in use - change PORT in .env
```

### OpenCode server not ready

```bash
# Check server health directly
docker exec opencode-server curl http://localhost:4096/health

# View detailed server logs
docker-compose logs -f opencode-server

# Restart server
docker-compose restart opencode-server
```

### Gateway cannot connect to server

```bash
# Verify network connectivity
docker exec opencode-gateway curl http://opencode-server:4096/health

# Check environment variable
docker exec opencode-gateway env | grep OPENCODE_SERVER_URL
# Should show: OPENCODE_SERVER_URL=http://opencode-server:4096
```

### Agent not found

```bash
# List available agents
curl http://localhost:3000/agents

# Verify agent definition exists
ls -la .opencode/agents/

# Check server logs for agent loading errors
docker-compose logs opencode-server | grep -i agent
```

### Permission denied errors

The OpenCode config directory must be readable by the container:

```bash
# Check permissions
ls -la ~/.config/opencode

# If needed, ensure files are readable
chmod -R go+r ~/.config/opencode
```

## Production Considerations

### 1. Resource Limits

Add resource constraints to `docker-compose.yml`:

```yaml
services:
  opencode-server:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  gateway:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

### 2. Logging

Configure log rotation:

```yaml
services:
  opencode-server:
    # ... existing config ...
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. Secrets Management

For production, avoid mounting `~/.config/opencode` directly. Instead:

**Option A: Environment variables**

```yaml
services:
  opencode-server:
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

**Option B: Docker secrets**

```yaml
services:
  opencode-server:
    secrets:
      - opencode_credentials

secrets:
  opencode_credentials:
    file: ./secrets/opencode-config.json
```

### 4. HTTPS/TLS

Run behind a reverse proxy (nginx, traefik, caddy):

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - gateway
```

### 5. Monitoring

Add health check endpoints to your monitoring system:

- Gateway: `http://localhost:3000/health`
- Available agents: `http://localhost:3000/agents`

### 6. Scaling

To run multiple gateway instances:

```yaml
services:
  gateway:
    # ... existing config ...
    deploy:
      replicas: 3
```

Note: All gateway instances share the same OpenCode server.

## Stopping and Cleanup

```bash
# Stop services (preserves containers)
docker-compose stop

# Stop and remove containers
docker-compose down

# Remove containers, networks, and volumes
docker-compose down -v

# Remove images as well
docker-compose down --rmi all
```

## Migration from Local Development

If you're already running the gateway locally:

1. Stop the local instance: `Ctrl+C`
2. Start Docker services: `docker-compose up -d`
3. Update any scripts/tools to use the new endpoint (same URL if using default port)

The Docker deployment uses the same OpenCode configuration, so no reconfiguration is needed.
