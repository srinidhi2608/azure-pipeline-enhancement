FROM eclipse-temurin:25-jre
WORKDIR /app
COPY target/azure-pipeline-enhancement-0.0.1-SNAPSHOT.jar app.jar
COPY ado-widget-extension ./ado-widget-extension
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
