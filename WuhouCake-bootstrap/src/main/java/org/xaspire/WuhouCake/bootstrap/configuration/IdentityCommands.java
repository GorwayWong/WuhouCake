package org.xaspire.WuhouCake.bootstrap.configuration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.io.Writer;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;

@Configuration(proxyBeanMethods = false)
@ConditionalOnNotWebApplication
@ConditionalOnProperty("wuhoucake.identity.command")
public class IdentityCommands {
    public record Input(String employeeNumber, String nickname, String password) {
        @Override public String toString() { return "IdentityCommandInput"; }
    }
    @Bean ApplicationRunner identityCommand(Environment environment, ObjectMapper json, IdentityService identity) {
        return arguments -> {
            String command = environment.getRequiredProperty("wuhoucake.identity.command");
            String file = environment.getRequiredProperty("wuhoucake.identity.credential-file");
            var input = input(Path.of(file), json);
            switch (command) {
                case "init-admin" -> {
                    var account = identity.initializeAdministrator(input.employeeNumber(), input.nickname(), input.password());
                    System.out.println("Administrator initialized: " + account.accountId());
                }
                case "reset-admin-password" -> {
                    String output = environment.getProperty("wuhoucake.identity.credential-output");
                    if (output == null && System.console() == null) throw new IllegalArgumentException("Non-interactive recovery requires credential-output");
                    Writer writer = output == null ? System.console().writer() : Files.newBufferedWriter(
                            Files.createFile(Path.of(output), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))));
                    try {
                        var result = identity.recoverAdministrator(input.employeeNumber());
                        writer.write(result.temporaryPassword()); writer.write(System.lineSeparator()); writer.flush();
                    } finally { if (output != null) writer.close(); }
                    System.out.println("Administrator password reset; change password on next login.");
                }
                default -> throw new IllegalArgumentException("Unsupported identity command");
            }
        };
    }
    static Input input(Path file, ObjectMapper json) throws java.io.IOException {
        String content = SecureFiles.readPrivate(file);
        try { return json.readValue(content, Input.class); }
        catch (java.io.IOException failure) { throw new IllegalArgumentException("Invalid credential file"); }
    }
}
