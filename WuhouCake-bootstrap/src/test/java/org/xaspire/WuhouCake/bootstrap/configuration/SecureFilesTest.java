package org.xaspire.WuhouCake.bootstrap.configuration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class SecureFilesTest {
    @TempDir Path directory;
    @Test void privateFilesMustBeOwnerOnlyAndNotSymlinks() throws Exception {
        Path file = directory.resolve("credentials.json"); Files.writeString(file, "{}");
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        assertEquals("{}", SecureFiles.readPrivate(file));
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r-----"));
        assertThrows(java.io.IOException.class, () -> SecureFiles.readPrivate(file));
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        Path link = directory.resolve("link"); Files.createSymbolicLink(link, file);
        assertThrows(java.io.IOException.class, () -> SecureFiles.readPrivate(link));
    }
    @Test void malformedCredentialFilesDoNotExposePlaintextInErrors() throws Exception {
        Path file = directory.resolve("bad.json");
        Files.writeString(file, "{\"password\":DO_NOT_LOG_THIS_PASSWORD}");
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
        var failure = assertThrows(IllegalArgumentException.class, () -> IdentityCommands.input(file, new ObjectMapper()));
        assertEquals("Invalid credential file", failure.getMessage()); assertNull(failure.getCause());
        assertFalse(failure.toString().contains("DO_NOT_LOG_THIS_PASSWORD"));
    }
}
