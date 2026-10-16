package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.api.command.RecognitionCommands;
import org.xaspire.WuhouCake.order.api.dto.RecognitionViews;
import org.xaspire.WuhouCake.order.application.service.OrderRecognitionService;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
@RequestMapping("/api/orders/recognition")
public class OrderRecognitionController {
    private final OrderRecognitionService recognition;
    public OrderRecognitionController(OrderRecognitionService recognition) { this.recognition = recognition; }
    @PostMapping("/parse")
    public ResponseEntity<ApiResponse<RecognitionViews.Draft>> parse(@Valid @RequestBody RecognitionCommands.Parse request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(recognition.parse(request.text())));
    }
    @PostMapping("/assist")
    public ResponseEntity<ApiResponse<RecognitionViews.Assist>> assist(@Valid @RequestBody RecognitionCommands.Assist request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(recognition.assist(request.text(), request.allowExternalProcessing())));
    }
}
