package org.xaspire.WuhouCake.audit.application.service;
import org.xaspire.WuhouCake.audit.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
