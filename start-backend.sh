#!/bin/bash
cd /home/0xKaBG/Projects/athttt_2025.2/backend
pkill -f "uvicorn backend.main:app" 2>/dev/null || true
sleep 1
PYTHONPATH=/home/0xKaBG/Projects/athttt_2025.2 nohup uv run uvicorn backend.main:app --port 8000 --host 0.0.0.0 > /tmp/backend.log 2>&1 &
echo "Backend started PID: $!"
sleep 3
curl -s http://localhost:8000/health && echo " - Backend healthy on 8000"