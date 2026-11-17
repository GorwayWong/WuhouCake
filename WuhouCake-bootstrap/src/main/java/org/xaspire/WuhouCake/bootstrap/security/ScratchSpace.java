package org.xaspire.WuhouCake.bootstrap.security;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.time.Instant;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

final class ScratchSpace implements AutoCloseable {
    static final long MIB = 1024L * 1024;
    static final long BUDGET = 896 * MIB;
    static final long EXPORT_RESERVATION = 768 * MIB;
    private static final long FREE_FLOOR = 64 * MIB;
    private static final Logger LOG = LoggerFactory.getLogger(ScratchSpace.class);
    private final Path directory;
    private final long capacity;
    private final long freeFloor;
    private final LongSupplier usableSpace;
    private final Counter rejections;
    private final Counter cleanupFailures;
    private final FileChannel leaseChannel;
    private final FileLock lease;
    private long reservedBytes;

    ScratchSpace(Path directory, long capacity, long freeFloor, boolean exclusive, MeterRegistry metrics) throws IOException {
        this(directory, capacity, freeFloor, exclusive, metrics, () -> usableSpace(directory));
    }

    ScratchSpace(Path directory, long capacity, long freeFloor, boolean exclusive, MeterRegistry metrics,
                 LongSupplier usableSpace) throws IOException {
        this.directory = directory;
        this.capacity = capacity;
        this.freeFloor = freeFloor;
        this.usableSpace = usableSpace;
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

    static ScratchSpace open(boolean managed, boolean requireMount, String multipartDirectory, MeterRegistry metrics) throws IOException {
        Path directory = Path.of(System.getProperty("java.io.tmpdir")).toRealPath();
        boolean exclusive = managed || requireMount;
        if (exclusive && (!Files.isDirectory(directory) || !Files.isWritable(directory)
                || !Files.getPosixFilePermissions(directory).equals(PosixFilePermissions.fromString("rwx------"))
                || !directory.equals(Path.of(multipartDirectory).toRealPath()))) {
            throw new IOException("Scratch must be a private writable directory (0700) shared by java.io.tmpdir and Multipart");
        }
        if (requireMount) {
            var store = Files.getFileStore(directory);
            if (!(store.type().equals("ext4") || store.type().equals("xfs")) || !isDedicatedMount(directory, store)) {
                throw new IOException("APP_SCRATCH_REQUIRE_MOUNT requires the root of a dedicated ext4 or XFS filesystem at " + directory);
            }
        }
        var scratch = new ScratchSpace(directory, BUDGET, FREE_FLOOR, exclusive, metrics);
        if (requireMount && scratch.freeBytes() < BUDGET + FREE_FLOOR) {
            try (scratch) {
                throw new IOException("Dedicated scratch requires at least 960 MiB of readable usable space at " + directory);
            }
        }
        return scratch;
    }

    private static boolean isDedicatedMount(Path directory, FileStore store) throws IOException {
        if (directory.getParent() == null || store.equals(Files.getFileStore(directory.getParent()))) return false;
        // Linux mountinfo distinguishes a filesystem root from a bind mount of one of its subdirectories.
        String target = directory.toString().replace("\\", "\\134").replace(" ", "\\040")
                .replace("\t", "\\011").replace("\n", "\\012");
        try (var mounts = Files.lines(Path.of("/proc/self/mountinfo"))) {
            return mounts.map(line -> line.split(" ", 6))
                    .anyMatch(fields -> fields.length == 6 && fields[3].equals("/") && fields[4].equals(target));
        }
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
        long usable = freeBytes();
        // Count the whole reservation even if some bytes have already been written.
        if (bytes > capacity - reservedBytes || usable < freeFloor || usable - freeFloor - reservedBytes < bytes) {
            rejections.increment();
            return null;
        }
        reservedBytes += bytes;
        return new Reservation(bytes);
    }

    synchronized long reservedBytes() { return reservedBytes; }

    private long freeBytes() {
        return usableSpace.getAsLong();
    }

    private static long usableSpace(Path directory) {
        try { return Files.getFileStore(directory).getUsableSpace(); }
        catch (IOException | SecurityException failure) { return -1; }
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
        cleanMatching(directory, cutoff, "wuhoucake-upload-", "wuhoucake-export-", "upload_");
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
