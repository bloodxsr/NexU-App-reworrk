@echo off
setlocal enabledelayedexpansion

echo       Starting NexU Fullstack App

echo.
echo Checking status of database and service containers...
call check_db_status.bat
echo.
echo Proceeding to start services...

echo.
echo [1/5] Pulling Docker images...
docker pull scylladb/scylla:latest
docker pull minio/minio:latest
docker pull getmeili/meilisearch:v1.13
docker pull postgres:16

echo.
echo [2/5] Starting infra containers...
docker compose up -d scylla-node1

echo.
echo [3/5] Waiting for Scylla Node 1 to be healthy...
:wait_loop
timeout /t 5 /nobreak >nul
docker exec nexu-scylla-node1 cqlsh -e "SELECT now() FROM system.local" >nul 2>&1
if %errorlevel% neq 0 (
    echo     Still waiting for Node 1...
    goto wait_loop
)
echo     Node 1 is ready!

docker compose up -d scylla-node2 scylla-node3 minio meilisearch postgres

echo.
echo [4/5] Loading environment variables from .env...
if exist .env (
    for /f "usebackq tokens=*" %%i in (".env") do (
        set "line=%%i"
        if "!line:~0,1!" neq "#" (
            set "%%i"
        )
    )
)

echo.
echo [5/5] Starting Rust Backend (opens in new window)...
start "NexU Backend" cmd /k "title NexU Backend && cargo run --manifest-path backend/Cargo.toml"

echo.
echo [6/6] Starting Vite Frontend (opens in new window)...
start "NexU Frontend" cmd /k "title NexU Frontend && cd frontend && npm install && npm run dev"

echo.
echo All services started successfully!
echo You can close this window.
pause
