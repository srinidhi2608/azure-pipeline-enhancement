(function () {
  "use strict";

  VSS.init({
    explicitNotifyLoaded: true,
    usePlatformStyles: true
  });

  var API_VERSION = "7.1-preview.7";
  var defaultConfig = {
    awsStatusEndpoint: "https://your-api-gateway-url.example.com/ecs-status",
    services: [
      { serviceName: "orders-service", pipelineDefinitionId: 1, branch: "refs/heads/main" },
      { serviceName: "catalog-service", pipelineDefinitionId: 2, branch: "refs/heads/main" }
    ]
  };

  var effectiveConfig = JSON.parse(JSON.stringify(defaultConfig));
  var loadingDeployFor = new Set();

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

  async function fetchEcsStatusFromAws() {
    /*
      Placeholder for your AWS integration route.
      Replace endpoint/auth strategy as needed.
      Expected response:
      [
        {"serviceName":"orders-service","desiredCount":2,"runningCount":2,"imageTag":"1.3.7"},
        {"serviceName":"catalog-service","desiredCount":1,"runningCount":0,"imageTag":"1.1.0"}
      ]
    */
    var response = await fetch(effectiveConfig.awsStatusEndpoint, { method: "GET" });
    if (!response.ok) {
      throw new Error("AWS status fetch failed with status " + response.status);
    }
    return response.json();
  }

  function getHealth(entry) {
    var desired = Number(entry.desiredCount || 0);
    var running = Number(entry.runningCount || 0);
    return running >= desired ? "Healthy" : "Unhealthy";
  }

  function renderTable(rows) {
    var tbody = document.getElementById("serviceRows");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No services configured.</td></tr>';
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
          escapeHtml(row.serviceName) +
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
          "</td>" +
          "<td><button class=\"btn-primary deploy-button\" data-service=\"" +
          escapeHtml(row.serviceName) +
          "\" " +
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
    return effectiveConfig.services.find(function (entry) {
      return entry.serviceName === serviceName;
    });
  }

  async function loadData() {
    setStatus("Loading ECS and pipeline data...");

    var ecsItems = [];
    try {
      ecsItems = await fetchEcsStatusFromAws();
    } catch (error) {
      setStatus("Could not fetch ECS status: " + error.message);
    }

    var rows = [];
    for (var i = 0; i < effectiveConfig.services.length; i += 1) {
      var service = effectiveConfig.services[i];
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
        lastDeployedBy: latestRun.lastDeployedBy || "N/A"
      });
    }

    renderTable(rows);
    setStatus("Last refresh: " + new Date().toLocaleTimeString());
  }

  function bindDeployButtons() {
    var buttons = document.querySelectorAll(".deploy-button");
    buttons.forEach(function (button) {
      button.addEventListener("click", async function (event) {
        var serviceName = event.currentTarget.getAttribute("data-service");
        var config = getServiceConfig(serviceName);
        if (!config) {
          return;
        }

        try {
          loadingDeployFor.add(serviceName);
          renderLoadingButtons();
          setStatus("Triggering deployment for " + serviceName + "...");
          await triggerPipelineBuild(config);
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

  function renderLoadingButtons() {
    var buttons = document.querySelectorAll(".deploy-button");
    buttons.forEach(function (button) {
      var serviceName = button.getAttribute("data-service");
      var isLoading = loadingDeployFor.has(serviceName);
      button.disabled = isLoading;
      button.textContent = isLoading ? "Deploying..." : "Deploy";
    });
  }

  function loadConfigFromWidgetSettings(widgetSettings) {
    if (
      widgetSettings &&
      widgetSettings.customSettings &&
      widgetSettings.customSettings.data
    ) {
      try {
        var parsed = JSON.parse(widgetSettings.customSettings.data);
        effectiveConfig = Object.assign({}, defaultConfig, parsed);
        if (!Array.isArray(effectiveConfig.services)) {
          effectiveConfig.services = defaultConfig.services;
        }
      } catch (error) {
        effectiveConfig = JSON.parse(JSON.stringify(defaultConfig));
      }
    } else {
      effectiveConfig = JSON.parse(JSON.stringify(defaultConfig));
    }
  }

  document.getElementById("refreshButton").addEventListener("click", function () {
    loadData().catch(function (error) {
      setStatus("Refresh failed: " + error.message);
    });
  });

  VSS.require(["TFS/Dashboards/WidgetHelpers"], function (WidgetHelpers) {
    VSS.register("ecsDashboardWidget", function () {
      return {
        load: function (widgetSettings) {
          loadConfigFromWidgetSettings(widgetSettings);
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
          return this.load(widgetSettings);
        }
      };
    });

    VSS.notifyLoadSucceeded();
  });
})();
