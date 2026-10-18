package com.semaialabs.sgr.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

class SecretObfuscatorTest {
    @Test
    void encryptsAndDecryptsConfigPropertiesWithAesGcm() {
        String raw = "jdbc:sqlserver://localhost:1433;databaseName=SGR;encrypt=true;trustServerCertificate=false";
        String encrypted = SecretObfuscator.encryptProperty(raw);

        assertThat(encrypted).startsWith("ENC(").endsWith(")");
        assertThat(encrypted).doesNotContain("sqlserver");
        assertThat(SecretObfuscator.decryptProperty(encrypted)).isEqualTo(raw);
        assertThat(SecretObfuscator.decryptProperty(
                "ENC(Nz24zav55oYNAUR/8DZLpW07uUCSS+778zKARb4Y0CBqGjMKQIaHDBY7wjU6wVvdQ0Y5fakVs/TQ2fBYEZgwpVgyGUylmb8D9uo9/EVQnq0lesctdPiyWEhJ0e3KjR6m/9jjaxKOzw4KDSGyGnkQuc1PwHpDww==)"
        )).isEqualTo(raw);
    }

    @Test
    void encodesAndDecodesTransportCredentialEnvelope() {
        String secret = "SgrAdmin2026!";
        String encoded = SecretObfuscator.encodeCredential(secret);

        assertThat(encoded).startsWith("OBF1:");
        assertThat(encoded).doesNotContain("SgrAdmin");
        assertThat(SecretObfuscator.decodeCredential(encoded)).isEqualTo(secret);
        assertThat(SecretObfuscator.decodeCredential(secret)).isEqualTo(secret);
    }

    @Test
    void postProcessesEnvironmentEncryptedValuesAutomatically() {
        String encryptedUrl = SecretObfuscator.encryptProperty("jdbc:sqlserver://db-host:1433;databaseName=SGR");
        String encryptedPass = SecretObfuscator.encryptProperty("SuperSecretDbPass!2026");

        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "spring.datasource.url", encryptedUrl,
                "spring.datasource.password", encryptedPass
        )));

        new SecretObfuscator().postProcessEnvironment(env, new SpringApplication());

        assertThat(env.getProperty("spring.datasource.url")).isEqualTo("jdbc:sqlserver://db-host:1433;databaseName=SGR");
        assertThat(env.getProperty("spring.datasource.password")).isEqualTo("SuperSecretDbPass!2026");
    }
}
