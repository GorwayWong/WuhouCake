package org.xaspire.WuhouCake.bootstrap.configuration;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class DevCustomerEntryOriginTest {
    @Test void wifiDeviceComesFromHardwarePortInsteadOfGuessingEn0OrSelectingVpn() {
        assertThat(DevCustomerEntryOrigin.wifiDevice("""
                Hardware Port: Ethernet
                Device: en0
                Hardware Port: Thunderbolt Bridge
                Device: bridge0
                Hardware Port: Wi-Fi
                Device: en1
                Hardware Port: Thunderbolt
                Device: en2
                """)).contains("en1");
        assertThat(DevCustomerEntryOrigin.wifiDevice("Hardware Port: Ethernet\nDevice: en0")).isEmpty();
        assertThat(DevCustomerEntryOrigin.wifiDevice("Hardware Port: AirPort\nDevice: en3")).contains("en3");
    }

    @Test void detectedAddressChangesNextStartupOriginAndMissingWifiFallsBackToLocal() {
        assertThat(DevCustomerEntryOrigin.origin(Optional.of("192.168.1.56"))).isEqualTo("http://192.168.1.56:5173");
        assertThat(DevCustomerEntryOrigin.origin(Optional.of("10.0.0.8"))).isEqualTo("http://10.0.0.8:5173");
        assertThat(DevCustomerEntryOrigin.origin(Optional.empty())).isEqualTo("http://127.0.0.1:5173");
    }
}
