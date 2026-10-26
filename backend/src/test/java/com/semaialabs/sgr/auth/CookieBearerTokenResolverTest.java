package com.semaialabs.sgr.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class CookieBearerTokenResolverTest {
    private final CookieBearerTokenResolver resolver = new CookieBearerTokenResolver();

    @Test
    void readsAccessTokenOnlyFromTheExpectedCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(
                new Cookie("other", "ignored"),
                new Cookie(CookieBearerTokenResolver.COOKIE_NAME, "signed-token")
        );

        assertThat(resolver.resolve(request)).isEqualTo("signed-token");
    }

    @Test
    void returnsNullWhenTheCookieIsAbsent() {
        assertThat(resolver.resolve(new MockHttpServletRequest())).isNull();
    }

    @Test
    void returnsNullWhenTheCookieIsBlank() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/orders");
        request.setCookies(new Cookie(CookieBearerTokenResolver.COOKIE_NAME, "  "));

        assertThat(resolver.resolve(request)).isNull();
    }

    @Test
    void ignoresStaleAccessCookieOnAnonymousLoginEndpoints() {
        for (String path : CookieBearerTokenResolver.PUBLIC_PATHS) {
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setRequestURI(path);
            request.setCookies(new Cookie(CookieBearerTokenResolver.COOKIE_NAME, "expired-token"));

            assertThat(resolver.resolve(request)).isNull();
        }
    }

    @Test
    void ignoresAccessCookieWhenThePublicPathIncludesContextOrTrailingSlash() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContextPath("/sgr");
        request.setRequestURI("/sgr/api/auth/csrf/");
        request.setCookies(new Cookie(CookieBearerTokenResolver.COOKIE_NAME, "expired-token"));

        assertThat(resolver.resolve(request)).isNull();
    }
}
