#!/bin/bash

echo "Test 1: Extract person names and roles"
curl -s -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all person names and their roles from the text",
    "text": "The meeting was attended by Alice Chen (CTO), Bob Smith (Lead Engineer), and Carol White (Product Manager)."
  }' | jq

echo ""
echo "Test 2: Custom schema for sentiment analysis"
curl -s -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Classify the sentiment and extract key topics",
    "text": "The product launch was amazing! Everyone loved the new features, though some were concerned about the pricing.",
    "output_schema": {
      "type": "object",
      "properties": {
        "sentiment": { "type": "string", "enum": ["positive", "negative", "mixed", "neutral"] },
        "topics": { "type": "array", "items": { "type": "string" } },
        "concerns": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["sentiment", "topics"]
    }
  }' | jq

echo ""
echo "Test 3: Date extraction"
curl -s -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "reporter",
    "instruction": "Extract all dates mentioned in the text",
    "text": "The project started on January 15, 2024, with the first milestone on Feb 20th and final delivery scheduled for March 30, 2024."
  }' | jq
