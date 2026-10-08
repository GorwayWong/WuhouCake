package org.xaspire.WuhouCake.bootstrap.integration;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyPairGenerator;
import java.util.Base64;
import org.springframework.test.context.DynamicPropertyRegistry;

public final class JwtTestKeys {
    private static final Path DIRECTORY;
    static {
        try {
            DIRECTORY = Files.createTempDirectory("wuhoucake-test-keys-");
            var generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
            var pair = generator.generateKeyPair();
            write("private.pem", "PRIVATE KEY", pair.getPrivate().getEncoded());
            write("public.pem", "PUBLIC KEY", pair.getPublic().getEncoded());
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try { Files.deleteIfExists(DIRECTORY.resolve("private.pem")); Files.deleteIfExists(DIRECTORY.resolve("public.pem")); Files.deleteIfExists(DIRECTORY); }
                catch (Exception ignored) { }
            }));
        } catch (Exception failure) { throw new ExceptionInInitializerError(failure); }
    }
    private static void write(String name, String label, byte[] bytes) throws Exception {
        Path path = Files.createFile(DIRECTORY.resolve(name), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        Files.writeString(path, "-----BEGIN " + label + "-----\n" + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(bytes) + "\n-----END " + label + "-----\n");
    }
    public static void properties(DynamicPropertyRegistry registry) {
        registry.add("wuhoucake.identity.private-key", () -> DIRECTORY.resolve("private.pem").toString());
        registry.add("wuhoucake.identity.public-key", () -> DIRECTORY.resolve("public.pem").toString());
        registry.add("wuhoucake.identity.secure-cookie", () -> "false");
    }
    public static String privateKey() { return DIRECTORY.resolve("private.pem").toString(); }
    public static String publicKey() { return DIRECTORY.resolve("public.pem").toString(); }
    private JwtTestKeys() { }
}
