package org.xaspire.WuhouCake.order.adapter.web;

import com.fasterxml.jackson.databind.*;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.api.command.SubmissionCommands;
import org.xaspire.WuhouCake.order.api.dto.SubmissionViews;
import org.xaspire.WuhouCake.order.application.service.CustomerSubmissionService;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
public class PublicOrderEntryController {
    private final CustomerSubmissionService service; private final ObjectReader reader;
    public PublicOrderEntryController(CustomerSubmissionService service, ObjectMapper json) {
        this.service = service; this.reader = json.readerFor(SubmissionCommands.Content.class)
                .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).with(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                .without(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
    }
    @GetMapping("/api/public/order-entries/{token}") public ApiResponse<SubmissionViews.PublicEntry> entry(@PathVariable String token) {
        return ApiResponse.success(service.publicEntry(token));
    }
    @PostMapping(value = "/api/public/order-entries/{token}/submissions", consumes = "application/json") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<SubmissionViews.Receipt> submit(@PathVariable String token, @RequestHeader("Idempotency-Key") UUID requestId, @RequestBody String body) {
        try { return ApiResponse.success(service.submit(token, requestId, reader.readValue(body))); }
        catch (IOException failure) { throw new IllegalArgumentException("Invalid customer submission", failure); }
    }
    @PostMapping(value = "/api/public/order-entries/{token}/items/{item}/images/{image}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<UUID> uploadImage(@PathVariable String token, @PathVariable UUID item, @PathVariable UUID image,
            @RequestParam MultipartFile file) throws IOException {
        return ApiResponse.success(service.stagePublicImage(token, item, image, OrderFileController.readUpload(file), file.getOriginalFilename()));
    }
    @GetMapping("/api/public/order-entries/{token}/items/{item}/images/{image}")
    public ResponseEntity<byte[]> image(@PathVariable String token, @PathVariable UUID item, @PathVariable UUID image) {
        return imageResponse(service.publicImage(token, item, image));
    }

    static ResponseEntity<byte[]> imageResponse(SubmissionViews.ImageContent image) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType())).cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff").contentLength(image.bytes().length).body(image.bytes());
    }
    @GetMapping("/api/orders/{orderId}/customer-origin") public ApiResponse<SubmissionViews.Origin> origin(@PathVariable UUID orderId) {
        return ApiResponse.success(service.origin(orderId));
    }
}
