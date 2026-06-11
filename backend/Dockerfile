# ---------- Build stage ----------
# We build inside the image to keep the host build environment out
# of the deployable artifact. Maven downloads its world, compiles,
# packages the JAR.
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build

# Copy dependency manifest first; this layer caches as long as deps
# don't change, so source-only changes rebuild fast.
COPY pom.xml ./
RUN mvn dependency:go-offline -B

# Now copy source and compile
COPY src ./src
RUN mvn package -DskipTests -B

# ---------- Runtime stage ----------
# Eclipse Temurin JRE-only image (no JDK, no Maven) for a smaller
# production image. Java 21 LTS.
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Non-root user. The container runs as 'app', not root.
RUN addgroup -S app && adduser -S app -G app
USER app

# Copy the built JAR (the * is because the version number changes)
COPY --from=build --chown=app:app /build/target/payments-service-*.jar /app/app.jar

# Port the app listens on (matches application.yml's server.port)
EXPOSE 8080

# JVM tuning for containerized environments.
#   -XX:MaxRAMPercentage=75 lets the JVM use 75% of the container's
#     memory limit (default is conservative ~25%).
#   -XX:+ExitOnOutOfMemoryError makes OOMs crash the container so
#     ECS can restart it, rather than the JVM limping along.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

# 'exec' so Java becomes PID 1 and receives signals (SIGTERM for
# graceful shutdown) directly from the container runtime.
ENTRYPOINT exec java $JAVA_OPTS -jar /app/app.jar