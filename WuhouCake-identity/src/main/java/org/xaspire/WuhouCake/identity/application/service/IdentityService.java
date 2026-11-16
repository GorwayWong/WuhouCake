package org.xaspire.WuhouCake.identity.application.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.entity.LoginSession;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.*;
import org.xaspire.WuhouCake.identity.domain.repository.Accounts;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.response.Page;

@Service
public class IdentityService implements IdentityFacade {
    private static final Logger LOG = LoggerFactory.getLogger(IdentityService.class);
    private final Accounts accounts;
    private final Credentials credentials;
    private final Sessions sessions;
    private final Attempts attempts;
    private final AccessTokens tokens;
    private final ActorSource actors;
    private final AuditFacade audit;
    private final IdGenerator ids;
    private final Clock clock;
    private final Duration accessLifetime;
    private final Duration sessionLifetime;
    private final ApplicationEventPublisher events;
    private final EmployeeAccessPolicy accessPolicy;
    private final String dummyHash;
    private final AtomicLong auditFailures = new AtomicLong();

    public IdentityService(Accounts accounts, Credentials credentials, Sessions sessions, Attempts attempts,
            AccessTokens tokens, ActorSource actors, AuditFacade audit, IdGenerator ids, Clock clock,
            Duration accessLifetime, Duration sessionLifetime, ApplicationEventPublisher events) {
        this(accounts, credentials, sessions, attempts, tokens, actors, audit, ids, clock, accessLifetime, sessionLifetime,
                events, new EmployeeAccessPolicy(java.util.Map.of()));
    }
    public IdentityService(Accounts accounts, Credentials credentials, Sessions sessions, Attempts attempts,
            AccessTokens tokens, ActorSource actors, AuditFacade audit, IdGenerator ids, Clock clock,
            Duration accessLifetime, Duration sessionLifetime, ApplicationEventPublisher events, EmployeeAccessPolicy accessPolicy) {
        this.accounts = accounts; this.credentials = credentials; this.sessions = sessions; this.attempts = attempts;
        this.tokens = tokens; this.actors = actors; this.audit = audit; this.ids = ids; this.clock = clock;
        this.accessLifetime = accessLifetime; this.sessionLifetime = sessionLifetime;
        this.events = events;
        this.accessPolicy = accessPolicy;
        this.dummyHash = credentials.encode(credentials.temporaryPassword());
    }
    @Override public Login login(String number, String password, String requestId) {
        number = AccountValues.employeeNumber(number);
        if (password == null || password.codePointCount(0, password.length()) > 128) throw new IdentityFailure("VALIDATION_FAILED");
        try (var attempt = attempts.begin(number)) {
            var found = accounts.findByNumber(number);
            boolean matched = credentials.matches(password, found.map(EmployeeAccount::passwordHash).orElse(dummyHash));
            if (!matched || found.isEmpty() || found.get().status() != Status.ACTIVE) {
                attempt.failed();
                throw new IdentityFailure("AUTHENTICATION_FAILED");
            }
            var account = found.get();
            attempt.succeeded();
            String secret = credentials.secret();
            var session = new LoginSession(ids.nextId(), account.id(), account.credentialVersion(), credentials.digest(secret), clock.instant().plus(sessionLifetime));
            sessions.save(session);
            Login response = response(account, session, session.id() + "." + secret);
            record("identity.login", "SUCCESS", account, account.id(), requestId);
            return response;
        } catch (IdentityFailure failure) {
            record(new AuditFacade.Command(clock.instant(), "identity.login", "FAILURE", null, number, null, null, requestId));
            throw failure;
        }
    }
    @Override public Login refresh(String credential) {
        var session = refreshSession(credential);
        var account = validAccount(session.accountId(), session.credentialVersion());
        return response(account, session, credential);
    }
    @Override public void logout(String credential, String requestId) {
        if (credential == null || credential.isBlank()) return;
        LoginSession session;
        try { session = refreshSession(credential); }
        catch (IdentityFailure failure) { return; }
        sessions.remove(session.id());
        EmployeeAccount account = null;
        try { account = accounts.find(session.accountId()).orElse(null); }
        catch (RuntimeException failure) {
            auditFailures.incrementAndGet();
            LOG.error("audit_metadata_failed action=identity.logout requestId={} failureType={}", requestId, failure.getClass().getSimpleName());
        }
        if (account != null) record("identity.logout", "SUCCESS", account, account.id(), requestId);
        else record(new AuditFacade.Command(clock.instant(), "identity.logout", "SUCCESS", session.accountId(), null, null,
                session.accountId().toString(), requestId));
    }
    @Override public AccountView authenticate(UUID accountId, UUID sessionId, long version) {
        var session = sessions.find(sessionId).orElseThrow(() -> new IdentityFailure("AUTHENTICATION_FAILED"));
        if (session.expired(clock.instant()) || !session.accountId().equals(accountId) || session.credentialVersion() != version)
            throw new IdentityFailure("AUTHENTICATION_FAILED");
        return view(validAccount(accountId, version));
    }
    @Override public AccountView me() { return view(actorAccount()); }
    @Override @Transactional
    public AccountView rename(String nickname) {
        var actor = actorAccount();
        if (actor.passwordChangeRequired()) throw new IdentityFailure("PASSWORD_CHANGE_REQUIRED");
        var changed = actor.rename(nickname, clock.instant());
        accounts.update(changed);
        accountChange("identity.nickname_changed", actor, actor, changed);
        return view(changed);
    }
    @Override @Transactional
    public void changePassword(String currentPassword, String newPassword) {
        AccountValues.password(newPassword);
        var context = actors.current();
        var account = accounts.lock(context.accountId()).orElseThrow(() -> new IdentityFailure("AUTHENTICATION_FAILED"));
        account.requireActive();
        if (account.credentialVersion() != context.credentialVersion()) throw new IdentityFailure("AUTHENTICATION_FAILED");
        if (currentPassword == null || currentPassword.codePointCount(0, currentPassword.length()) > 128
                || !credentials.matches(currentPassword, account.passwordHash())) throw new IdentityFailure("CURRENT_PASSWORD_INCORRECT");
        if (credentials.matches(newPassword, account.passwordHash())) throw new IdentityFailure("PASSWORD_REUSE_FORBIDDEN");
        var changed = account.replacePassword(credentials.encode(newPassword), false, clock.instant());
        accounts.update(changed);
        events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
        accountChange("identity.password_changed", account, account, changed);
    }
    @Override @Transactional
    public Provisioned create(Create command) {
        accounts.lockAdministratorLifecycle();
        var actor = administrator();
        String password = credentials.temporaryPassword();
        SystemRole role = command.systemRole() == null ? SystemRole.STAFF : SystemRole.valueOf(command.systemRole());
        if (command.jobRoles() == null || command.jobRoles().isEmpty() || command.jobRoles().stream().anyMatch(java.util.Objects::isNull))
            throw new IdentityFailure("VALIDATION_FAILED");
        Set<JobRole> roles = command.jobRoles().stream().map(JobRole::valueOf).collect(Collectors.toSet());
        var account = EmployeeAccount.create(ids.nextId(), command.employeeNumber(), command.nickname(), roles, role, credentials.encode(password), clock.instant());
        accounts.insert(account);
        accountChange("identity.account_created", actor, null, account);
        return new Provisioned(view(account), password);
    }
    @Override @Transactional(readOnly = true)
    public Page<AccountView> employees(Search query) {
        administrator();
        AccountValues.pagination(query.page(), query.size());
        var search = new Accounts.Search(query.employeeNumber() == null ? null : AccountValues.employeeNumber(query.employeeNumber()),
                query.nickname(), query.status() == null ? null : Status.valueOf(query.status()),
                query.jobRole() == null ? null : JobRole.valueOf(query.jobRole()), query.page(), query.size());
        return new Page<>(accounts.search(search).stream().map(this::view).toList(), accounts.count(search), query.page(), query.size());
    }
    @Override @Transactional
    public Provisioned resetPassword(UUID id) {
        accounts.lockAdministratorLifecycle();
        var actor = administrator();
        if (actor.id().equals(id)) throw new IdentityFailure("FORBIDDEN");
        var account = accounts.lock(id).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        if (account.status() != Status.ACTIVE) throw new IdentityFailure("ACCOUNT_ARCHIVED");
        String password = credentials.temporaryPassword();
        var changed = account.replacePassword(credentials.encode(password), true, clock.instant());
        accounts.update(changed);
        events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
        accountChange("identity.password_reset", actor, account, changed);
        return new Provisioned(view(changed), password);
    }
    @Override @Transactional
    public AccountView setEmployeePassword(UUID id, long expectedVersion, String newPassword) {
        accounts.lockAdministratorLifecycle();
        var actor = administrator();
        if (actor.id().equals(id)) throw new IdentityFailure("FORBIDDEN");
        var account = accounts.lock(id).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        if (account.status() != Status.ACTIVE) throw new IdentityFailure("ACCOUNT_ARCHIVED");
        if (expectedVersion < 0 || expectedVersion != account.version()) throw new IdentityFailure("CONCURRENT_MODIFICATION");
        AccountValues.password(newPassword);
        if (credentials.matches(newPassword, account.passwordHash())) throw new IdentityFailure("PASSWORD_REUSE_FORBIDDEN");
        var changed = account.replacePassword(credentials.encode(newPassword), true, clock.instant());
        accounts.update(changed);
        events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
        accountChange("identity.password_set", actor, account, changed);
        return view(changed);
    }
    @Override @Transactional
    public AccountView archive(UUID id) {
        accounts.lockAdministratorLifecycle();
        var actor = administrator();
        var account = accounts.lock(id).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        var changed = account.archive(actor.id(), accounts.activeAdministrators(), clock.instant());
        if (changed != account) {
            accounts.update(changed);
            events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
            accountChange("identity.account_archived", actor, account, changed);
        }
        return view(changed);
    }
    @Override @Transactional
    public AccountView reviseEmployee(UUID id, Profile command) {
        accounts.lockAdministratorLifecycle();
        var actor = administrator();
        var account = accounts.lock(id).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        if (command.expectedVersion() < 0 || command.expectedVersion() != account.version()) throw new IdentityFailure("CONCURRENT_MODIFICATION");
        if (command.jobRoles() == null || command.jobRoles().isEmpty() || command.jobRoles().stream().anyMatch(java.util.Objects::isNull))
            throw new IdentityFailure("VALIDATION_FAILED");
        var roles = command.jobRoles().stream().map(JobRole::valueOf).collect(Collectors.toSet());
        var changed = account.reviseProfile(command.nickname(), roles, accounts.activeAdministrators(), clock.instant());
        if (changed != account) {
            accounts.update(changed);
            if (changed.credentialVersion() != account.credentialVersion()) events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
            accountChange("identity.profile_changed", actor, account, changed);
        }
        return view(changed);
    }
    @Override @Transactional(readOnly = true)
    public java.util.List<EmployeeOption> employeeOptions(boolean includeArchived) {
        var actor = actorAccount();
        if (actor.passwordChangeRequired()) throw new IdentityFailure("PASSWORD_CHANGE_REQUIRED");
        return accounts.directory(includeArchived).stream().map(e -> new EmployeeOption(e.accountId(), e.employeeNumber(), e.nickname(), e.status().name())).toList();
    }
    @Override @Transactional
    public EmployeeOption selectEmployee(UUID id) {
        var actor = actorAccount();
        if (actor.passwordChangeRequired()) throw new IdentityFailure("PASSWORD_CHANGE_REQUIRED");
        var employee = accounts.lock(id).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        if (employee.status() != Status.ACTIVE) throw new IdentityFailure("ACCOUNT_ARCHIVED");
        return new EmployeeOption(employee.id(), employee.employeeNumber(), employee.nickname(), employee.status().name());
    }
    @Override @Transactional(readOnly = true)
    public EmployeeOption customerEntryOwner(UUID id) {
        return entryOwner(accounts.find(id).orElse(null));
    }
    @Override @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public EmployeeOption lockCustomerEntryOwner(UUID id) {
        return entryOwner(accounts.lockShared(id).orElse(null));
    }
    private EmployeeOption entryOwner(EmployeeAccount employee) {
        if (employee == null || !accessPolicy.canOwnCustomerEntry(employee)) return null;
        return new EmployeeOption(employee.id(), employee.employeeNumber(), employee.nickname(), employee.status().name());
    }
    @Transactional
    public AccountView initializeAdministrator(String number, String nickname, String password) {
        AccountValues.password(password);
        accounts.lockAdministratorLifecycle();
        if (accounts.administrators() != 0) throw new IdentityFailure("ADMINISTRATOR_ALREADY_INITIALIZED");
        var account = EmployeeAccount.create(ids.nextId(), number, nickname, Set.of(JobRole.STORE_MANAGER), SystemRole.SUPER_ADMIN, credentials.encode(password), clock.instant());
        accounts.insert(account);
        accountChange("identity.admin_initialized", null, null, account);
        return view(account);
    }
    /** 仅供本地运维命令使用：按已确认清单迁移旧岗位，整批失败时全部回滚。 */
    @Transactional
    public java.util.List<AccountView> migrateLegacyJobs(String administratorNumber, java.util.Map<String, java.util.Set<String>> assignments) {
        accounts.lockAdministratorLifecycle();
        var actor = accounts.findByNumber(AccountValues.employeeNumber(administratorNumber)).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        actor.requireAdministrator();
        var results = new java.util.ArrayList<AccountView>();
        for (var entry : new java.util.TreeMap<>(assignments).entrySet()) {
            var found = accounts.findByNumber(AccountValues.employeeNumber(entry.getKey())).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
            var before = accounts.lock(found.id()).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
            var roles = entry.getValue().stream().map(JobRole::valueOf).collect(Collectors.toSet());
            if (roles.isEmpty() || roles.stream().anyMatch(JobRole::legacy)) throw new IdentityFailure("VALIDATION_FAILED");
            if (before.jobRoles().equals(roles)) { results.add(view(before)); continue; }
            if (before.jobRoles().stream().anyMatch(role -> !role.legacy())) throw new IdentityFailure("CONCURRENT_MODIFICATION");
            var after = before.reviseProfile(before.nickname(), roles, accounts.activeAdministrators(), clock.instant());
            accounts.update(after);
            if (after.credentialVersion() != before.credentialVersion()) events.publishEvent(new CredentialsRevoked(after.id(), after.credentialVersion()));
            accountChange("identity.roles_migrated", actor, before, after, UUID.randomUUID().toString());
            results.add(view(after));
        }
        return java.util.List.copyOf(results);
    }
    @Transactional
    public Provisioned recoverAdministrator(String number) {
        accounts.lockAdministratorLifecycle();
        var account = accounts.findByNumber(AccountValues.employeeNumber(number)).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        account = accounts.lock(account.id()).orElseThrow(() -> new IdentityFailure("NOT_FOUND"));
        account.requireActive();
        if (account.systemRole() != SystemRole.SUPER_ADMIN) throw new IdentityFailure("FORBIDDEN");
        String password = credentials.temporaryPassword();
        var changed = account.replacePassword(credentials.encode(password), true, clock.instant());
        accounts.update(changed);
        events.publishEvent(new CredentialsRevoked(changed.id(), changed.credentialVersion()));
        accountChange("identity.admin_recovered", null, account, changed);
        return new Provisioned(view(changed), password);
    }
    private EmployeeAccount actorAccount() {
        var actor = actors.current();
        return validAccount(actor.accountId(), actor.credentialVersion());
    }
    private EmployeeAccount administrator() { var account = actorAccount(); account.requireAdministrator(); return account; }
    private EmployeeAccount validAccount(UUID id, long version) {
        var account = accounts.find(id).orElseThrow(() -> new IdentityFailure("AUTHENTICATION_FAILED"));
        account.requireActive();
        if (account.credentialVersion() != version) throw new IdentityFailure("AUTHENTICATION_FAILED");
        return account;
    }
    private LoginSession refreshSession(String credential) {
        if (credential == null || credential.length() != 80 || credential.charAt(36) != '.') throw new IdentityFailure("AUTHENTICATION_FAILED");
        UUID id;
        try { id = UUID.fromString(credential.substring(0, 36)); }
        catch (IllegalArgumentException failure) { throw new IdentityFailure("AUTHENTICATION_FAILED"); }
        var session = sessions.find(id).orElseThrow(() -> new IdentityFailure("AUTHENTICATION_FAILED"));
        if (session.expired(clock.instant()) || !credentials.matchesDigest(credential.substring(37), session.refreshHash()))
            throw new IdentityFailure("AUTHENTICATION_FAILED");
        return session;
    }
    private Login response(EmployeeAccount account, LoginSession session, String refreshCredential) {
        Instant now = clock.instant();
        Instant expiry = now.plus(accessLifetime);
        if (expiry.isAfter(session.expiresAt())) expiry = session.expiresAt();
        if (Duration.between(now, expiry).toSeconds() < 1) throw new IdentityFailure("AUTHENTICATION_FAILED");
        return new Login(tokens.issue(account.id(), session.id(), account.credentialVersion(), now, expiry), "Bearer",
                Duration.between(now, expiry).toSeconds(), account.passwordChangeRequired(), refreshCredential,
                Duration.between(now, session.expiresAt()).toSeconds());
    }
    private void accountChange(String action, EmployeeAccount actor, EmployeeAccount before, EmployeeAccount after) {
        String requestId = actor == null ? UUID.randomUUID().toString() : actors.current().requestId();
        accountChange(action, actor, before, after, requestId);
    }
    private void accountChange(String action, EmployeeAccount actor, EmployeeAccount before, EmployeeAccount after, String requestId) {
        var details = new java.util.LinkedHashMap<String, String>();
        snapshot(details, "before", before); snapshot(details, "after", after);
        audit.appendChange(new AuditFacade.Command(clock.instant(), action, "SUCCESS", actor == null ? null : actor.id(),
                actor == null ? null : actor.employeeNumber(), actor == null ? null : actor.nickname(), after.id().toString(), requestId, details));
    }
    private static void snapshot(java.util.Map<String, String> details, String prefix, EmployeeAccount account) {
        details.put(prefix + ".exists", Boolean.toString(account != null));
        if (account == null) return;
        details.put(prefix + ".nickname", account.nickname());
        details.put(prefix + ".employeeNumber", account.employeeNumber());
        details.put(prefix + ".status", account.status().name());
        details.put(prefix + ".systemRole", account.systemRole().name());
        details.put(prefix + ".jobRoles", account.jobRoles().stream().map(Enum::name).sorted().collect(Collectors.joining(",")));
        details.put(prefix + ".credentialVersion", Long.toString(account.credentialVersion()));
        details.put(prefix + ".passwordChangeRequired", Boolean.toString(account.passwordChangeRequired()));
        details.put(prefix + ".version", Long.toString(account.version()));
    }
    private AuditFacade.Command command(String action, String result, EmployeeAccount actor, UUID target, String requestId) {
        return new AuditFacade.Command(clock.instant(), action, result, actor == null ? null : actor.id(),
                actor == null ? null : actor.employeeNumber(), actor == null ? null : actor.nickname(), target == null ? null : target.toString(), requestId);
    }
    private void record(String action, String result, EmployeeAccount actor, UUID target, String requestId) { record(command(action, result, actor, target, requestId)); }
    private void record(AuditFacade.Command command) {
        try { audit.append(command); }
        catch (RuntimeException failure) {
            auditFailures.incrementAndGet();
            LOG.error("audit_write_failed action={} requestId={} failureType={}", command.action(), command.requestId(), failure.getClass().getSimpleName());
        }
    }
    public long auditFailureCount() { return auditFailures.get(); }
    private AccountView view(EmployeeAccount account) {
        return new AccountView(account.id(), account.employeeNumber(), account.nickname(),
                account.jobRoles().stream().map(Enum::name).collect(Collectors.toUnmodifiableSet()), account.systemRole().name(),
                account.status().name(), account.passwordChangeRequired(), account.credentialVersion(), account.createdAt(), account.archivedAt(), account.version(), accessPolicy.access(account));
    }
}
