package com.semaialabs.sgr.config;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.PropertySource;

public final class SecretObfuscator implements EnvironmentPostProcessor, Ordered {
    public static final String ENC_PREFIX = "ENC(";
    private static final String ENC_SUFFIX = ")";
    public static final String ENVELOPE_PREFIX = "OBF1:";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;

    private static final byte[] DEFAULT_CONFIG_KEY = new byte[] {
            (byte) 0x53, (byte) 0x47, (byte) 0x52, (byte) 0x5F,
            (byte) 0x53, (byte) 0x45, (byte) 0x4D, (byte) 0x41,
            (byte) 0x49, (byte) 0x41, (byte) 0x5F, (byte) 0x43,
            (byte) 0x46, (byte) 0x47, (byte) 0x5F, (byte) 0x32,
            (byte) 0x30, (byte) 0x32, (byte) 0x36, (byte) 0x5F,
            (byte) 0x4B, (byte) 0x45, (byte) 0x59, (byte) 0x5F,
            (byte) 0x56, (byte) 0x31, (byte) 0x5F, (byte) 0x41,
            (byte) 0x45, (byte) 0x53, (byte) 0x32, (byte) 0x35
    };

    private static final byte[] ENVELOPE_MASK = new byte[] {
            (byte) 0x7A, (byte) 0x3C, (byte) 0x9E, (byte) 0x15,
            (byte) 0xD2, (byte) 0x4B, (byte) 0x83, (byte) 0x61,
            (byte) 0xE7, (byte) 0x29, (byte) 0x54, (byte) 0xB8,
            (byte) 0x0F, (byte) 0xC6, (byte) 0x92, (byte) 0x3A
    };

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 20;
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        byte[] configKey = resolveConfigKey(environment);
        Map<String, Object> resolved = new java.util.HashMap<>();

        for (PropertySource<?> source : environment.getPropertySources()) {
            if (source instanceof org.springframework.core.env.EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    Object raw = environment.getProperty(name);
                    if (raw instanceof String text && isEncryptedProperty(text)) {
                        resolved.put(name, decryptProperty(text, configKey));
                    }
                }
            }
        }

        String[] knownSecretKeys = {
                "spring.datasource.url",
                "spring.datasource.username",
                "spring.datasource.password",
                "spring.flyway.user",
                "spring.flyway.password",
                "sgr.security.jwt-secret",
                "SGR_DB_URL",
                "SGR_DB_USERNAME",
                "SGR_DB_PASSWORD",
                "SGR_MIGRATION_DB_USERNAME",
                "SGR_MIGRATION_DB_PASSWORD",
                "SGR_JWT_SECRET"
        };
        for (String key : knownSecretKeys) {
            String value = environment.getProperty(key);
            if (value != null && isEncryptedProperty(value)) {
                resolved.put(key, decryptProperty(value, configKey));
            }
        }

        if (!resolved.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("sgrDeobfuscatedSecrets", resolved));
        }
    }

    public static boolean isEncryptedProperty(String value) {
        return value != null && value.startsWith(ENC_PREFIX) && value.endsWith(ENC_SUFFIX);
    }

    public static String encryptProperty(String plainText) {
        return encryptProperty(plainText, DEFAULT_CONFIG_KEY);
    }

    public static String encryptProperty(String plainText, byte[] keyBytes) {
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKeySpec key = new SecretKeySpec(normalizeKey(keyBytes), "AES");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] cipherText = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(cipherText, 0, combined, iv.length, cipherText.length);
            return ENC_PREFIX + Base64.getEncoder().encodeToString(combined) + ENC_SUFFIX;
        } catch (Exception error) {
            throw new IllegalStateException("No se pudo ofuscar la propiedad sensible", error);
        }
    }

    public static String decryptProperty(String encryptedValue) {
        return decryptProperty(encryptedValue, DEFAULT_CONFIG_KEY);
    }

    public static String decryptProperty(String encryptedValue, byte[] keyBytes) {
        if (!isEncryptedProperty(encryptedValue)) {
            return encryptedValue;
        }
        String payload = encryptedValue.substring(ENC_PREFIX.length(), encryptedValue.length() - ENC_SUFFIX.length());
        try {
            byte[] combined = Base64.getDecoder().decode(payload);
            if (combined.length <= GCM_IV_LENGTH) {
                throw new IllegalArgumentException("Payload cifrado inválido");
            }
            byte[] iv = new byte[GCM_IV_LENGTH];
            byte[] cipherText = new byte[combined.length - GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
            System.arraycopy(combined, GCM_IV_LENGTH, cipherText, 0, cipherText.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKeySpec key = new SecretKeySpec(normalizeKey(keyBytes), "AES");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
        } catch (Exception error) {
            throw new IllegalStateException("No se pudo desofuscar la propiedad sensible", error);
        }
    }

    /**
     * Decodes a transport-obfuscated credential (`OBF1:<base64url>`).
     * If the value is not wrapped with `OBF1:`, returns it as-is for backwards compatibility.
     */
    public static String decodeCredential(String value) {
        if (value == null || !value.startsWith(ENVELOPE_PREFIX)) {
            return value;
        }
        String encoded = value.substring(ENVELOPE_PREFIX.length());
        try {
            byte[] payload = Base64.getUrlDecoder().decode(encoded);
            if (payload.length < 4) {
                throw new IllegalArgumentException("Credencial ofuscada inválida");
            }
            byte[] salt = new byte[] { payload[0], payload[1], payload[2], payload[3] };
            byte[] data = new byte[payload.length - 4];
            for (int i = 0; i < data.length; i++) {
                int maskByte = (ENVELOPE_MASK[i % ENVELOPE_MASK.length] ^ salt[i % 4] ^ ((i * 31) & 0xFF)) & 0xFF;
                data[i] = (byte) (payload[i + 4] ^ maskByte);
            }
            return new String(data, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Formato de credencial inválido", error);
        }
    }

    public static String encodeCredential(String plainText) {
        if (plainText == null) {
            return null;
        }
        byte[] raw = plainText.getBytes(StandardCharsets.UTF_8);
        byte[] salt = new byte[4];
        new SecureRandom().nextBytes(salt);
        byte[] out = new byte[4 + raw.length];
        System.arraycopy(salt, 0, out, 0, 4);
        for (int i = 0; i < raw.length; i++) {
            int maskByte = (ENVELOPE_MASK[i % ENVELOPE_MASK.length] ^ salt[i % 4] ^ ((i * 31) & 0xFF)) & 0xFF;
            out[i + 4] = (byte) (raw[i] ^ maskByte);
        }
        return ENVELOPE_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(out);
    }

    private static byte[] resolveConfigKey(ConfigurableEnvironment environment) {
        String customKey = environment.getProperty("SGR_CFG_KEY");
        if (customKey == null || customKey.isBlank()) {
            customKey = System.getenv("SGR_CFG_KEY");
        }
        if (customKey == null || customKey.isBlank()) {
            return DEFAULT_CONFIG_KEY;
        }
        return normalizeKey(customKey.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] normalizeKey(byte[] input) {
        byte[] key = new byte[32];
        for (int i = 0; i < 32; i++) {
            key[i] = input[i % input.length];
        }
        return key;
    }
}
