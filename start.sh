#!/bin/bash

# F1 Card Tracker - Quick Start Script
# Run this when you reopen your laptop: ./start.sh

cd "$(dirname "$0")"

echo "Starting F1 Card Tracker..."
echo ""

# 1. Start backend
echo "[1/3] Starting backend on port 4000..."
npm start --prefix backend &
BACKEND_PID=$!
sleep 3

# 2. Start frontend
echo "[2/3] Starting frontend on port 5173..."
npm run dev --prefix frontend &
FRONTEND_PID=$!
sleep 3

# 3. Start Cloudflare tunnel
echo "[3/3] Starting Cloudflare tunnel..."
echo ""
cloudflared tunnel --url localhost:4000 &
TUNNEL_PID=$!
sleep 5

echo ""
echo "============================================"
echo "F1 Card Tracker is running!"
echo ""
echo "Local access:  http://localhost:5173"
echo ""
echo "IMPORTANT: Copy the Cloudflare URL above"
echo "and update PUBLIC_BASE_URL in .env file"
echo "============================================"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait and cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID $TUNNEL_PID 2>/dev/null; exit" INT TERM
wait
