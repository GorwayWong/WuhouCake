package org.xaspire.WuhouCake.sample.adapter.web;
import org.xaspire.WuhouCake.sample.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
