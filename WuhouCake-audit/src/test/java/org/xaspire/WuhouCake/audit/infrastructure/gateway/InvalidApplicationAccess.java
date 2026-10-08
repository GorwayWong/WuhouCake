package org.xaspire.WuhouCake.audit.infrastructure.gateway;
import org.xaspire.WuhouCake.audit.application.service.AllowedService;
public record InvalidApplicationAccess(AllowedService service) { }
