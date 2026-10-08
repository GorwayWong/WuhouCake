package org.xaspire.WuhouCake.identity.adapter.web;
import org.xaspire.WuhouCake.identity.infrastructure.persistence.repository.AllowedRepository;
public record InvalidInfrastructureAccess(AllowedRepository repository) { }
