package com.semaialabs.sgr.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Set;
import org.springframework.http.ResponseCookie;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.util.StringUtils;

public class CookieBearerTokenResolver implements BearerTokenResolver {
    public static final String COOKIE_NAME = "SGR_ACCESS";
    public static final String[] PUBLIC_PATHS = {
            "/api/health",
            "/api/auth/csrf",
            "/api/auth/login",
            "/api/auth/session"
    };
    private static final Set<String> PUBLIC = Set.of(PUBLIC_PATHS);

    @Override
    public String resolve(HttpServletRequest request) {
        if (PUBLIC.contains(applicationPath(request))) {
            return null;
        }
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (COOKIE_NAME.equals(cookie.getName()) && StringUtils.hasText(cookie.getValue())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    public static ResponseCookie clearAccessCookie(boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(secure)
                .sameSite("Strict")
                .path("/")
                .maxAge(0)
                .build();
    }

    static String applicationPath(HttpServletRequest request) {
        String uri = request.getRequestURI() == null ? "" : request.getRequestURI();
        String context = request.getContextPath();
        if (context != null && !context.isEmpty() && uri.startsWith(context)) {
            uri = uri.substring(context.length());
        }
        int semicolon = uri.indexOf(';');
        if (semicolon >= 0) {
            uri = uri.substring(0, semicolon);
        }
        if (uri.length() > 1 && uri.endsWith("/")) {
            uri = uri.substring(0, uri.length() - 1);
        }
        return uri;
    }
}
