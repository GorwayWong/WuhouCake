package org.xaspire.WuhouCake.bootstrap.configuration;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.slf4j.LoggerFactory;

/** Resolves the local Wi-Fi origin once when the development application starts. */
final class DevCustomerEntryOrigin {
    private DevCustomerEntryOrigin() { }

    static String resolve() {
        var address = wifiAddress();
        var origin = origin(address);
        var logger = LoggerFactory.getLogger(DevCustomerEntryOrigin.class);
        if (address.isPresent()) logger.info("Development customer entry origin: {}", origin);
        else logger.warn("No active Wi-Fi LAN IPv4 found; customer entry uses {} and is accessible only on this computer. Configure CUSTOMER_ENTRY_PUBLIC_ORIGIN to override.", origin);
        return origin;
    }

    static String origin(Optional<String> address) {
        return "http://" + address.orElse("127.0.0.1") + ":5173";
    }

    private static Optional<String> wifiAddress() {
        try {
            var mac = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac");
            var macDevice = mac ? macWifiDevice() : Optional.<String>empty();
            var interfaces = NetworkInterface.networkInterfaces().sorted(java.util.Comparator.comparing(NetworkInterface::getName)).toList();
            for (var network : interfaces) {
                boolean wifi = mac ? macDevice.filter(network.getName()::equals).isPresent()
                        : network.getName().startsWith("wlan") || network.getName().startsWith("wl")
                        || network.getDisplayName().toLowerCase(Locale.ROOT).contains("wi-fi")
                        || network.getDisplayName().toLowerCase(Locale.ROOT).contains("wireless")
                        || Files.isDirectory(Path.of("/sys/class/net", network.getName(), "wireless"));
                if (!wifi || !network.isUp() || network.isLoopback()) continue;
                var address = network.inetAddresses().filter(value -> value instanceof Inet4Address
                        && value.isSiteLocalAddress() && !value.isLoopbackAddress() && !value.isLinkLocalAddress())
                        .map(java.net.InetAddress::getHostAddress).sorted().findFirst();
                if (address.isPresent()) return address;
            }
        } catch (IOException failure) {
            LoggerFactory.getLogger(DevCustomerEntryOrigin.class).warn("Could not inspect development Wi-Fi interfaces", failure);
        }
        return Optional.empty();
    }

    private static Optional<String> macWifiDevice() throws IOException {
        var process = new ProcessBuilder("/usr/sbin/networksetup", "-listallhardwareports").redirectErrorStream(true).start();
        try {
            if (!process.waitFor(2, TimeUnit.SECONDS)) return Optional.empty();
            if (process.exitValue() != 0) return Optional.empty();
            return wifiDevice(new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } finally { if (process.isAlive()) process.destroyForcibly(); }
    }

    static Optional<String> wifiDevice(String hardwarePorts) {
        boolean wifi = false;
        for (var line : hardwarePorts.lines().toList()) {
            var value = line.trim();
            if (value.startsWith("Hardware Port:")) wifi = value.equals("Hardware Port: Wi-Fi") || value.equals("Hardware Port: AirPort");
            else if (wifi && value.startsWith("Device:")) return Optional.of(value.substring("Device:".length()).trim()).filter(device -> !device.isEmpty());
        }
        return Optional.empty();
    }
}
