#!/bin/bash

echo "      Starting NexU Fullstack App        "

echo -e "\n[1/5] Pulling Docker images..."
docker pull scylladb/scylla:latest
docker pull minio/minio:latest
docker pull getmeili/meilisearch:v1.13
docker pull postgres:16

echo -e "\n[2/5] Starting Scylla + MinIO + Meilisearch + PostgreSQL..."
docker compose up -d scylla-node1 scylla-node2 scylla-node3 minio meilisearch postgres

echo -e "\n[3/5] Loading environment variables..."
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

echo -e "\n[4/5] Starting Rust Backend..."
cargo run --manifest-path backend/Cargo.toml &
BACKEND_PID=$!

echo -e "\n[5/5] Starting Vite Frontend..."
cd frontend || exit 1
npm run dev &
FRONTEND_PID=$!

echo -e "\nAll services are starting up!"
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

cleanup() {
    echo -e "\nStopping all services..."
    kill $BACKEND_PID
    kill $FRONTEND_PID
    docker compose stop
    exit
}

trap cleanup SIGINT
wait
