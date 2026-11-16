package org.xaspire.WuhouCake.bootstrap.security;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ScratchSpaceTest {
    @TempDir Path directory;

    @Test void reservationsRejectAtTheBoundaryAndRecoverAfterAnException() throws Exception {
        var meters = new SimpleMeterRegistry();
        try (var scratch = new ScratchSpace(directory, 100, 0, false, meters)) {
            try (var first = scratch.reserve(60)) {
                assertNotNull(first);
                assertEquals(60, scratch.reservedBytes());
                assertNull(scratch.reserve(41));
                assertThrows(IllegalStateException.class, () -> {
                    try (var second = scratch.reserve(40)) {
                        assertNotNull(second);
                        assertEquals(100, scratch.reservedBytes());
                        throw new IllegalStateException("simulated task failure");
                    }
                });
                assertEquals(60, scratch.reservedBytes());
                assertEquals(1, meters.counter("wuhou.temp.rejections").count());
            }
            assertEquals(0, scratch.reservedBytes());
        }
    }

    @Test void cleanupHonorsRunningTasksOwnershipAndGracePeriod() throws Exception {
        var old = Files.writeString(directory.resolve("wuhoucake-upload-old.bin"), "old process");
        var unrelated = Files.writeString(directory.resolve("keep-me"), "unrelated");
        var meters = new SimpleMeterRegistry();
        try (var scratch = new ScratchSpace(directory, 100, 0, true, meters)) {
            assertFalse(Files.exists(old));
            assertTrue(Files.exists(unrelated));
            assertThrows(java.io.IOException.class, () -> new ScratchSpace(directory, 100, 0, true, meters));
            var leftover = Files.writeString(directory.resolve("wuhoucake-export-leftover.zip"), "leftover");
            Files.setLastModifiedTime(leftover, FileTime.from(Instant.now().minusSeconds(7200)));
            var fresh = Files.writeString(directory.resolve("wuhoucake-export-fresh.zip"), "fresh");
            try (var active = scratch.reserve(1)) {
                assertNotNull(active);
                scratch.cleanOrphans();
                assertTrue(Files.exists(leftover));
            }
            scratch.cleanOrphans();
            assertFalse(Files.exists(leftover));
            assertTrue(Files.exists(fresh));
            assertTrue(Files.exists(unrelated));
            assertTrue(Files.isDirectory(directory));
        }
    }
}
