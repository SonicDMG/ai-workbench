plugins {
    java
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.datastax.aiworkbench"
version = "0.0.0"
description = "AI Workbench — Java (Spring Boot) runtime. One of N language 'green boxes' exposing /api/v1/*."

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")

    // OpenAPI / Swagger UI — served at /docs.
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.7.0")

    // Pin once the runtime actually calls Astra:
    // implementation("com.datastax.astra:astra-db-java:2.+")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
