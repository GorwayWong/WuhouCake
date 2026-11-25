package org.xaspire.WuhouCake.bootstrap.operations;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
public class ServerStatusController {
    private static final int MAX_BYTES = 8192;
    private static final Duration MAX_AGE = Duration.ofMinutes(15);

    public enum Alert {
        DISK_LOW, DAILY_FAILED, DAILY_OVERDUE, PREDEPLOY_FAILED,
        DAILY_BACKUP_CORRUPT, PREDEPLOY_BACKUP_CORRUPT, DAILY_INTEGRITY_UNCONFIRMED, PREDEPLOY_INTEGRITY_UNCONFIRMED
    }
    public enum AttemptState { RUNNING, SUCCESS, FAILED }
    public enum Failure { DUMP_FAILED, DUMP_TIMEOUT, VERIFY_FAILED, DISK_RESERVE, STORAGE_FAILED, INTERRUPTED }
    public record Disk(Long totalBytes, Long availableBytes) {
        boolean valid() { return totalBytes != null && availableBytes != null
                && totalBytes > 0 && availableBytes >= 0 && availableBytes <= totalBytes; }
    }

    public record Attempt(AttemptState state, Instant startedAt, Instant finishedAt, Failure error) {
        boolean valid(Instant latest) {
            if (state == null || startedAt == null || startedAt.isAfter(latest)) return false;
            if (state == AttemptState.RUNNING) return finishedAt == null && error == null;
            return finishedAt != null && !finishedAt.isBefore(startedAt) && !finishedAt.isAfter(latest)
                    && (state == AttemptState.FAILED) == (error != null);
        }
    }

    public record Success(Instant verifiedAt, long bytes) {
        boolean valid(Instant latest) { return bytes > 0 && verifiedAt != null && !verifiedAt.isAfter(latest); }
    }

    public record Backups(Attempt latestAttempt, Success lastSuccess) {
        boolean valid(Instant latest) {
            return (latestAttempt == null || latestAttempt.valid(latest))
                    && (lastSuccess == null || lastSuccess.valid(latest));
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Snapshot(int schema, Instant observedAt, Disk disk, Backups daily, Backups predeploy, List<Alert> alerts,
                    List<Alert> integrityAlerts) {
        boolean valid(Instant now) {
            return schema == 1 && observedAt != null && !observedAt.isAfter(now.plusSeconds(30))
                    && observedAt.isAfter(now.minus(MAX_AGE))
                    && disk != null && disk.valid() && daily != null && daily.valid(observedAt)
                    && predeploy != null && predeploy.valid(observedAt)
                    && alerts != null && alerts.size() <= Alert.values().length
                    && alerts.stream().noneMatch(java.util.Objects::isNull)
                    && (integrityAlerts == null || integrityAlerts.size() <= Alert.values().length
                        && integrityAlerts.stream().noneMatch(java.util.Objects::isNull));
        }
    }

    public record View(String state, Instant observedAt, Disk disk, Backups daily, Backups predeploy, List<Alert> alerts) {
        static View unknown() { return new View("UNKNOWN", null, null, null, null, List.of()); }

        static View from(Snapshot snapshot) {
            return new View("AVAILABLE", snapshot.observedAt, snapshot.disk, snapshot.daily,
                    snapshot.predeploy, snapshot.integrityAlerts == null ? snapshot.alerts :
                            java.util.stream.Stream.concat(snapshot.alerts.stream(), snapshot.integrityAlerts.stream()).distinct().toList());
        }
    }

    private final Path statusFile;
    private final JsonCodec json;
    private final Clock clock;

    public ServerStatusController(@Value("${wuhou.server-status-file:}") String statusFile, JsonCodec json, Clock clock) {
        this.statusFile = statusFile.isBlank() ? null : Path.of(statusFile);
        this.json = json;
        this.clock = clock;
    }

    @GetMapping("/api/admin/server-status")
    public ResponseEntity<ApiResponse<View>> status() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(readStatus()));
    }

    private View readStatus() {
        if (statusFile == null || !Files.isRegularFile(statusFile)) return View.unknown();
        try (var input = Files.newInputStream(statusFile)) {
            byte[] data = input.readNBytes(MAX_BYTES + 1);
            if (data.length > MAX_BYTES) return View.unknown();
            var snapshot = json.read(new String(data, StandardCharsets.UTF_8), Snapshot.class);
            return snapshot != null && snapshot.valid(clock.instant()) ? View.from(snapshot) : View.unknown();
        } catch (IOException | IllegalArgumentException failure) {
            return View.unknown();
        }
    }
}
