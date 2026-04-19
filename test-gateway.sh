#!/bin/bash

# Kill any existing gateway processes
pkill -9 -f "tsx watch" 2>/dev/null
pkill -9 -f "opencode serve" 2>/dev/null
lsof -ti :3000 :4096 2>/dev/null | xargs -r kill -9
sleep 2

echo "Starting gateway..."
cd "$(dirname "$0")"
npm run dev > /tmp/gateway-test.log 2>&1 &
GATEWAY_PID=$!

# Wait for gateway to be ready
for i in {1..30}; do
  if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "Gateway is ready!"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "Gateway failed to start. Check /tmp/gateway-test.log"
    kill $GATEWAY_PID 2>/dev/null
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Test 1: GET /health ==="
curl -s http://localhost:3000/health | jq

echo ""
echo "=== Test 2: GET /agents ==="
curl -s http://localhost:3000/agents | jq

echo ""
echo "=== Test 3: POST /run (reporter - person extraction) ==="
curl -s -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all person names and their roles from the text",
    "text": "The meeting was attended by Alice Chen (CTO), Bob Smith (Lead Engineer), and Carol White (Product Manager)."
  }' | jq

echo ""
echo "=== Test 4: POST /run (reporter - date extraction) ==="
curl -s -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all dates mentioned in the text",
    "text": "The project started on January 15, 2024, with the first milestone on Feb 20th and final delivery scheduled for March 30, 2024."
  }' | jq

echo ""
echo "Tests complete. Cleaning up..."
kill $GATEWAY_PID 2>/dev/null
sleep 1
pkill -9 -f "opencode serve" 2>/dev/null
