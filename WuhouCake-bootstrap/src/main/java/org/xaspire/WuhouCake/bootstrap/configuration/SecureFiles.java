package org.xaspire.WuhouCake.bootstrap.configuration;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;

public final class SecureFiles {
    private SecureFiles() { }
    public static String readPrivate(Path path) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Credential file must be a regular file");
        try {
            var permissions = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
            for (var permission : permissions) if (permission.name().startsWith("GROUP_") || permission.name().startsWith("OTHERS_"))
                throw new IOException("Credential file permissions must exclude group and others");
            if (!permissions.contains(PosixFilePermission.OWNER_READ)) throw new IOException("Credential file must be owner-readable");
        } catch (UnsupportedOperationException failure) { throw new IOException("Owner-only file permissions required"); }
        if (Files.size(path) > 16_384) throw new IOException("Credential file too large");
        return Files.readString(path);
    }
}
