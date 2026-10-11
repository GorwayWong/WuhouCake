package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.*;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger LOG = LoggerFactory.getLogger(ApiErrors.class);
    @ExceptionHandler(OrderFailure.class)
    ResponseEntity<ApiResponse<Void>> order(OrderFailure failure) {
        int status = switch (failure.code()) {
            case "ORDER_NOT_FOUND" -> 404;
            case "CONCURRENT_MODIFICATION" -> 409;
            default -> 400;
        };
        return response(status, failure.code());
    }
    @ExceptionHandler(IdentityFailure.class)
    ResponseEntity<ApiResponse<Void>> domain(IdentityFailure failure) {
        int status = switch (failure.code()) {
            case "AUTHENTICATION_FAILED" -> 401;
            case "FORBIDDEN", "SELF_ARCHIVE_FORBIDDEN", "PASSWORD_CHANGE_REQUIRED" -> 403;
            case "NOT_FOUND" -> 404;
            case "EMPLOYEE_NUMBER_CONFLICT", "LAST_ADMINISTRATOR", "CONCURRENT_MODIFICATION", "ADMINISTRATOR_ALREADY_INITIALIZED", "ACCOUNT_ARCHIVED" -> 409;
            case "LOGIN_THROTTLED" -> 429;
            default -> 400;
        };
        return response(status, failure.code());
    }
    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiResponse<Void>> validation(Exception failure) { return response(400, "VALIDATION_FAILED"); }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ApiResponse<Void>> unavailable(DataAccessException failure) { return response(503, "SERVICE_UNAVAILABLE"); }
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiResponse<Void>> missing(NoResourceFoundException failure) { return response(404, "NOT_FOUND"); }
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiResponse<Void>> method(HttpRequestMethodNotSupportedException failure) { return response(405, "METHOD_NOT_ALLOWED"); }
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiResponse<Void>> media(HttpMediaTypeNotSupportedException failure) { return response(415, "UNSUPPORTED_MEDIA_TYPE"); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<Void>> unexpected(Exception failure, HttpServletRequest request) {
        LOG.error("request_failed requestId={} failureType={}", request.getAttribute("wuhoucake.requestId"), failure.getClass().getSimpleName());
        return response(500, "INTERNAL_ERROR");
    }
    private static ResponseEntity<ApiResponse<Void>> response(int status, String code) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(ApiResponse.failure(code, code));
    }
}
