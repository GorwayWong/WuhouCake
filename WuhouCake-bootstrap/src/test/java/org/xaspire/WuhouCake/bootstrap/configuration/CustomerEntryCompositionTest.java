package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.application.service.CustomerSubmissionService;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.CustomerSubmissionMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class CustomerEntryCompositionTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(CustomerEntryComposition.class)
            .withBean(CustomerSubmissionMapper.class, () -> mock(CustomerSubmissionMapper.class))
            .withBean(JsonCodec.class, () -> mock(JsonCodec.class))
            .withBean(IdentityFacade.class, () -> mock(IdentityFacade.class))
            .withBean(OrderService.class, () -> mock(OrderService.class))
            .withBean(AuditFacade.class, () -> mock(AuditFacade.class))
            .withBean(Clock.class, Clock::systemUTC);

    private ApplicationContextRunner origin(String value, String... profiles) {
        return context.withInitializer(application -> application.getEnvironment().setActiveProfiles(profiles))
                .withPropertyValues("wuhoucake.customer-entry.public-origin=" + value);
    }

    @Test void devBindsLanHttpOriginAndCreatesTheSubmissionService() {
        origin("http://192.168.1.20:5173", "dev").run(application -> {
            assertThat(application).hasNotFailed().hasSingleBean(CustomerSubmissionService.class);
            assertThat(application.getBean(CustomerEntryProperties.class).publicOrigin()).isEqualTo("http://192.168.1.20:5173");
        });
    }

    @Test void prodRejectsEveryHttpOriginEvenWhenDevIsAlsoActive() {
        for (var profiles : new String[][]{{"prod"}, {"dev", "prod"}, {"prod", "dev"}}) {
            for (var value : new String[]{"http://192.168.1.20:5173", "http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"}) {
                origin(value, profiles).run(application -> {
                    assertThat(application).hasFailed();
                    assertThat(application.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                            .hasStackTraceContaining("Customer entry requires HTTPS in prod");
                });
            }
        }
    }

    @Test void httpsRemainsAvailableInDevAndProd() {
        for (var profiles : new String[][]{{"dev"}, {"prod"}, {"dev", "prod"}}) {
            origin("https://203.0.113.10", profiles).run(application ->
                    assertThat(application).hasNotFailed().hasSingleBean(CustomerSubmissionService.class));
            origin("https://orders.example.com", profiles).run(application ->
                    assertThat(application).hasNotFailed().hasSingleBean(CustomerSubmissionService.class));
        }
    }

    @Test void automaticOriginIsAvailableOnlyInDevelopment() {
        origin("auto", "dev").run(application -> assertThat(application).hasNotFailed().hasSingleBean(CustomerSubmissionService.class));
        for (var profiles : new String[][]{{}, {"integration"}, {"prod"}, {"dev", "prod"}, {"prod", "dev"}}) {
            origin("auto", profiles).run(application -> {
                assertThat(application).hasFailed();
                assertThat(application.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                        .hasStackTraceContaining("Automatic customer entry origin is only available in dev without prod");
            });
        }
    }

    @Test void otherProfilesKeepLocalHttpButRejectLanHttp() {
        for (var profiles : new String[][]{{}, {"integration"}}) {
            origin("http://localhost:5173", profiles).run(application -> assertThat(application).hasNotFailed());
            origin("http://192.168.1.20:5173", profiles).run(application -> {
                assertThat(application).hasFailed();
                assertThat(application.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class)
                        .hasStackTraceContaining("non-local HTTP origins require the dev profile");
            });
        }
    }

    @Test void devStillRejectsCredentialsPathsQueriesFragmentsAndOtherSchemes() {
        for (var value : new String[]{"http://user:password@192.168.1.20:5173", "http://192.168.1.20:5173/fill",
                "http://192.168.1.20:5173?query=1", "http://192.168.1.20:5173#fragment", "ftp://192.168.1.20:5173", "http:///missing-host"}) {
            origin(value, "dev").run(application -> {
                assertThat(application).hasFailed();
                assertThat(application.getStartupFailure()).hasRootCauseInstanceOf(IllegalArgumentException.class);
            });
        }
    }
}
