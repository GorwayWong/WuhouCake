package org.xaspire.WuhouCake.identity.infrastructure.gateway;
import org.xaspire.WuhouCake.identity.application.service.AllowedService;
public record InvalidApplicationAccess(AllowedService service) { }
