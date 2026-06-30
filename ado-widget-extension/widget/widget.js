(function () {
  "use strict";

  var API_VERSION = "7.1-preview.7";
  var DEFAULT_REFRESH_INTERVAL_MS = 10000;
  var defaultConfig = {
    defaultEnvironment: "DEV",
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    localStatusBaseUrl: "/api/ministack",
    environments: {
      DEV: {
        label: "DEV",
        theme: "env-dev",
        awsStatusEndpoint: "/api/ministack/environments/DEV/status",
        services: [
          { serviceName: "orders-service", pipelineDefinitionId: 1, branch: "refs/heads/main" },
          { serviceName: "catalog-service", pipelineDefinitionId: 2, branch: "refs/heads/main" },
          { serviceName: "payments-service", pipelineDefinitionId: 3, branch: "refs/heads/main" }
        ]
      },
      UAT: {
        label: "UAT",
        theme: "env-uat",
        awsStatusEndpoint: "/api/ministack/environments/UAT/status",
        services: [
          { serviceName: "orders-service", pipelineDefinitionId: 4, branch: "refs/heads/release/uat" },
          { serviceName: "catalog-service", pipelineDefinitionId: 5, branch: "refs/heads/release/uat" },
          { serviceName: "payments-service", pipelineDefinitionId: 6, branch: "refs/heads/release/uat" }
        ]
      },
      PROD: {
        label: "PROD",
        theme: "env-prod",
        awsStatusEndpoint: "/api/ministack/environments/PROD/status",
        services: [
          { serviceName: "orders-service", pipelineDefinitionId: 7, branch: "refs/heads/main" },
          { serviceName: "catalog-service", pipelineDefinitionId: 8, branch: "refs/heads/main" },
          { serviceName: "payments-service", pipelineDefinitionId: 9, branch: "refs/heads/main" }
        ]
      }
    }
  };

  var effectiveConfig = JSON.parse(JSON.stringify(defaultConfig));
  var selectedEnvironment = defaultConfig.defaultEnvironment;
  var loadingDeployFor = new Set();
  var currentRows = [];
  var currentEnvironmentMeta = null;
  var autoRefreshHandle = null;

  function hasAzureContext() {
    return typeof window !== "undefined" && typeof window.VSS !== "undefined";
  }

  function isStandaloneMode() {
    var mode = new URLSearchParams(window.location.search).get("mode");
    return mode === "local" || !hasAzureContext();
  }

  if (hasAzureContext()) {
    VSS.init({
      explicitNotifyLoaded: true,
      usePlatformStyles: true
    });
  }

  function setStatus(message) {
    document.getElementById("statusMessage").textContent = message || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getWebContext() {
    return VSS.getWebContext();
  }

  function getBaseApiUrl() {
    var context = getWebContext();
    return context.collection.uri.replace(/\/$/, "");
  }

  function getProjectName() {
    var context = getWebContext();
    return context.project && context.project.name ? context.project.name : "";
  }

  function getAccessToken() {
    return new Promise(function (resolve, reject) {
      VSS.getAccessToken().then(
        function (token) {
          resolve(token.token);
        },
        function (error) {
          reject(error);
        }
      );
    });
  }

  async function adoApiFetch(url, options) {
    var token = await getAccessToken();
    var response = await fetch(url, {
      method: (options && options.method) || "GET",
      headers: Object.assign(
        {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        options && options.headers ? options.headers : {}
      ),
      body: options && options.body ? options.body : undefined
    });

    if (!response.ok) {
      var text = await response.text();
      throw new Error("Azure DevOps API call failed (" + response.status + "): " + text);
    }

    return response.status === 204 ? {} : response.json();
  }

  async function getLatestPipelineRun(definitionId) {
    var project = encodeURIComponent(getProjectName());
    var url =
      getBaseApiUrl() +
      "/" +
      project +
      "/_apis/build/builds?definitions=" +
      encodeURIComponent(definitionId) +
      "&$top=1&queryOrder=finishTimeDescending&api-version=" +
      API_VERSION;

    var result = await adoApiFetch(url);
    if (!result.value || result.value.length === 0) {
      return {
        lastDeployedBy: "N/A",
        imageTag: "N/A"
      };
    }

    var latest = result.value[0];
    return {
      lastDeployedBy:
        (latest.requestedFor && latest.requestedFor.displayName) || "Unknown",
      imageTag:
        (latest.sourceVersion && latest.sourceVersion.substring(0, 8)) ||
        "Build-" + latest.id
    };
  }

  async function triggerPipelineBuild(serviceConfig) {
    var project = encodeURIComponent(getProjectName());
    var url =
      getBaseApiUrl() +
      "/" +
      project +
      "/_apis/build/builds?api-version=" +
      API_VERSION;

    var body = {
      definition: {
        id: serviceConfig.pipelineDefinitionId
      },
      sourceBranch: serviceConfig.branch || "refs/heads/main",
      reason: "manual"
    };

    return adoApiFetch(url, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  function normalizeEnvironmentName(environment) {
    return String(environment || defaultConfig.defaultEnvironment).toUpperCase();
  }

  function getEnvironmentEntries() {
    return Object.keys(effectiveConfig.environments || {}).map(function (environmentName) {
      return {
        environment: environmentName,
        config: effectiveConfig.environments[environmentName]
      };
    });
  }

  function getEnvironmentConfig(environment) {
    var normalized = normalizeEnvironmentName(environment);
    return effectiveConfig.environments[normalized] || effectiveConfig.environments[effectiveConfig.defaultEnvironment];
  }

  function setTheme(themeClass) {
    document.body.className = "widget-body " + (themeClass || "env-dev");
  }

  function renderEnvironmentSelector() {
    var selector = document.getElementById("environmentSelector");
    selector.innerHTML = getEnvironmentEntries()
      .map(function (entry) {
        var activeClass = entry.environment === selectedEnvironment ? " is-active" : "";
        return (
          '<button class="environment-button' +
          activeClass +
          '" type="button" data-environment="' +
          escapeHtml(entry.environment) +
          '">' +
          escapeHtml(entry.config.label || entry.environment) +
          "</button>"
        );
      })
      .join("");

    selector.querySelectorAll(".environment-button").forEach(function (button) {
      button.addEventListener("click", function (event) {
        selectedEnvironment = normalizeEnvironmentName(event.currentTarget.getAttribute("data-environment"));
        var environmentConfig = getEnvironmentConfig(selectedEnvironment);
        setTheme(environmentConfig.theme);
        renderEnvironmentSelector();
        loadData().catch(function (error) {
          setStatus("Environment switch failed: " + error.message);
        });
      });
    });
  }

  function renderSummary(rows, meta) {
    var healthyServices = rows.filter(function (row) {
      return row.health === "Healthy";
    }).length;
    var totalDesired = rows.reduce(function (sum, row) {
      return sum + Number(row.desiredCount || 0);
    }, 0);
    var totalRunning = rows.reduce(function (sum, row) {
      return sum + Number(row.runningCount || 0);
    }, 0);

    document.getElementById("healthyServicesValue").textContent =
      healthyServices + " / " + rows.length;
    document.getElementById("runningTasksValue").textContent =
      totalRunning + " / " + totalDesired;
    document.getElementById("lastSyncValue").textContent =
      formatDateTime((meta && meta.lastUpdated) || new Date().toISOString());
    document.getElementById("clusterBadge").textContent =
      (meta && meta.clusterName) || (selectedEnvironment + " cluster");
  }

  function formatDateTime(value) {
    if (!value) {
      return "N/A";
    }
    return new Date(value).toLocaleString();
  }

  function renderTable(rows) {
    currentRows = rows.slice();
    var tbody = document.getElementById("serviceRows");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No services configured.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (row) {
        var healthy = row.health === "Healthy";
        var healthClass = healthy ? "health-green" : "health-red";
        var deployDisabled = loadingDeployFor.has(row.serviceName) ? "disabled" : "";
        var deployText = loadingDeployFor.has(row.serviceName) ? "Deploying..." : "Deploy";
        return (
          "<tr>" +
          "<td>" +
          '<div class="service-name">' +
          escapeHtml(row.serviceName) +
          "</div>" +
          '<div class="service-meta">' +
          escapeHtml(row.environmentLabel || selectedEnvironment) +
          " environment" +
          "</div>" +
          "</td>" +
          '<td><span class="health-pill ' +
          healthClass +
          '"><span class="health-dot"></span>' +
          escapeHtml(row.health) +
          "</span></td>" +
          "<td>" +
          escapeHtml(row.imageTag) +
          "</td>" +
          "<td>" +
          escapeHtml(row.lastDeployedBy) +
          '<div class="service-meta">' +
          escapeHtml(formatDateTime(row.lastDeploymentTime)) +
          "</div>" +
          "</td>" +
          '<td><span class="count-pill">' +
          escapeHtml(row.desiredCount) +
          " / " +
          escapeHtml(row.runningCount) +
          "</span></td>" +
          '<td><button class="btn-primary deploy-button" data-service="' +
          escapeHtml(row.serviceName) +
          '" ' +
          deployDisabled +
          ">" +
          deployText +
          "</button></td>" +
          "</tr>"
        );
      })
      .join("");

    bindDeployButtons();
  }

  function getServiceConfig(serviceName) {
    return (getEnvironmentConfig(selectedEnvironment).services || []).find(function (entry) {
      return entry.serviceName === serviceName;
    });
  }

  async function fetchLocalEnvironmentStatus(environment) {
    var response = await fetch(
      effectiveConfig.localStatusBaseUrl +
        "/environments/" +
        encodeURIComponent(environment) +
        "/status",
      { method: "GET" }
    );
    if (!response.ok) {
      throw new Error("Ministack status fetch failed with status " + response.status);
    }
    return response.json();
  }

  async function triggerLocalDeploy(serviceName) {
    var response = await fetch(
      effectiveConfig.localStatusBaseUrl +
        "/environments/" +
        encodeURIComponent(selectedEnvironment) +
        "/services/" +
        encodeURIComponent(serviceName) +
        "/deploy?requestedBy=" +
        encodeURIComponent("Local Tester"),
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      throw new Error("Local deployment failed with status " + response.status);
    }

    return response.json();
  }

  function buildEnvironmentUrl(endpoint, environment) {
    if (!endpoint) {
      return "";
    }
    if (endpoint.indexOf("{environment}") >= 0) {
      return endpoint.replace(/\{environment\}/g, environment);
    }
    if (endpoint.indexOf("?") >= 0) {
      return endpoint + "&environment=" + encodeURIComponent(environment);
    }
    return endpoint;
  }

  async function fetchAzureStatus(environmentConfig) {
    var endpoint = buildEnvironmentUrl(environmentConfig.awsStatusEndpoint, selectedEnvironment);
    var response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) {
      throw new Error("AWS status fetch failed with status " + response.status);
    }
    return response.json();
  }

  function mapLocalRows(payload) {
    var label = payload.displayName || selectedEnvironment;
    return (payload.services || []).map(function (service) {
      return {
        serviceName: service.serviceName,
        health: service.health,
        imageTag: service.imageTag || "N/A",
        lastDeployedBy: service.lastDeployedBy || "N/A",
        lastDeploymentTime: service.lastDeploymentTime,
        desiredCount: service.desiredCount,
        runningCount: service.runningCount,
        environmentLabel: label
      };
    });
  }

  function getHealth(entry) {
    var desired = Number(entry.desiredCount || 0);
    var running = Number(entry.runningCount || 0);
    return running >= desired ? "Healthy" : "Needs attention";
  }

  async function loadData() {
    var environmentConfig = getEnvironmentConfig(selectedEnvironment);
    setTheme(environmentConfig.theme);
    setStatus("Loading " + selectedEnvironment + " environment data...");

    if (isStandaloneMode()) {
      var localPayload = await fetchLocalEnvironmentStatus(selectedEnvironment);
      currentEnvironmentMeta = localPayload;
      var localRows = mapLocalRows(localPayload);
      renderSummary(localRows, localPayload);
      renderTable(localRows);
      setStatus("Ministack live view refreshed at " + new Date().toLocaleTimeString());
      return;
    }

    var ecsPayload = await fetchAzureStatus(environmentConfig);
    var ecsItems = Array.isArray(ecsPayload) ? ecsPayload : ecsPayload.services || [];
    var rows = [];

    for (var i = 0; i < environmentConfig.services.length; i += 1) {
      var service = environmentConfig.services[i];
      var ecsEntry = ecsItems.find(function (item) {
        return item.serviceName === service.serviceName;
      }) || {
        serviceName: service.serviceName,
        desiredCount: 0,
        runningCount: 0,
        imageTag: "N/A"
      };

      var latestRun = await getLatestPipelineRun(service.pipelineDefinitionId).catch(function () {
        return { lastDeployedBy: "N/A", imageTag: ecsEntry.imageTag || "N/A" };
      });

      rows.push({
        serviceName: service.serviceName,
        health: getHealth(ecsEntry),
        imageTag: ecsEntry.imageTag || latestRun.imageTag || "N/A",
        lastDeployedBy: latestRun.lastDeployedBy || "N/A",
        lastDeploymentTime: new Date().toISOString(),
        desiredCount: ecsEntry.desiredCount || 0,
        runningCount: ecsEntry.runningCount || 0,
        environmentLabel: environmentConfig.label || selectedEnvironment
      });
    }

    currentEnvironmentMeta = {
      clusterName: selectedEnvironment + " AWS cluster",
      lastUpdated: new Date().toISOString()
    };
    renderSummary(rows, currentEnvironmentMeta);
    renderTable(rows);
    setStatus("Last refresh: " + new Date().toLocaleTimeString());
  }

  function bindDeployButtons() {
    document.querySelectorAll(".deploy-button").forEach(function (button) {
      button.addEventListener("click", async function (event) {
        var serviceName = event.currentTarget.getAttribute("data-service");
        var config = getServiceConfig(serviceName);
        if (!config) {
          return;
        }

        try {
          loadingDeployFor.add(serviceName);
          renderTable(currentRows);
          setStatus("Triggering deployment for " + serviceName + "...");
          if (isStandaloneMode()) {
            await triggerLocalDeploy(serviceName);
          } else {
            await triggerPipelineBuild(config);
          }
          setStatus("Deployment triggered for " + serviceName + ".");
        } catch (error) {
          setStatus("Failed to trigger deployment for " + serviceName + ": " + error.message);
        } finally {
          loadingDeployFor.delete(serviceName);
          await loadData();
        }
      });
    });
  }

  function loadConfigFromWidgetSettings(widgetSettings) {
    var parsed = {};
    if (
      widgetSettings &&
      widgetSettings.customSettings &&
      widgetSettings.customSettings.data
    ) {
      try {
        parsed = JSON.parse(widgetSettings.customSettings.data);
      } catch (error) {
        parsed = {};
      }
    }

    effectiveConfig = JSON.parse(JSON.stringify(defaultConfig));
    effectiveConfig = Object.assign(effectiveConfig, parsed || {});
    effectiveConfig.environments = Object.assign({}, defaultConfig.environments, parsed.environments || {});

    Object.keys(defaultConfig.environments).forEach(function (environmentName) {
      effectiveConfig.environments[environmentName] = Object.assign(
        {},
        defaultConfig.environments[environmentName],
        (parsed.environments && parsed.environments[environmentName]) || {}
      );
    });

    if (!parsed.environments && Array.isArray(parsed.services)) {
      effectiveConfig.environments[effectiveConfig.defaultEnvironment].services = parsed.services;
    }

    selectedEnvironment = normalizeEnvironmentName(
      parsed.defaultEnvironment || effectiveConfig.defaultEnvironment || defaultConfig.defaultEnvironment
    );
  }

  function setupRefreshButton() {
    document.getElementById("refreshButton").addEventListener("click", function () {
      loadData().catch(function (error) {
        setStatus("Refresh failed: " + error.message);
      });
    });
  }

  function setupAutoRefresh() {
    if (autoRefreshHandle) {
      clearInterval(autoRefreshHandle);
    }

    autoRefreshHandle = window.setInterval(function () {
      loadData().catch(function (error) {
        setStatus("Auto refresh failed: " + error.message);
      });
    }, effectiveConfig.refreshIntervalMs || DEFAULT_REFRESH_INTERVAL_MS);
  }

  function bootstrapStandalone() {
    loadConfigFromWidgetSettings(null);
    renderEnvironmentSelector();
    setupRefreshButton();
    setupAutoRefresh();
    loadData().catch(function (error) {
      setStatus("Monitor load failed: " + error.message);
    });
  }

  if (isStandaloneMode()) {
    bootstrapStandalone();
    return;
  }

  VSS.require(["TFS/Dashboards/WidgetHelpers"], function (WidgetHelpers) {
    setupRefreshButton();

    VSS.register("ecsDashboardWidget", function () {
      return {
        load: function (widgetSettings) {
          loadConfigFromWidgetSettings(widgetSettings);
          renderEnvironmentSelector();
          setupAutoRefresh();
          return loadData()
            .then(function () {
              return WidgetHelpers.WidgetStatusHelper.Success();
            })
            .catch(function (error) {
              setStatus("Widget load failed: " + error.message);
              return WidgetHelpers.WidgetStatusHelper.Success();
            });
        },
        reload: function (widgetSettings) {
          loadConfigFromWidgetSettings(widgetSettings);
          renderEnvironmentSelector();
          return this.load(widgetSettings);
        }
      };
    });

    VSS.notifyLoadSucceeded();
  });
})();
