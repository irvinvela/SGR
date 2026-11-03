package com.semaialabs.sgr.cash;

public final class OwnerPinPolicy {
    public static final int MIN_LENGTH = 4;
    public static final int MAX_LENGTH = 6;
    public static final int MAX_ATTEMPTS = 5;
    public static final int LOCK_MINUTES = 15;

    private OwnerPinPolicy() {
    }

    public static void validateFormat(String pin) {
        if (pin == null || pin.length() < MIN_LENGTH || pin.length() > MAX_LENGTH || !pin.chars().allMatch(Character::isDigit)) {
            throw new IllegalArgumentException("El PIN debe tener entre 4 y 6 dígitos");
        }
    }
}
