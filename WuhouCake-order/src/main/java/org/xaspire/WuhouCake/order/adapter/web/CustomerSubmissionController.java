package org.xaspire.WuhouCake.order.adapter.web;

import java.util.UUID;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.api.command.SubmissionCommands;
import org.xaspire.WuhouCake.order.api.dto.SubmissionViews;
import org.xaspire.WuhouCake.order.application.service.CustomerSubmissionService;
import org.xaspire.WuhouCake.shared.response.*;

@RestController
@RequestMapping("/api/customer-submissions")
public class CustomerSubmissionController {
    private final CustomerSubmissionService service;
    public CustomerSubmissionController(CustomerSubmissionService service) { this.service = service; }
    @GetMapping("/pending-count") public ApiResponse<java.util.Map<String, Long>> pendingCount() {
        return ApiResponse.success(java.util.Map.of("count", service.pendingCount()));
    }
    @GetMapping public ApiResponse<Page<SubmissionViews.Detail>> search(@RequestParam(defaultValue = "true") boolean mine,
            @RequestParam(defaultValue = "PENDING") String status, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size, @RequestParam(defaultValue = "") String keyword) {
        return ApiResponse.success(service.search(mine, status, keyword, page, size));
    }
    @GetMapping("/{id}") public ApiResponse<SubmissionViews.Detail> detail(@PathVariable UUID id) { return ApiResponse.success(service.detail(id)); }
    @PostMapping(value = "/{id}/items/{item}/images/{image}", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<UUID> uploadImage(@PathVariable UUID id, @PathVariable UUID item, @PathVariable UUID image,
            @RequestParam org.springframework.web.multipart.MultipartFile file) throws java.io.IOException {
        return ApiResponse.success(service.stageStaffImage(id, item, image, OrderFileController.readUpload(file), file.getOriginalFilename()));
    }
    @GetMapping("/{id}/items/{item}/images/{image}")
    public org.springframework.http.ResponseEntity<byte[]> image(@PathVariable UUID id, @PathVariable UUID item, @PathVariable UUID image) {
        return PublicOrderEntryController.imageResponse(service.staffImage(id, item, image));
    }
    @PatchMapping("/{id}") public ApiResponse<SubmissionViews.Detail> save(@PathVariable UUID id, @RequestBody SubmissionCommands.Save command) {
        return ApiResponse.success(service.save(id, command));
    }
    @PostMapping("/{id}/confirm") public ApiResponse<SubmissionViews.Detail> confirm(@PathVariable UUID id, @RequestBody SubmissionCommands.Confirm command) {
        return ApiResponse.success(service.confirm(id, command));
    }
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable UUID id, @RequestBody SubmissionCommands.Delete command) {
        service.delete(id, command.expectedVersion()); return ApiResponse.success(null);
    }
    @GetMapping("/entry") public ApiResponse<SubmissionViews.Entry> entry(@RequestParam(required = false) UUID ownerId) {
        return ApiResponse.success(service.entry(ownerId));
    }
    @PostMapping("/entry") public ApiResponse<SubmissionViews.Entry> changeEntry(@RequestParam(required = false) UUID ownerId,
            @RequestBody SubmissionCommands.EntryChange command, @RequestAttribute(value = "wuhoucake.requestId", required = false) String requestId) {
        return ApiResponse.success(service.changeEntry(ownerId, command.action(), requestId));
    }
}
