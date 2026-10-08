package org.xaspire.WuhouCake.identity.application.service;
import org.xaspire.WuhouCake.identity.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
