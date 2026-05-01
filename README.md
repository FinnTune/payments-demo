# README.md
# Payments — reference implementation

A production-shaped payment processing system: Java + Spring backend,
TypeScript + React frontend, Python reconciliation job, AWS infrastructure
via CDK, and a complete CI/CD pipeline running on GitHub Actions with OIDC
into AWS.

## Quickstart — local
```bash
docker compose up --build
# Backend  → http://localhost:8080
# Frontend → http://localhost:5173
```