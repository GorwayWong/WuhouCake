package org.xaspire.WuhouCake.order.infrastructure.files;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** 监督进程不解码图片；限制并发并在墙钟期限后终止解码子进程。 */
public final class ImageWorkerServer implements AutoCloseable {
    private final HttpServer server;
    private final Semaphore admission = new Semaphore(1);
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService requests = new ThreadPoolExecutor(2, 4, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8), new ThreadPoolExecutor.AbortPolicy());
    private final List<String> command;
    private final Duration deadline;
    private volatile Process running;
    private volatile boolean failed;

    public ImageWorkerServer(InetSocketAddress address, List<String> command, Duration deadline) throws IOException {
        this.command = List.copyOf(command); this.deadline = deadline;
        server = HttpServer.create(address, 8);
        server.createContext("/health", exchange -> { try (exchange) { exchange.sendResponseHeaders(failed ? 503 : 200, -1); } });
        server.createContext("/process", this::process);
        server.setExecutor(requests);
    }
    public static List<String> decoderCommand() {
        return List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(), "-Xms16m", "-Xmx128m",
                "-XX:MaxDirectMemorySize=16m", "-XX:MaxMetaspaceSize=64m", "-XX:ReservedCodeCacheSize=32m",
                "-XX:ActiveProcessorCount=1", "-XX:+ExitOnOutOfMemoryError", "-Djava.awt.headless=true",
                "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")), ImageWorkerMain.class.getName());
    }
    public void start() { server.start(); }
    public int port() { return server.getAddress().getPort(); }
    private void process(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("POST") || !exchange.getRequestURI().getPath().equals("/process")) {
            try (exchange) { exchange.sendResponseHeaders(404, -1); } return;
        }
        if (!admission.tryAcquire()) { try (exchange) { respond(exchange, 503, ImageWorkerProtocol.failure("IMAGE_PROCESSING_BUSY")); } return; }
        var expiry = timer.schedule(exchange::close, deadline.toMillis() + 2000, TimeUnit.MILLISECONDS);
        try (exchange) {
            WorkerResponse result;
            try { result = decode(exchange); }
            finally { if (!failed) admission.release(); }
            respond(exchange, result.status(), result.bytes());
        } finally { expiry.cancel(false); }
    }
    private record WorkerResponse(int status, byte[] bytes) {
        static WorkerResponse failure(int status, String code) throws IOException { return new WorkerResponse(status, ImageWorkerProtocol.failure(code)); }
    }
    private WorkerResponse decode(HttpExchange exchange) throws IOException {
        Path input = null, output = null;
        Process process = null;
        long started = System.nanoTime();
        String outcome = "unavailable";
        long expires = System.nanoTime() + deadline.toNanos();
        try {
            input = Files.createTempFile("image-input-", ".bin"); output = Files.createTempFile("image-output-", ".bin");
            try (var source = exchange.getRequestBody(); var target = Files.newOutputStream(input)) {
                byte[] buffer = new byte[8192]; int total = 0, count;
                while ((count = source.read(buffer)) != -1) {
                    total += count;
                    if (total > ImageWorkerProtocol.MAX_MESSAGE) { outcome = "too_large"; return WorkerResponse.failure(422, "IMAGE_TOO_LARGE"); }
                    target.write(buffer, 0, count);
                }
            }
            long remaining = expires - System.nanoTime();
            if (remaining <= 0) { outcome = "timeout"; return WorkerResponse.failure(503, "IMAGE_PROCESSING_TIMEOUT"); }
            var builder = new ProcessBuilder(command).redirectInput(input.toFile()).redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().remove("JAVA_TOOL_OPTIONS"); builder.environment().remove("JDK_JAVA_OPTIONS");
            process = builder.start(); running = process;
            if (!process.waitFor(remaining, TimeUnit.NANOSECONDS)) {
                outcome = "timeout"; return WorkerResponse.failure(503, "IMAGE_PROCESSING_TIMEOUT");
            }
            if (process.exitValue() != 0 || Files.size(output) > ImageWorkerProtocol.MAX_MESSAGE || Files.size(output) == 0) {
                outcome = "process_exit_" + process.exitValue();
                return WorkerResponse.failure(503, "IMAGE_PROCESSING_UNAVAILABLE");
            }
            outcome = "completed"; return new WorkerResponse(200, Files.readAllBytes(output));
        } catch (InterruptedException failure) { Thread.currentThread().interrupt(); return WorkerResponse.failure(503, "IMAGE_PROCESSING_UNAVAILABLE"); }
        catch (IOException | RuntimeException failure) {
            System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING, "Image worker supervision failed", failure);
            return WorkerResponse.failure(503, "IMAGE_PROCESSING_UNAVAILABLE");
        }
        finally {
            System.getLogger(getClass().getName()).log(System.Logger.Level.INFO,
                    "image_processing outcome=" + outcome + " elapsed_ms=" + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
            try { if (process != null) terminate(process); }
            finally {
                failed = process != null && process.isAlive();
                if (!failed) running = null;
                try { if (input != null) Files.deleteIfExists(input); }
                finally { if (output != null) Files.deleteIfExists(output); }
            }
        }
    }
    private static void respond(HttpExchange exchange, int status, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
        exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes);
    }
    private static void terminate(Process process) {
        if (!process.isAlive()) return;
        process.destroyForcibly();
        boolean interrupted = false;
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        try {
            while (process.isAlive()) {
                long remaining = end - System.nanoTime();
                if (remaining <= 0) throw new IllegalStateException("Image worker did not terminate");
                try { process.waitFor(remaining, TimeUnit.NANOSECONDS); }
                catch (InterruptedException failure) { interrupted = true; }
            }
        } finally { if (interrupted) Thread.currentThread().interrupt(); }
    }
    @Override public void close() {
        server.stop(0); requests.shutdownNow(); timer.shutdownNow();
        var process = running; if (process != null) terminate(process);
    }
    public static void main(String[] args) throws IOException {
        var server = new ImageWorkerServer(new InetSocketAddress(8091), decoderCommand(), Duration.ofSeconds(10));
        Runtime.getRuntime().addShutdownHook(new Thread(server::close)); server.start();
    }
}
