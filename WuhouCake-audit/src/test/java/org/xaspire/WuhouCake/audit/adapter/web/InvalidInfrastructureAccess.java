package org.xaspire.WuhouCake.audit.adapter.web;
import org.xaspire.WuhouCake.audit.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
