#!/usr/bin/env bash
set -euo pipefail

# Optional:
#   AWS_REGION="us-east-1"
#   SERVICES="orders-service,catalog-service"
#   STACK_MODE="aws" or "ministack"
#   ENVIRONMENT="DEV"
#   LOCAL_STATUS_URL="http://localhost:8080/api/ministack/environments/DEV/status"
#   WATCH="true"
#   WATCH_INTERVAL_SECONDS="5"

AWS_REGION="${AWS_REGION:-us-east-1}"
SERVICES="${SERVICES:-}"
STACK_MODE="${STACK_MODE:-aws}"
ENVIRONMENT="${ENVIRONMENT:-DEV}"
WATCH="${WATCH:-false}"
WATCH_INTERVAL_SECONDS="${WATCH_INTERVAL_SECONDS:-5}"
LOCAL_STATUS_URL="${LOCAL_STATUS_URL:-http://localhost:8080/api/ministack/environments/${ENVIRONMENT}/status}"

output_ministack_status() {
  curl -fsSL "${LOCAL_STATUS_URL}" | jq '
    .services
    | map({
        serviceName,
        desiredCount,
        runningCount,
        imageTag,
        lastDeployedBy,
        lastDeploymentTime,
        health
      })
  '
}

output_aws_status() {
  : "${CLUSTER_NAME:?CLUSTER_NAME is required when STACK_MODE=aws}"

  if [[ -z "${SERVICES}" ]]; then
    mapfile -t SERVICE_NAMES < <(
      aws ecs list-services \
        --cluster "${CLUSTER_NAME}" \
        --region "${AWS_REGION}" \
        --query 'serviceArns[*]' \
        --output text | tr '\t' '\n' | awk -F'/' '{print $NF}'
    )
  else
    IFS=',' read -r -a SERVICE_NAMES <<< "${SERVICES}"
  fi

  if [[ "${#SERVICE_NAMES[@]}" -eq 0 ]]; then
    echo "[]"
    return 0
  fi

  RESULTS=()
  for SERVICE_NAME in "${SERVICE_NAMES[@]}"; do
    SERVICE_JSON="$(aws ecs describe-services \
      --cluster "${CLUSTER_NAME}" \
      --services "${SERVICE_NAME}" \
      --region "${AWS_REGION}" \
      --output json)"

    DESIRED_COUNT="$(jq -r '.services[0].desiredCount // 0' <<< "${SERVICE_JSON}")"
    RUNNING_COUNT="$(jq -r '.services[0].runningCount // 0' <<< "${SERVICE_JSON}")"
    TASK_DEF_ARN="$(jq -r '.services[0].taskDefinition // empty' <<< "${SERVICE_JSON}")"

    IMAGE_URI=""
    IMAGE_TAG="unknown"
    if [[ -n "${TASK_DEF_ARN}" ]]; then
      TASK_DEF_JSON="$(aws ecs describe-task-definition \
        --task-definition "${TASK_DEF_ARN}" \
        --region "${AWS_REGION}" \
        --output json)"

      IMAGE_URI="$(jq -r '.taskDefinition.containerDefinitions[0].image // ""' <<< "${TASK_DEF_JSON}")"

      if [[ "${IMAGE_URI}" == *"@"* ]]; then
        IMAGE_TAG="${IMAGE_URI##*@}"
      elif [[ "${IMAGE_URI}" == *":"* ]]; then
        IMAGE_TAG="${IMAGE_URI##*:}"
      fi
    fi

    RESULTS+=(
      "$(jq -n \
        --arg serviceName "${SERVICE_NAME}" \
        --argjson desiredCount "${DESIRED_COUNT}" \
        --argjson runningCount "${RUNNING_COUNT}" \
        --arg imageTag "${IMAGE_TAG}" \
        '{
          serviceName: $serviceName,
          desiredCount: $desiredCount,
          runningCount: $runningCount,
          imageTag: $imageTag
        }')"
    )
  done

  printf '%s\n' "${RESULTS[@]}" | jq -s '.'
}

output_status() {
  if [[ "${STACK_MODE}" == "ministack" ]]; then
    output_ministack_status
  else
    output_aws_status
  fi
}

if [[ "${WATCH}" == "true" ]]; then
  while true; do
    output_status
    sleep "${WATCH_INTERVAL_SECONDS}"
  done
else
  output_status
fi
