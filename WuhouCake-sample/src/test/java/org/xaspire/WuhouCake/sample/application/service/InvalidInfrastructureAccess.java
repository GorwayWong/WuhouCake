package org.xaspire.WuhouCake.sample.application.service;
import org.xaspire.WuhouCake.sample.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
