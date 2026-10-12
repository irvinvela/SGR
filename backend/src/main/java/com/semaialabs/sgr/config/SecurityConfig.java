package com.semaialabs.sgr.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.semaialabs.sgr.auth.CookieBearerTokenResolver;
import com.semaialabs.sgr.auth.SgrUserDetailsService;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        CookieCsrfTokenRepository csrf = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrf.setCookieName("SGR_XSRF");
        csrf.setHeaderName("X-SGR-XSRF");
        csrf.setCookiePath("/");

        return http
                .csrf(configurer -> configurer.csrfTokenRepository(csrf))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/health", "/api/auth/csrf", "/api/auth/login").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth
                        .bearerTokenResolver(new CookieBearerTokenResolver())
                        .jwt(Customizer.withDefaults()))
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'"))
                        .frameOptions(frame -> frame.deny()))
                .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    AuthenticationManager authenticationManager(
            SgrUserDetailsService userDetailsService,
            PasswordEncoder passwordEncoder
    ) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    @Bean
    SecretKey jwtSecretKey(SecurityProperties properties) {
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(properties.jwtSecret());
        } catch (IllegalArgumentException error) {
            throw new IllegalStateException("SGR_JWT_SECRET debe estar codificado en Base64", error);
        }
        if (decoded.length < 32) {
            throw new IllegalStateException("SGR_JWT_SECRET debe contener al menos 32 bytes");
        }
        return new SecretKeySpec(decoded, "HmacSHA256");
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey key) {
        return NimbusJwtDecoder.withSecretKey(key).build();
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey key) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key));
    }
}
