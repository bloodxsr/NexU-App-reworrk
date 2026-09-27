# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# Stage 2: Build the Rust backend
FROM rust:1.91-slim-bookworm AS backend-builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend ./backend
RUN cd backend && cargo build --release

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy the frontend build artifacts
COPY --from=frontend-builder /app/frontend/dist ./dist

# Copy the compiled Rust binary
COPY --from=backend-builder /app/backend/target/release/nexu-backend ./

# Create the data directory for Docker volumes and copy static docs
RUN mkdir -p data
COPY docs ./docs

# Expose the API and Web port
EXPOSE 3001

# Run the backend
CMD ["./nexu-backend"]
