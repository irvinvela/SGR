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
}
