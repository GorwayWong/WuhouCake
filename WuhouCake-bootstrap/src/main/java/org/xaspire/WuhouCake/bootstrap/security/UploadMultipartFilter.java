package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.apache.tomcat.util.http.fileupload.FileItemHeaders;
import org.apache.tomcat.util.http.fileupload.FileUpload;
import org.apache.tomcat.util.http.fileupload.MultipartStream;
import org.apache.tomcat.util.http.fileupload.impl.FileUploadIOException;
import org.apache.tomcat.util.http.fileupload.util.LimitedInputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.shared.response.ApiResponse;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

/** Parses admitted upload bodies exactly once, with per-route and per-part byte budgets. */
final class UploadMultipartFilter extends OncePerRequestFilter {
    static final long ORDER_REQUEST_BYTES = 6L * 1024 * 1024;
    static final long PACKAGE_REQUEST_BYTES = 65L * 1024 * 1024;
    private static final int PACKAGE_JSON_BYTES = 256 * 1024;
    private static final int ITEM_ID_BYTES = 36;
    private static final Logger LOG = LoggerFactory.getLogger(UploadMultipartFilter.class);
    private final ObjectMapper mapper;
    private final MeterRegistry metrics;

    UploadMultipartFilter(ObjectMapper mapper, MeterRegistry metrics) {
        this.mapper = mapper;
        this.metrics = metrics;
    }

    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !ImageUploadAdmissionFilter.matches(request);
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        boolean packageUpload = ImageUploadAdmissionFilter.isPackage(request);
        var parts = new LinkedHashMap<String, UploadPart>();
        try {
            HttpServletRequest parsed;
            try {
                parsed = parse(request, packageUpload, parts);
            } catch (Rejected rejected) {
                reject(response, rejected.status, rejected.code, rejected.getMessage());
                return;
            } catch (StagingFailure failure) {
                LOG.warn("Unable to stage multipart upload", failure.getCause());
                reject(response, 503, "TEMP_STORAGE_UNAVAILABLE", "临时空间不足，请稍后重试");
                return;
            } catch (MultipartStream.MalformedStreamException | FileUploadIOException | IllegalArgumentException failure) {
                reject(response, 400, "INVALID_UPLOAD_PARTS", "上传字段或文件格式无效");
                return;
            }
            chain.doFilter(parsed, response);
        } finally {
            for (var part : parts.values()) {
                try { part.delete(); }
                catch (IOException failure) {
                    metrics.counter("wuhou.temp.cleanup.failures").increment();
                    LOG.warn("Could not delete multipart staging file", failure);
                }
            }
        }
    }

    private static HttpServletRequest parse(HttpServletRequest request, boolean packageUpload, Map<String, UploadPart> parts)
            throws IOException {
        boolean submissionUpload = ImageUploadAdmissionFilter.isSubmission(request);
        UUID queryItem = packageUpload || submissionUpload ? null : queryItemId(request.getQueryString());
        long maxBody = packageUpload ? PACKAGE_REQUEST_BYTES : ORDER_REQUEST_BYTES;
        if (request.getContentLengthLong() > maxBody) throw tooLarge("UPLOAD_REQUEST_TOO_LARGE", "上传请求超过大小上限");
        var grammar = new FileUpload();
        byte[] boundary = grammar.getBoundary(request.getContentType());
        if (boundary == null || boundary.length == 0 || boundary.length > 70) throw invalid();
        var body = new LimitedInputStream(request.getInputStream(), maxBody) {
            @Override protected void raiseError(long maximum, long received) {
                throw tooLarge("UPLOAD_REQUEST_TOO_LARGE", "上传请求超过大小上限");
            }
        };
        var stream = new MultipartStream(body, boundary, null);
        stream.setPartHeaderSizeMax(1024);
        stream.setHeaderEncoding(StandardCharsets.UTF_8.name());
        long imageBytes = 0;
        var imageIds = new HashSet<UUID>();
        boolean hasPart = stream.skipPreamble();
        while (hasPart) {
            if (parts.size() >= (packageUpload ? PACKAGE_IMAGES + 1 : submissionUpload ? 1 : 2)) throw invalid();
            var headers = grammar.getParsedHeaders(stream.readHeaders());
            String name = grammar.getFieldName(headers);
            String filename = grammar.getFileName(headers);
            String partType = headers.getHeader("Content-Type");
            if (name == null || parts.containsKey(name)
                    || partType != null && partType.toLowerCase(Locale.ROOT).startsWith("multipart/")) throw invalid();

            var input = stream.newInputStream();
            if (packageUpload && name.equals("package")) {
                parts.put(name, new UploadPart(name, filename, headers, readSmall(input, PACKAGE_JSON_BYTES,
                        "套餐 JSON 不得超过 256 KiB"), null, 0));
            } else if (!packageUpload && !submissionUpload && name.equals("itemId") && filename == null) {
                parts.put(name, new UploadPart(name, null, headers, readSmall(input, ITEM_ID_BYTES, "商品标识过长"), null, 0));
            } else {
                if (filename == null || filename.isBlank()) throw invalid();
                if (packageUpload) {
                    UUID imageId = UUID.fromString(name);
                    if (!imageId.toString().equalsIgnoreCase(name) || imageIds.size() >= PACKAGE_IMAGES || !imageIds.add(imageId))
                        throw invalid();
                } else if (!name.equals("file")) throw invalid();
                Path path;
                try { path = Files.createTempFile("wuhoucake-upload-", ".bin"); }
                catch (IOException failure) { throw new StagingFailure(failure); }
                parts.put(name, new UploadPart(name, filename, headers, null, path, 0));
                long remaining = packageUpload ? PACKAGE_IMAGE_BYTES - imageBytes : IMAGE_BYTES;
                long limit = Math.min(IMAGE_BYTES, remaining);
                long size;
                try (var output = Files.newOutputStream(path)) {
                    size = copyAtMost(input, output, limit);
                } catch (MultipartStream.MalformedStreamException malformed) {
                    throw malformed;
                } catch (IOException failure) {
                    throw new StagingFailure(failure);
                }
                if (input.read() != -1) {
                    if (remaining < IMAGE_BYTES) throw tooLarge("IMAGE_BATCH_TOO_LARGE", "本次图片总大小超过上限");
                    throw tooLarge("IMAGE_TOO_LARGE", "单张图片不得超过 5 MiB");
                }
                imageBytes += size;
                parts.put(name, new UploadPart(name, filename, headers, null, path, size));
            }
            hasPart = stream.readBoundary();
        }
        // Count the complete decoded HTTP body, including an optional multipart epilogue.
        body.transferTo(OutputStream.nullOutputStream());
        if (packageUpload) {
            if (!parts.containsKey("package")) throw invalid();
            return new ParsedRequest(request, parts, null);
        }
        if (submissionUpload) {
            if (!parts.containsKey("file")) throw invalid();
            return new ParsedRequest(request, parts, null);
        }
        var itemPart = parts.get("itemId");
        UUID bodyItem = itemPart == null ? null : itemId(new String(itemPart.data(), StandardCharsets.UTF_8));
        UUID item = bodyItem == null ? queryItem : bodyItem;
        if (!parts.containsKey("file") || item == null || queryItem != null && !queryItem.equals(item)) throw invalid();
        return new ParsedRequest(request, parts, item);
    }

    private static UUID queryItemId(String query) {
        if (query == null) return null;
        UUID item = null;
        for (String parameter : query.split("&")) {
            String[] pair = parameter.split("=", 2);
            if (!URLDecoder.decode(pair[0], StandardCharsets.UTF_8).equals("itemId")) continue;
            if (item != null || pair.length != 2) throw invalid();
            item = itemId(URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
        }
        return item;
    }

    private static UUID itemId(String value) {
        UUID id = UUID.fromString(value);
        if (!id.toString().equalsIgnoreCase(value)) throw invalid();
        return id;
    }

    private static long copyAtMost(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[8192];
        long copied = 0;
        while (copied < limit) {
            int count = input.read(buffer, 0, (int) Math.min(buffer.length, limit - copied));
            if (count == -1) break;
            output.write(buffer, 0, count);
            copied += count;
        }
        return copied;
    }

    private static byte[] readSmall(InputStream input, int limit, String message) throws IOException {
        byte[] data = input.readNBytes(limit + 1);
        if (data.length > limit) throw tooLarge("UPLOAD_PART_TOO_LARGE", message);
        return data;
    }

    private void reject(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        mapper.writeValue(response.getOutputStream(), ApiResponse.failure(code, message));
    }

    private static Rejected invalid() { return new Rejected(400, "INVALID_UPLOAD_PARTS", "上传字段缺失、重复或不受支持"); }
    private static Rejected tooLarge(String code, String message) { return new Rejected(413, code, message); }

    private static final class StagingFailure extends RuntimeException {
        StagingFailure(IOException cause) { super(cause); }
    }

    private static final class Rejected extends RuntimeException {
        private final int status;
        private final String code;
        Rejected(int status, String code, String message) { super(message); this.status = status; this.code = code; }
    }

    private static final class ParsedRequest extends HttpServletRequestWrapper {
        private final Map<String, UploadPart> parts;
        private final Map<String, String[]> parameters;
        ParsedRequest(HttpServletRequest request, Map<String, UploadPart> parts, UUID itemId) {
            super(request);
            this.parts = parts;
            this.parameters = itemId == null ? Map.of() : Map.of("itemId", new String[]{itemId.toString()});
        }
        @Override public Collection<Part> getParts() { return List.copyOf(parts.values()); }
        @Override public Part getPart(String name) { return parts.get(name); }
        @Override public Map<String, String[]> getParameterMap() { return parameters; }
        @Override public Enumeration<String> getParameterNames() { return Collections.enumeration(parameters.keySet()); }
        @Override public String[] getParameterValues(String name) { return parameters.get(name); }
        @Override public String getParameter(String name) {
            var values = parameters.get(name);
            return values == null ? null : values[0];
        }
    }

    private record UploadPart(String name, String filename, FileItemHeaders headers, byte[] data, Path path, long size) implements Part {
        @Override public InputStream getInputStream() throws IOException {
            return path == null ? new ByteArrayInputStream(data) : Files.newInputStream(path);
        }
        @Override public String getName() { return name; }
        @Override public String getSubmittedFileName() { return filename; }
        @Override public String getContentType() { return getHeader("Content-Type"); }
        @Override public long getSize() { return path == null ? data.length : size; }
        @Override public String getHeader(String name) { return headers.getHeader(name); }
        @Override public Collection<String> getHeaderNames() { return collect(headers.getHeaderNames()); }
        @Override public Collection<String> getHeaders(String name) { return collect(headers.getHeaders(name)); }
        @Override public void delete() throws IOException { if (path != null) Files.deleteIfExists(path); }
        @Override public void write(String filename) throws IOException {
            throw new IOException("Upload parts are read-only");
        }
        private static List<String> collect(Iterator<String> source) {
            var result = new ArrayList<String>();
            source.forEachRemaining(result::add);
            return result;
        }
    }
}
