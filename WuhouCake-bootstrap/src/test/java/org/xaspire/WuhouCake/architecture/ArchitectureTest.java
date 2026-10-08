package org.xaspire.WuhouCake.architecture;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption.DoNotIncludeTests;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.CompositeArchRule;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Set;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

@AnalyzeClasses(packages = ArchitectureTest.ROOT, importOptions = DoNotIncludeTests.class)
class ArchitectureTest {
    static final String ROOT = "org.xaspire.WuhouCake";

    @ArchTest
    static final ArchRule domainIsPureJava = classes()
            .that().resideInAPackage(ROOT + "..domain..")
            .should(new ArchCondition<>("depend only on their own domain and core JDK value types") {
                @Override
                public void check(JavaClass source, ConditionEvents events) {
                    String ownDomain = module(source) + ".domain";
                    source.getDirectDependenciesFromSelf().forEach(dependency -> {
                        String target = dependency.getTargetClass().getPackageName();
                        boolean allowed = within(target, ownDomain)
                                || within(target, "java.lang") || within(target, "java.util")
                                || within(target, "java.time") || within(target, "java.math");
                        if (!allowed) {
                            events.add(SimpleConditionEvent.violated(source, dependency.getDescription()));
                        }
                    });
                }
            }).allowEmptyShould(true);

    @ArchTest
    static final ArchRule moduleAndLayerBoundaries = classes()
            .that().resideInAPackage(ROOT + "..")
            .should(new ArchCondition<>("respect module APIs, layer direction and composition root") {
                @Override
                public void check(JavaClass source, ConditionEvents events) {
                    String sourceModule = module(source);
                    String sourceLayer = layer(source);
                    source.getDirectDependenciesFromSelf().forEach(dependency -> {
                        JavaClass target = dependency.getTargetClass();
                        if (!within(target.getPackageName(), ROOT) || sourceModule.equals(ROOT + ".bootstrap")) {
                            return;
                        }
                        String targetModule = module(target);
                        String targetLayer = layer(target);
                        boolean allowed;
                        if (sourceModule.equals(ROOT + ".shared")) {
                            allowed = targetModule.equals(sourceModule);
                        } else if (targetModule.equals(ROOT + ".bootstrap")) {
                            allowed = false;
                        } else if (targetModule.equals(ROOT + ".shared")) {
                            allowed = !sourceLayer.equals("domain");
                        } else if (!sourceModule.equals(targetModule)) {
                            allowed = !sourceLayer.equals("domain") && targetLayer.equals("api");
                        } else {
                            allowed = switch (sourceLayer) {
                                case "api" -> targetLayer.equals("api");
                                case "adapter" -> Set.of("adapter", "application", "api").contains(targetLayer);
                                case "application" -> Set.of("application", "domain", "api").contains(targetLayer);
                                case "domain" -> targetLayer.equals("domain");
                                case "infrastructure" -> Set.of("infrastructure", "domain").contains(targetLayer);
                                default -> false;
                            };
                        }
                        if (!allowed) {
                            events.add(SimpleConditionEvent.violated(source, dependency.getDescription()));
                        }
                    });
                }
            });

    @ArchTest
    static final ArchRule apiDoesNotExposeTechnicalTypes = noClasses()
            .that().resideInAPackage(ROOT + "..api..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework..", "org.mybatis..", "org.apache.ibatis..",
                    "com.baomidou..", "org.hibernate..", "jakarta.persistence..",
                    "io.lettuce..", "redis.clients..",
                    ROOT + ".shared.infrastructure..", ROOT + ".shared.json..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule onlyBootstrapConfiguresBeans = CompositeArchRule.of(noClasses()
            .that().resideInAnyPackage(ROOT + "..infrastructure..", ROOT + ".shared..")
            .should().beMetaAnnotatedWith(org.springframework.stereotype.Component.class)
            .allowEmptyShould(true))
            .and(noClasses().that().resideInAPackage(ROOT + "..application..")
                    .should().beMetaAnnotatedWith(org.springframework.context.annotation.Configuration.class)
                    .allowEmptyShould(true))
            .and(noClasses().that().resideInAPackage(ROOT + "..application..")
                    .and().areNotAnnotatedWith(org.springframework.stereotype.Service.class)
                    .should().beMetaAnnotatedWith(org.springframework.stereotype.Component.class)
                    .allowEmptyShould(true));

    @ArchTest
    static final ArchRule sharedHasNoDomainModel = noClasses()
            .should().resideInAnyPackage(ROOT + ".shared.domain..", ROOT + ".shared.application..");

    @ArchTest
    static final ArchRule modulesHaveNoCycles = slices()
            .matching(ROOT + ".(*)..").should().beFreeOfCycles();

    static String module(JavaClass type) {
        String suffix = type.getPackageName().substring(ROOT.length() + 1);
        return ROOT + "." + suffix.split("\\.")[0];
    }

    static String layer(JavaClass type) {
        String[] parts = type.getPackageName().substring(ROOT.length() + 1).split("\\.");
        return parts.length > 1 ? parts[1] : "";
    }

    private static boolean within(String value, String prefix) {
        return value.equals(prefix) || value.startsWith(prefix + ".");
    }
}
