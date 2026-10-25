package org.xaspire.WuhouCake.identity.adapter.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.shared.response.ApiResponse;
import org.xaspire.WuhouCake.shared.response.Page;

@RestController
public class IdentityController {
    public static final String REFRESH_COOKIE = "wuhoucake_refresh";
    public record LoginRequest(@NotBlank @Size(max = 32) String employeeNumber, @NotNull @Size(max = 256) String password) {
        @Override public String toString() { return "LoginRequest"; }
    }
    public record TokenView(String accessToken, String tokenType, long expiresIn, boolean passwordChangeRequired) {
        @Override public String toString() { return "TokenView"; }
    }
    public record NicknameRequest(@NotNull @Size(max = 160) String nickname) { }
    public record PasswordRequest(@NotNull @Size(max = 256) String currentPassword, @NotNull @Size(max = 256) String newPassword) {
        @Override public String toString() { return "PasswordRequest"; }
    }
    public record CreateRequest(@NotBlank @Size(max = 32) String employeeNumber, @NotNull @Size(max = 160) String nickname,
            @NotEmpty @Size(max = 6) Set<@NotBlank @Size(max = 32) String> jobRoles, String systemRole) { }
    public record ProfileRequest(@NotNull @PositiveOrZero Long expectedVersion, @NotNull @Size(max = 160) String nickname,
            @NotEmpty @Size(max = 6) Set<@NotBlank @Size(max = 32) String> jobRoles) { }
    public record EmployeePasswordRequest(@NotNull @PositiveOrZero Long expectedVersion, @NotNull @Size(max = 256) String newPassword) {
        @Override public String toString() { return "EmployeePasswordRequest"; }
    }
    private final IdentityFacade identity;
    private final boolean secureCookie;
    public IdentityController(IdentityFacade identity, boolean secureCookie) { this.identity = identity; this.secureCookie = secureCookie; }
    @PostMapping("/api/auth/login")
    public ResponseEntity<ApiResponse<TokenView>> login(@Valid @RequestBody LoginRequest command, HttpServletRequest request) {
        var result = identity.login(command.employeeNumber(), command.password(), requestId(request));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE, cookie(result.refreshCredential(), result.refreshExpiresIn()), clearCsrf())
                .body(ApiResponse.success(tokenView(result)));
    }
    @PostMapping("/api/auth/refresh")
    public ResponseEntity<ApiResponse<TokenView>> refresh(@CookieValue(name = REFRESH_COOKIE, required = false) String credential) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(tokenView(identity.refresh(credential))));
    }
    @PostMapping("/api/auth/logout")
    public ResponseEntity<ApiResponse<Void>> logout(@CookieValue(name = REFRESH_COOKIE, required = false) String credential, HttpServletRequest request) {
        identity.logout(credential, requestId(request));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE, cookie("", 0), clearCsrf()).body(ApiResponse.success(null));
    }
    @GetMapping("/api/me") public ApiResponse<IdentityFacade.AccountView> me() { return ApiResponse.success(identity.me()); }
    @PatchMapping("/api/me/nickname") public ApiResponse<IdentityFacade.AccountView> nickname(@Valid @RequestBody NicknameRequest command) {
        return ApiResponse.success(identity.rename(command.nickname()));
    }
    @PostMapping("/api/me/password") public ResponseEntity<ApiResponse<Void>> password(@Valid @RequestBody PasswordRequest command) {
        identity.changePassword(command.currentPassword(), command.newPassword());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE, cookie("", 0)).body(ApiResponse.success(null));
    }
    @GetMapping("/api/admin/employees")
    public ApiResponse<Page<IdentityFacade.AccountView>> employees(@RequestParam(required = false) String employeeNumber,
            @RequestParam(required = false) String nickname, @RequestParam(required = false) String status,
            @RequestParam(required = false) String jobRole, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(identity.employees(new IdentityFacade.Search(employeeNumber, nickname, status, jobRole, page, size)));
    }
    @GetMapping("/api/employees/options")
    public ApiResponse<java.util.List<IdentityFacade.EmployeeOption>> options(@RequestParam(defaultValue = "false") boolean includeArchived) {
        return ApiResponse.success(identity.employeeOptions(includeArchived));
    }
    @PatchMapping("/api/admin/employees/{id}")
    public ApiResponse<IdentityFacade.AccountView> profile(@PathVariable UUID id, @Valid @RequestBody ProfileRequest command) {
        return ApiResponse.success(identity.reviseEmployee(id, new IdentityFacade.Profile(command.expectedVersion(), command.nickname(), command.jobRoles())));
    }
    @PostMapping("/api/admin/employees")
    public ResponseEntity<ApiResponse<IdentityFacade.Provisioned>> create(@Valid @RequestBody CreateRequest command) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(ApiResponse.success(identity.create(new IdentityFacade.Create(command.employeeNumber(), command.nickname(), command.jobRoles(), command.systemRole()))));
    }
    @PostMapping("/api/admin/employees/{id}/reset-password")
    public ResponseEntity<ApiResponse<IdentityFacade.Provisioned>> reset(@PathVariable UUID id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(identity.resetPassword(id)));
    }
    @PostMapping("/api/admin/employees/{id}/archive")
    public ApiResponse<IdentityFacade.AccountView> archive(@PathVariable UUID id) { return ApiResponse.success(identity.archive(id)); }
    @PatchMapping("/api/admin/employees/{id}/password")
    public ResponseEntity<ApiResponse<IdentityFacade.AccountView>> employeePassword(@PathVariable UUID id, @Valid @RequestBody EmployeePasswordRequest command) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(identity.setEmployeePassword(id, command.expectedVersion(), command.newPassword())));
    }
    private String cookie(String value, long seconds) {
        return ResponseCookie.from(REFRESH_COOKIE, value).httpOnly(true).secure(secureCookie).sameSite("Lax")
                .path("/api/auth").maxAge(seconds).build().toString();
    }
    private String clearCsrf() { return ResponseCookie.from("XSRF-TOKEN", "").secure(secureCookie).sameSite("Lax").path("/").maxAge(0).build().toString(); }
    private static TokenView tokenView(IdentityFacade.Login login) { return new TokenView(login.accessToken(), login.tokenType(), login.expiresIn(), login.passwordChangeRequired()); }
    private static String requestId(HttpServletRequest request) { return (String) request.getAttribute("wuhoucake.requestId"); }
}
