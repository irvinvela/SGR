package com.semaialabs.sgr.order;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class OrderItemPolicyTest {
    @Test
    void pendingItemCanBeEditedOrRemovedByOperator() {
        assertThat(OrderItemPolicy.canEdit("OPEN", false)).isTrue();
        assertThat(OrderItemPolicy.canVoid("OPEN", false, "SERVER")).isTrue();
    }

    @Test
    void sentItemRequiresManagerToVoid() {
        assertThat(OrderItemPolicy.canEdit("OPEN", true)).isFalse();
        assertThat(OrderItemPolicy.canVoid("OPEN", true, "SERVER")).isFalse();
        assertThat(OrderItemPolicy.canVoid("OPEN", true, "MANAGER")).isTrue();
        assertThat(OrderItemPolicy.canVoid("OPEN", true, "OWNER")).isTrue();
    }

    @Test
    void paymentRequestedOrderCannotBeChanged() {
        assertThat(OrderItemPolicy.canEdit("WAITING_PAYMENT", false)).isFalse();
        assertThat(OrderItemPolicy.canVoid("WAITING_PAYMENT", false, "OWNER")).isFalse();
    }
}
