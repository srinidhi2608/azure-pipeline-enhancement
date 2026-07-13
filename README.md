# azure-pipeline-enhancement

Spring Boot 4 sample (Java 25) with Docker + Docker Compose and Azure Pipelines environment YAMLs.

## Run locally

```bash
mvn clean package
docker compose up --build
```

Application health endpoint: `http://localhost:8080/health`

Local colorful monitor page with ministack-backed environment data: `http://localhost:8080/monitor`

## Azure Pipelines files

- `azure-pipelines.yml`: shared pipeline template
- `DEV.yml`: DEV pipeline entrypoint
- `UAT.yml`: UAT pipeline entrypoint
- `PROD.yml`: PROD pipeline entrypoint

## Azure DevOps Dashboard Widget Extension (ECS Monitor)

Boilerplate for a custom Azure DevOps dashboard widget is available under:

- `ado-widget-extension/vss-extension.json`
- `ado-widget-extension/widget/widget.html`
- `ado-widget-extension/widget/widget.css`
- `ado-widget-extension/widget/widget.js`
- `ado-widget-extension/scripts/ecs-status.sh`

### Widget capabilities included

- Azure DevOps extension manifest with dashboard widget contribution.
- Requested OAuth scopes for pipeline read/execute:
  - `vso.build`
  - `vso.build_execute`
- UI table columns:
  - Service Name
  - ECS Health (green/red indicator)
  - Deployed Image Tag
  - Last Deployed By
  - Desired / Running task count
  - Action (Deploy button)
- JavaScript logic to:
  - fetch latest pipeline run and trigger user from Azure DevOps REST API
  - queue a new pipeline build when Deploy is clicked
  - call a placeholder AWS endpoint for ECS health/image data
  - switch between DEV, UAT, and PROD with environment-specific colors
  - fall back to local ministack mode for standalone testing

## Local ministack testing

The Spring Boot app now exposes a lightweight ministack simulator for local ECS-style testing.

- `GET /api/ministack/environments`
- `GET /api/ministack/environments/{DEV|UAT|PROD}/status`
- `POST /api/ministack/environments/{environment}/services/{service}/deploy`

Run the app, then open:

```bash
http://localhost:8080/monitor
```

This uses the same widget assets under `ado-widget-extension/widget` and shows a colorful environment selector for DEV, UAT, and PROD.

### Configure before use

1. Update `publisher` in `vss-extension.json` to your Azure DevOps publisher id.
2. Update service-to-pipeline mappings in `widget.js`:
   - `pipelineDefinitionId`
   - `branch`
   - service names
3. Replace `awsStatusEndpoint` in `widget.js` with your API Gateway/Lambda endpoint.

### Package and upload extension

1. Install TFX CLI:

   ```bash
   npm install -g tfx-cli
   ```

2. Create VSIX package:

   ```bash
   cd ado-widget-extension
   tfx extension create --manifest-globs vss-extension.json
   ```

3. Upload to your Azure DevOps org:
   - Go to Organization Settings → Extensions → Manage extensions.
   - Select **Upload new extension**.
   - Upload the generated `.vsix` file.

4. Add widget to dashboard:
   - Open your Azure DevOps Dashboard.
   - Click **Edit** → **Add a widget**.
   - Find **ECS Deployment Monitor** and add it.

### AWS backend script usage

Run the ECS status helper script from a backend host/runner with AWS CLI + jq:

```bash
export CLUSTER_NAME="my-ecs-cluster"
export AWS_REGION="us-east-1"
export SERVICES="orders-service,catalog-service"
ado-widget-extension/scripts/ecs-status.sh
```

The script outputs JSON array items containing:
- `serviceName`
- `desiredCount`
- `runningCount`
- `imageTag`

### Local live updates with ministack

Use the same script locally against the embedded ministack simulator:

```bash
export STACK_MODE="ministack"
export ENVIRONMENT="DEV"
ado-widget-extension/scripts/ecs-status.sh
```

To keep receiving live local updates:

```bash
export STACK_MODE="ministack"
export ENVIRONMENT="UAT"
export WATCH="true"
export WATCH_INTERVAL_SECONDS="5"
ado-widget-extension/scripts/ecs-status.sh
```
