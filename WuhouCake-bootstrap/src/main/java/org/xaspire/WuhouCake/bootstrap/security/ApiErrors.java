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
            case "ORDER_NOT_FOUND", "IMAGE_NOT_FOUND" -> 404;
            case "IMAGE_TOO_LARGE", "EXPORT_FILE_TOO_LARGE", "EXPORT_CONTENT_TOO_LARGE" -> 413;
            case "UNSUPPORTED_IMAGE_FORMAT" -> 415;
            case "CONCURRENT_MODIFICATION", "INVALID_PRODUCTION_TRANSITION", "ORDER_NOT_EDITABLE",
                    "INVALID_FULFILLMENT_TRANSITION", "ORDER_NOT_CANCELLABLE", "ORDER_IMAGE_LIMIT_EXCEEDED" -> 409;
            default -> 400;
        };
        String message = switch (failure.code()) {
            case "EXPORT_LIMIT_EXCEEDED" -> "导出超过日期、订单或图片数量上限，请缩小筛选范围";
            case "EXPORT_FILE_TOO_LARGE" -> "导出文件过大，请缩小筛选范围或减少图片";
            case "EXPORT_CONTENT_TOO_LARGE" -> "导出正文或记录数过大，请缩小范围；单张订单请精简备注或规格";
            case "EXPORT_EMPTY" -> "筛选范围内没有订单";
            case "ORDER_IMAGE_LIMIT_EXCEEDED" -> "每张订单最多保留 8 张图片";
            case "IMAGE_DIMENSIONS_EXCEEDED" -> "图片边长或总像素超过上限";
            case "UNSUPPORTED_IMAGE_FORMAT" -> "仅支持 JPEG 和 PNG 图片";
            case "INVALID_IMAGE" -> "图片为空或内容损坏";
            case "IMAGE_TOO_LARGE" -> "单张图片不得超过 5 MiB";
            default -> failure.code();
        };
        return response(status, failure.code(), message);
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
    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            org.springframework.web.multipart.support.MissingServletRequestPartException.class,
            org.springframework.web.bind.MissingServletRequestParameterException.class})
    ResponseEntity<ApiResponse<Void>> validation(Exception failure) { return response(400, "VALIDATION_FAILED"); }
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<ApiResponse<Void>> uploadSize(Exception failure) { return response(413, "IMAGE_TOO_LARGE"); }
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
        return response(status, code, code);
    }
    private static ResponseEntity<ApiResponse<Void>> response(int status, String code, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(ApiResponse.failure(code, message));
    }
}
