package com.example.azurepipelineenhancement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class MinistackServiceTests {

    private final MinistackService ministackService = new MinistackService();

    @Test
    void exposesAllConfiguredEnvironments() {
        assertEquals(3, ministackService.getEnvironmentSummaries().size());
    }

    @Test
    void deploySimulationMarksServiceHealthy() {
        ministackService.triggerDeploy("DEV", "catalog-service", "Local Tester");

        MinistackService.EnvironmentStatusResponse status =
            ministackService.getEnvironmentStatus("DEV");
        MinistackService.ServiceStatusResponse catalogService = status.services().stream()
            .filter(service -> service.serviceName().equals("catalog-service"))
            .findFirst()
            .orElseThrow();

        assertEquals("Local Tester", catalogService.lastDeployedBy());
        assertEquals(catalogService.desiredCount(), catalogService.runningCount());
        assertEquals("Healthy", catalogService.health());
        assertTrue(catalogService.imageTag().startsWith("dev-"));
        assertFalse(catalogService.lastDeploymentTime().toString().isBlank());
    }
}
