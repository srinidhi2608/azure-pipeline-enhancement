package com.example.azurepipelineenhancement;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class HealthControllerTests {

    @Test
    void healthEndpointReturnsUp() {
        HealthController healthController = new HealthController();
        assertEquals("UP", healthController.health().get("status"));
    }
}
