package com.semaialabs.sgr.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "sgr.security")
public record SecurityProperties(
        String jwtSecret,
        String issuer,
        long accessTokenMinutes,
        long rememberTokenDays,
        boolean secureCookie
) {
    public Duration accessTokenDuration(boolean remember) {
        return remember ? Duration.ofDays(rememberTokenDays) : Duration.ofMinutes(accessTokenMinutes);
    }

    @Override
    public String toString() {
        return "SecurityProperties[issuer=" + issuer + ", jwtSecret=[PROTECTED]]";
    }
}
