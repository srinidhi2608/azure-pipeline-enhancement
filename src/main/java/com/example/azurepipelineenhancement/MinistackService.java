package com.example.azurepipelineenhancement;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class MinistackService {

    private static final DateTimeFormatter TAG_DATE = DateTimeFormatter.ofPattern("yyyy.MM.dd");
    private final Map<String, EnvironmentState> environments = new ConcurrentHashMap<>();

    public MinistackService() {
        environments.put("DEV", new EnvironmentState(
            "DEV",
            "Development",
            "env-dev",
            "ministack-dev-cluster",
            List.of(
                new ServiceState("orders-service", 2, 2, "dev-2026.06.30.4", "Srinidhi", Instant.parse("2026-06-30T14:15:00Z")),
                new ServiceState("catalog-service", 2, 1, "dev-2026.06.30.3", "Platform Bot", Instant.parse("2026-06-30T14:08:00Z")),
                new ServiceState("payments-service", 1, 1, "dev-2026.06.30.2", "Release Manager", Instant.parse("2026-06-30T13:55:00Z"))
            )
        ));
        environments.put("UAT", new EnvironmentState(
            "UAT",
            "User Acceptance",
            "env-uat",
            "ministack-uat-cluster",
            List.of(
                new ServiceState("orders-service", 2, 2, "uat-2026.06.30.2", "QA Lead", Instant.parse("2026-06-30T13:30:00Z")),
                new ServiceState("catalog-service", 2, 2, "uat-2026.06.30.2", "QA Lead", Instant.parse("2026-06-30T13:18:00Z")),
                new ServiceState("payments-service", 1, 1, "uat-2026.06.30.1", "Platform Bot", Instant.parse("2026-06-30T12:50:00Z"))
            )
        ));
        environments.put("PROD", new EnvironmentState(
            "PROD",
            "Production",
            "env-prod",
            "ministack-prod-cluster",
            List.of(
                new ServiceState("orders-service", 3, 3, "prod-2026.06.29.8", "Release Manager", Instant.parse("2026-06-29T21:05:00Z")),
                new ServiceState("catalog-service", 3, 3, "prod-2026.06.29.8", "Release Manager", Instant.parse("2026-06-29T20:48:00Z")),
                new ServiceState("payments-service", 2, 2, "prod-2026.06.29.7", "Operations", Instant.parse("2026-06-29T20:20:00Z"))
            )
        ));
    }

    public List<EnvironmentSummaryResponse> getEnvironmentSummaries() {
        return environments.values().stream()
            .sorted(Comparator.comparing(EnvironmentState::environment))
            .map(this::toSummary)
            .toList();
    }

    public EnvironmentStatusResponse getEnvironmentStatus(String environmentName) {
        EnvironmentState environment = getRequiredEnvironment(environmentName);
        synchronized (environment) {
            environment.lastUpdated = Instant.now();
            return toStatus(environment);
        }
    }

    public DeployResponse triggerDeploy(String environmentName, String serviceName, String requestedBy) {
        EnvironmentState environment = getRequiredEnvironment(environmentName);
        synchronized (environment) {
            ServiceState service = environment.services.stream()
                .filter(candidate -> candidate.serviceName.equalsIgnoreCase(serviceName))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Unknown service: " + serviceName
                ));

            Instant deployedAt = Instant.now();
            service.runningCount = service.desiredCount;
            service.imageTag = nextImageTag(environment.environment, service.imageTag, deployedAt);
            service.lastDeployedBy = (requestedBy == null || requestedBy.isBlank()) ? "Local operator" : requestedBy;
            service.lastDeploymentTime = deployedAt;
            environment.lastUpdated = deployedAt;

            return new DeployResponse(
                environment.environment,
                service.serviceName,
                service.imageTag,
                service.lastDeployedBy,
                deployedAt,
                "Deployment simulated successfully in ministack."
            );
        }
    }

    private EnvironmentState getRequiredEnvironment(String environmentName) {
        String normalized = normalizeEnvironment(environmentName);
        EnvironmentState environment = environments.get(normalized);
        if (environment == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown environment: " + environmentName);
        }
        return environment;
    }

    private String normalizeEnvironment(String environmentName) {
        return Objects.requireNonNullElse(environmentName, "")
            .trim()
            .toUpperCase(Locale.ROOT);
    }

    private EnvironmentSummaryResponse toSummary(EnvironmentState environment) {
        long healthyServices = environment.services.stream()
            .filter(service -> service.runningCount >= service.desiredCount)
            .count();
        int desiredTasks = environment.services.stream().mapToInt(service -> service.desiredCount).sum();
        int runningTasks = environment.services.stream().mapToInt(service -> service.runningCount).sum();

        return new EnvironmentSummaryResponse(
            environment.environment,
            environment.displayName,
            environment.theme,
            environment.clusterName,
            healthyServices,
            environment.services.size(),
            desiredTasks,
            runningTasks,
            environment.lastUpdated
        );
    }

    private EnvironmentStatusResponse toStatus(EnvironmentState environment) {
        List<ServiceStatusResponse> services = environment.services.stream()
            .map(service -> new ServiceStatusResponse(
                service.serviceName,
                service.desiredCount,
                service.runningCount,
                service.imageTag,
                service.lastDeployedBy,
                service.lastDeploymentTime,
                service.runningCount >= service.desiredCount ? "Healthy" : "Needs attention"
            ))
            .toList();

        return new EnvironmentStatusResponse(
            environment.environment,
            environment.displayName,
            environment.theme,
            environment.clusterName,
            environment.lastUpdated,
            services
        );
    }

    private String nextImageTag(String environment, String currentTag, Instant deployedAt) {
        String[] parts = currentTag == null ? new String[0] : currentTag.split("\\.");
        int revision = 1;
        if (parts.length > 0) {
            try {
                revision = Integer.parseInt(parts[parts.length - 1]) + 1;
            } catch (NumberFormatException ignored) {
                revision = 1;
            }
        }

        String prefix = environment.toLowerCase(Locale.ROOT);
        String date = TAG_DATE.format(LocalDate.ofInstant(deployedAt, ZoneOffset.UTC));
        return prefix + "-" + date + "." + revision;
    }

    private static final class EnvironmentState {
        private final String environment;
        private final String displayName;
        private final String theme;
        private final String clusterName;
        private final List<ServiceState> services;
        private Instant lastUpdated;

        private EnvironmentState(
            String environment,
            String displayName,
            String theme,
            String clusterName,
            List<ServiceState> services
        ) {
            this.environment = environment;
            this.displayName = displayName;
            this.theme = theme;
            this.clusterName = clusterName;
            this.services = new ArrayList<>(services);
            this.lastUpdated = services.stream()
                .map(service -> service.lastDeploymentTime)
                .max(Comparator.naturalOrder())
                .orElse(Instant.now());
        }

        private String environment() {
            return environment;
        }
    }

    private static final class ServiceState {
        private final String serviceName;
        private final int desiredCount;
        private int runningCount;
        private String imageTag;
        private String lastDeployedBy;
        private Instant lastDeploymentTime;

        private ServiceState(
            String serviceName,
            int desiredCount,
            int runningCount,
            String imageTag,
            String lastDeployedBy,
            Instant lastDeploymentTime
        ) {
            this.serviceName = serviceName;
            this.desiredCount = desiredCount;
            this.runningCount = runningCount;
            this.imageTag = imageTag;
            this.lastDeployedBy = lastDeployedBy;
            this.lastDeploymentTime = lastDeploymentTime;
        }
    }

    public record EnvironmentSummaryResponse(
        String environment,
        String displayName,
        String theme,
        String clusterName,
        long healthyServices,
        int totalServices,
        int desiredTasks,
        int runningTasks,
        Instant lastUpdated
    ) {
    }

    public record EnvironmentStatusResponse(
        String environment,
        String displayName,
        String theme,
        String clusterName,
        Instant lastUpdated,
        List<ServiceStatusResponse> services
    ) {
    }

    public record ServiceStatusResponse(
        String serviceName,
        int desiredCount,
        int runningCount,
        String imageTag,
        String lastDeployedBy,
        Instant lastDeploymentTime,
        String health
    ) {
    }

    public record DeployResponse(
        String environment,
        String serviceName,
        String imageTag,
        String requestedBy,
        Instant deployedAt,
        String message
    ) {
    }
}
