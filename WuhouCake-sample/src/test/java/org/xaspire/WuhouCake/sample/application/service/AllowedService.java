package org.xaspire.WuhouCake.sample.application.service;
import org.xaspire.WuhouCake.sample.api.facade.PublicContract;
import org.xaspire.WuhouCake.sample.domain.model.valobj.CoreValue;
public record AllowedService(CoreValue value) implements PublicContract { }
