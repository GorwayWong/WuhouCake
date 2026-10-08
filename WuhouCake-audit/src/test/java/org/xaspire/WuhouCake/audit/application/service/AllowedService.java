package org.xaspire.WuhouCake.audit.application.service;
import org.xaspire.WuhouCake.audit.api.facade.PublicContract;
import org.xaspire.WuhouCake.audit.domain.model.valobj.CoreValue;
public record AllowedService(CoreValue value) implements PublicContract { }
