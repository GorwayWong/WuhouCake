package org.xaspire.WuhouCake.consumer.domain;
import org.springframework.stereotype.Component;
import org.xaspire.WuhouCake.provider.api.PublicContract;
@Component
public record InvalidDomain(PublicContract contract) { }
