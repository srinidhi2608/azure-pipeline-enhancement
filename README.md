# azure-pipeline-enhancement

Spring Boot 4 sample (Java 25) with Docker + Docker Compose and Azure Pipelines environment YAMLs.

## Run locally

```bash
mvn clean package
docker compose up --build
```

Application health endpoint: `http://localhost:8080/health`

## Azure Pipelines files

- `azure-pipelines.yml`: shared pipeline template
- `DEV.yml`: DEV pipeline entrypoint
- `UAT.yml`: UAT pipeline entrypoint
- `PROD.yml`: PROD pipeline entrypoint
