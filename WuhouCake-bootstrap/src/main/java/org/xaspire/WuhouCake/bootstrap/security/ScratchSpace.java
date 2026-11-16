package org.xaspire.WuhouCake.bootstrap.security;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.*;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

final class ScratchSpace implements AutoCloseable {
    static final long MIB = 1024L * 1024;
    static final long BUDGET = 896 * MIB;
    static final long EXPORT_RESERVATION = 768 * MIB;
    private static final Logger LOG = LoggerFactory.getLogger(ScratchSpace.class);
    private final Path directory;
    private final long capacity;
    private final long freeFloor;
    private final Counter rejections;
    private final Counter cleanupFailures;
    private final FileChannel leaseChannel;
    private final FileLock lease;
    private long reservedBytes;

    ScratchSpace(Path directory, long capacity, long freeFloor, boolean exclusive, MeterRegistry metrics) throws IOException {
        this.directory = directory;
        this.capacity = capacity;
        this.freeFloor = freeFloor;
        this.rejections = metrics.counter("wuhou.temp.rejections");
        this.cleanupFailures = metrics.counter("wuhou.temp.cleanup.failures");
        leaseChannel = exclusive ? FileChannel.open(directory.resolve(".instance.lock"),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS) : null;
        lease = leaseChannel == null ? null : claim(leaseChannel);
        if (lease != null) clean(Instant.MAX);
        metrics.gauge("wuhou.temp.reserved.bytes", this, ScratchSpace::reservedBytes);
        metrics.gauge("wuhou.temp.capacity.bytes", this, space -> space.capacity);
        metrics.gauge("wuhou.temp.free.bytes", this, ScratchSpace::freeBytes);
        metrics.gauge("wuhou.temp.used.bytes", this, ScratchSpace::usedBytes);
    }

    static ScratchSpace open(String configuredDir, MeterRegistry metrics) throws IOException {
        Path jvm = Path.of(System.getProperty("java.io.tmpdir")).toRealPath();
        if (configuredDir.isBlank()) return new ScratchSpace(jvm, BUDGET, 0, false, metrics);
        Path mount = Path.of(configuredDir).toRealPath();
        var store = Files.getFileStore(mount);
        if (!mount.equals(jvm) || mount.getParent() == null || store.equals(Files.getFileStore(mount.getParent()))
                || !(store.type().equals("ext4") || store.type().equals("xfs")) || store.getTotalSpace() < 960 * MIB || store.getTotalSpace() > 1280 * MIB)
            throw new IOException("APP_TEMP_DIR must be a dedicated 1 GiB disk filesystem and match java.io.tmpdir");
        return new ScratchSpace(mount, BUDGET, 64 * MIB, true, metrics);
    }

    private static FileLock claim(FileChannel channel) throws IOException {
        try {
            var lock = channel.tryLock();
            if (lock != null) return lock;
        } catch (OverlappingFileLockException busy) {
            channel.close();
            throw new IOException("Scratch directory already has an application owner", busy);
        } catch (IOException failure) {
            try { channel.close(); } catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
        channel.close();
        throw new IOException("Scratch directory already has an application owner");
    }

    synchronized Reservation reserve(long bytes) {
        if (bytes <= 0) throw new IllegalArgumentException("Reservation must be positive");
        if (bytes > capacity - reservedBytes || bytes > freeBytes() - freeFloor) {
            rejections.increment();
            return null;
        }
        reservedBytes += bytes;
        return new Reservation(bytes);
    }

    synchronized long reservedBytes() { return reservedBytes; }

    private long freeBytes() {
        try { return Files.getFileStore(directory).getUsableSpace(); }
        catch (IOException failure) { return -1; }
    }

    private long usedBytes() {
        try {
            var store = Files.getFileStore(directory);
            return store.getTotalSpace() - store.getUnallocatedSpace();
        } catch (IOException failure) { return -1; }
    }

    @Scheduled(initialDelay = 600_000, fixedDelay = 600_000)
    synchronized void cleanOrphans() {
        if (lease != null && reservedBytes == 0) clean(Instant.now().minus(Duration.ofHours(1)));
    }

    private void clean(Instant cutoff) {
        cleanMatching(directory, cutoff, "wuhoucake-upload-", "wuhoucake-export-");
        Path poi = directory.resolve("poifiles");
        if (Files.isDirectory(poi, LinkOption.NOFOLLOW_LINKS)) cleanMatching(poi, cutoff, "poi-", "poi-sxssf-");
    }

    private void cleanMatching(Path root, Instant cutoff, String... prefixes) {
        try (var entries = Files.newDirectoryStream(root)) {
            for (Path file : entries) {
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
                String name = file.getFileName().toString();
                boolean ours = false;
                for (String prefix : prefixes) if (name.startsWith(prefix)) ours = true;
                if (!ours) continue;
                try {
                    if (Files.getLastModifiedTime(file, LinkOption.NOFOLLOW_LINKS).toInstant().isBefore(cutoff)) Files.deleteIfExists(file);
                } catch (IOException failure) { reportCleanupFailure(failure); }
            }
        } catch (IOException | DirectoryIteratorException failure) { reportCleanupFailure(failure); }
    }

    private void reportCleanupFailure(Exception failure) {
        cleanupFailures.increment();
        LOG.warn("Could not clean an orphan in application scratch storage", failure);
    }

    @Override public void close() throws IOException {
        if (leaseChannel != null) leaseChannel.close();
    }

    final class Reservation implements AutoCloseable {
        private long bytes;
        private Reservation(long bytes) { this.bytes = bytes; }
        @Override public void close() {
            synchronized (ScratchSpace.this) {
                reservedBytes -= bytes;
                bytes = 0;
            }
        }
    }
}
