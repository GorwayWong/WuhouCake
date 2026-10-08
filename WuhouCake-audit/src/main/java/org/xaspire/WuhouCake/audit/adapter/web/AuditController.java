package org.xaspire.WuhouCake.audit.adapter.web;

import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.shared.response.ApiResponse;
import org.xaspire.WuhouCake.shared.response.Page;

@RestController
@RequestMapping("/api/admin/audit-logs")
public class AuditController {
    private final AuditFacade audit;
    public AuditController(AuditFacade audit) { this.audit = audit; }
    @GetMapping
    public ApiResponse<Page<AuditFacade.Entry>> query(@RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) String action, @RequestParam(required = false) String result,
            @RequestParam(required = false) Instant from, @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(audit.query(new AuditFacade.Query(actorId, action, result, from, to, page, size)));
    }
}
