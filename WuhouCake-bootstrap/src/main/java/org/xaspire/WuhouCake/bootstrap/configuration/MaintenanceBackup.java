package org.xaspire.WuhouCake.bootstrap.configuration;

import java.io.IOException;
import java.nio.file.*;
import java.util.Arrays;
import org.springframework.core.env.Environment;

final class MaintenanceBackup {
    private MaintenanceBackup() { }
    static Path require(Environment environment) throws IOException {
        Path backup = Path.of(environment.getRequiredProperty("wuhoucake.maintenance.backup"));
        if (!Files.isRegularFile(backup)) throw new IllegalStateException("请先备份数据库并指定 wuhoucake.maintenance.backup");
        try (var input = Files.newInputStream(backup)) {
            if (!Arrays.equals(input.readNBytes(5), new byte[] {'P', 'G', 'D', 'M', 'P'})) throw new IllegalStateException("维护命令需要 pg_dump -Fc 生成的数据库备份");
        }
        return backup;
    }
}
