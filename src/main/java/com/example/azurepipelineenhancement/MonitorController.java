package com.example.azurepipelineenhancement;

import java.util.List;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class MonitorController {

    private final MinistackService ministackService;

    public MonitorController(MinistackService ministackService) {
        this.ministackService = ministackService;
    }

    @GetMapping("/")
    public String index() {
        return "redirect:/monitor";
    }

    @GetMapping("/monitor")
    public String monitor() {
        return "redirect:/widget/widget.html?mode=local";
    }

    @ResponseBody
    @GetMapping("/api/ministack/environments")
    public List<MinistackService.EnvironmentSummaryResponse> environments() {
        return ministackService.getEnvironmentSummaries();
    }

    @ResponseBody
    @GetMapping("/api/ministack/environments/{environment}/status")
    public MinistackService.EnvironmentStatusResponse environmentStatus(
        @PathVariable String environment
    ) {
        return ministackService.getEnvironmentStatus(environment);
    }

    @ResponseBody
    @PostMapping("/api/ministack/environments/{environment}/services/{serviceName}/deploy")
    public MinistackService.DeployResponse deploy(
        @PathVariable String environment,
        @PathVariable String serviceName,
        @RequestParam(defaultValue = "Local operator") String requestedBy
    ) {
        return ministackService.triggerDeploy(environment, serviceName, requestedBy);
    }
}
