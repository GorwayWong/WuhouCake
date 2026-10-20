package org.xaspire.WuhouCake.identity.application;

import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.*;
import org.xaspire.WuhouCake.identity.domain.repository.Accounts;
import org.xaspire.WuhouCake.shared.id.IdGenerator;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class IdentityLoginTest {
    private final Accounts accounts = mock(Accounts.class);
    private final Credentials credentials = mock(Credentials.class);
    private final Attempts attempts = mock(Attempts.class);
    private final Attempts.Attempt attempt = mock(Attempts.Attempt.class);
    private IdentityService service;

    @BeforeEach void setup() {
        service = new IdentityService(accounts, credentials, mock(Sessions.class), attempts, mock(AccessTokens.class),
                mock(ActorSource.class), mock(AuditFacade.class), mock(IdGenerator.class), Clock.systemUTC(),
                Duration.ofMinutes(5), Duration.ofDays(1), mock(ApplicationEventPublisher.class));
        clearInvocations(credentials);
        when(attempts.begin("0001")).thenReturn(attempt);
    }

    @Test void rejectedCredentialsCountOnceAndCloseTheirReservation() {
        when(accounts.findByNumber("0001")).thenReturn(Optional.empty());
        assertEquals("AUTHENTICATION_FAILED", assertThrows(IdentityFailure.class, () -> service.login("0001", "wrong", "test")).code());
        verify(attempt).failed(); verify(attempt).close(); verify(attempt, never()).succeeded();
    }

    @Test void infrastructureFailureReleasesTheReservationWithoutCountingABadPassword() {
        when(accounts.findByNumber("0001")).thenThrow(new IllegalStateException("unavailable"));
        assertThrows(IllegalStateException.class, () -> service.login("0001", "wrong", "test"));
        verify(attempt).close(); verify(attempt, never()).failed(); verify(attempt, never()).succeeded();
        verifyNoInteractions(credentials);
    }

    @Test void exhaustedBudgetRejectsBeforeReadingAccountsOrCheckingPasswords() {
        when(attempts.begin("0001")).thenThrow(new IdentityFailure("LOGIN_THROTTLED"));
        assertEquals("LOGIN_THROTTLED", assertThrows(IdentityFailure.class, () -> service.login("0001", "wrong", "test")).code());
        verifyNoInteractions(accounts, credentials, attempt);
    }
}
