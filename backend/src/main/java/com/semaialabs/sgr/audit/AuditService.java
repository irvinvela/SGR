package com.semaialabs.sgr.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.semaialabs.sgr.tenant.TenantContext;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public AuditService(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public void record(
            Jwt jwt,
            String eventType,
            String entityType,
            Object entityId,
            Map<String, ?> details
    ) {
        jdbc.sql("""
                INSERT INTO audit_events (
                    organization_id, actor_user_id, event_type,
                    entity_type, entity_id, details_json
                ) VALUES (
                    :organizationId, :userId, :eventType,
                    :entityType, :entityId, :details
                )
                """)
                .param("organizationId", TenantContext.organizationId(jwt))
                .param("userId", TenantContext.userId(jwt))
                .param("eventType", eventType)
                .param("entityType", entityType)
                .param("entityId", entityId.toString())
                .param("details", toJson(details))
                .update();
    }

    private String toJson(Map<String, ?> details) {
        try {
            return objectMapper.writeValueAsString(details);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("No se pudo serializar el evento de auditoría", error);
        }
    }
}
