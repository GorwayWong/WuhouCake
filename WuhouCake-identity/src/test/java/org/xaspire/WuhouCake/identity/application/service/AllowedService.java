package org.xaspire.WuhouCake.identity.application.service;
import org.xaspire.WuhouCake.identity.api.facade.PublicContract;
import org.xaspire.WuhouCake.identity.domain.model.valobj.CoreValue;
public record AllowedService(CoreValue value) implements PublicContract { }
