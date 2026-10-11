package org.xaspire.WuhouCake.order.architecture;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption.DoNotIncludeTests;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

@AnalyzeClasses(packages = ModuleArchitectureTest.MODULE_PACKAGE, importOptions = DoNotIncludeTests.class)
class ModuleArchitectureTest {
    static final String PROJECT_PACKAGE = "org.xaspire.WuhouCake";
    static final String MODULE_PACKAGE = "org.xaspire.WuhouCake.order";

    @ArchTest
    static final ArchRule domainIsPureJava = classes().that().resideInAPackage(MODULE_PACKAGE + ".domain..")
            .should().onlyDependOnClassesThat().resideInAnyPackage(MODULE_PACKAGE + ".domain..",
                    "java.lang..", "java.util..", "java.time..", "java.math..");

    @ArchTest
    static final ArchRule internalLayers = layeredArchitecture().consideringOnlyDependenciesInLayers()
            .layer("API").definedBy(MODULE_PACKAGE + ".api..")
            .layer("Adapter").definedBy(MODULE_PACKAGE + ".adapter..")
            .layer("Application").definedBy(MODULE_PACKAGE + ".application..")
            .layer("Domain").definedBy(MODULE_PACKAGE + ".domain..")
            .layer("Infrastructure").definedBy(MODULE_PACKAGE + ".infrastructure..")
            .whereLayer("API").mayNotAccessAnyLayer()
            .whereLayer("Adapter").mayOnlyAccessLayers("API", "Application")
            .whereLayer("Application").mayOnlyAccessLayers("API", "Domain")
            .whereLayer("Domain").mayNotAccessAnyLayer()
            .whereLayer("Infrastructure").mayOnlyAccessLayers("Domain");

    @ArchTest
    static final ArchRule apiDoesNotExposeTechnicalTypes = noClasses().that().resideInAPackage(MODULE_PACKAGE + ".api..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "org.mybatis..", "org.apache.ibatis..",
                    "com.baomidou..", "org.hibernate..", "jakarta.persistence..", "io.lettuce..", "redis.clients..",
                    PROJECT_PACKAGE + ".shared.infrastructure..", PROJECT_PACKAGE + ".shared.json..");

    @ArchTest
    static final ArchRule externalModulesAreAccessedThroughApi = noClasses().that().resideInAPackage(MODULE_PACKAGE + "..")
            .should().dependOnClassesThat(DescribedPredicate.<JavaClass>describe("another module's internals or bootstrap", target -> {
                String name = target.getPackageName();
                if (!within(name, PROJECT_PACKAGE) || within(name, MODULE_PACKAGE) || within(name, PROJECT_PACKAGE + ".shared")) return false;
                String[] parts = name.substring(PROJECT_PACKAGE.length() + 1).split("\\.");
                return parts[0].equals("bootstrap") || parts.length < 2 || !parts[1].equals("api");
            }));

    private static boolean within(String value, String prefix) { return value.equals(prefix) || value.startsWith(prefix + "."); }
}
