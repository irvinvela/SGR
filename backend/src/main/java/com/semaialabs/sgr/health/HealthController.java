package com.semaialabs.sgr.health;

import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class HealthController {
    private final JdbcClient jdbc;

    public HealthController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> health() {
        Integer database = jdbc.sql("SELECT 1").query(Integer.class).single();
        return Map.of(
                "status", database == 1 ? "ok" : "degraded",
                "service", "sgr-api",
                "timestamp", Instant.now().toString()
        );
    }
}
