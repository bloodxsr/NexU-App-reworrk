@echo off
REM Check status of Scylla, MinIO, Meilisearch, and Postgres containers
setlocal EnableDelayedExpansion

set SERVICES=scylla-node1 scylla-node2 scylla-node3 minio meilisearch postgres

for %%S in (%SERVICES%) do (
    echo Checking %%S status...
    docker ps --filter "name=nexu-%%S" --format "table {{.Names}}\t{{.Status}}" | findstr /I "nexu-%%S" >nul
    if !errorlevel! == 0 (
        docker inspect -f "Status: {{.State.Status}}, Running: {{.State.Running}}, StartedAt: {{.State.StartedAt}}" nexu-%%S
    ) else (
        echo     Container nexu-%%S is NOT running.
    )
)

REM Check if ports are in use (optional, for more detail)
REM netstat -ano | findstr :9042 :9043 :9044 :9000 :9001 :7700 :5432

echo.
echo Database/service status check complete.
endlocal
pause
