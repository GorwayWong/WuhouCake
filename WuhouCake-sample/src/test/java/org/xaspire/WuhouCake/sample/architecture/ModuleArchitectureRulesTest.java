package org.xaspire.WuhouCake.sample.architecture;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModuleArchitectureRulesTest {
    private static final String MODULE = ModuleArchitectureTest.MODULE_PACKAGE;

    @Test
    void allowedLayerDependenciesPass() throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(
                type("api.facade.PublicContract"),
                type("adapter.web.AllowedInput"),
                type("application.service.AllowedService"),
                type("domain.model.valobj.CoreValue"),
                type("infrastructure.persistence.repository.AllowedRepository"));
        assertFalse(ModuleArchitectureTest.internalLayers.evaluate(classes).hasViolation());
        assertFalse(ModuleArchitectureTest.domainIsPureJava.evaluate(classes).hasViolation());
    }

    @ParameterizedTest
    @MethodSource("invalidLayerTypes")
    void invalidLayerDirectionsAreRejected(String name) throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(type(name));
        assertTrue(ModuleArchitectureTest.internalLayers.evaluate(classes).hasViolation());
    }

    static Stream<String> invalidLayerTypes() {
        return Stream.of(
                "adapter.web.InvalidInfrastructureAccess",
                "application.service.InvalidInfrastructureAccess",
                "domain.service.InvalidApplicationAccess",
                "infrastructure.gateway.InvalidApplicationAccess",
                "api.dto.InvalidDomainLeak");
    }

    @Test
    void domainRejectsFrameworkTypes() throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(type("domain.service.InvalidFrameworkAccess"));
        assertTrue(ModuleArchitectureTest.domainIsPureJava.evaluate(classes).hasViolation());
    }

    @Test
    void apiRejectsTechnicalTypes() throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(type("api.dto.InvalidTechnicalLeak"));
        assertTrue(ModuleArchitectureTest.apiDoesNotExposeTechnicalTypes.evaluate(classes).hasViolation());
    }

    @Test
    void externalModuleApiIsAllowed() throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(type("application.service.AllowedExternalApi"));
        assertFalse(ModuleArchitectureTest.externalModulesAreAccessedThroughApi.evaluate(classes).hasViolation());
    }

    @Test
    void externalModuleInfrastructureIsRejected() throws ClassNotFoundException {
        var classes = new ClassFileImporter().importClasses(type("application.service.InvalidExternalInternalAccess"));
        assertTrue(ModuleArchitectureTest.externalModulesAreAccessedThroughApi.evaluate(classes).hasViolation());
    }

    private static Class<?> type(String name) throws ClassNotFoundException {
        return Class.forName(MODULE + "." + name);
    }
}
