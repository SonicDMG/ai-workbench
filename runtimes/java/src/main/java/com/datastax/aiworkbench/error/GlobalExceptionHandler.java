package com.datastax.aiworkbench.error;

import com.datastax.aiworkbench.web.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps {@link ApiError} (and validation failures) to the canonical
 * {@link ErrorEnvelope}. All error responses carry the current
 * {@code X-Request-Id} so clients can correlate.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiError.class)
    public ResponseEntity<ErrorEnvelope> handleApiError(
        ApiError exc,
        HttpServletRequest request
    ) {
        return ResponseEntity
            .status(exc.status())
            .body(ErrorEnvelope.of(exc.code(), exc.getMessage(), requestId(request)));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorEnvelope> handleValidation(
        MethodArgumentNotValidException exc,
        HttpServletRequest request
    ) {
        String message = exc.getBindingResult().getAllErrors().isEmpty()
            ? "validation failed"
            : exc.getBindingResult().getAllErrors().get(0).getDefaultMessage();
        return ResponseEntity
            .status(400)
            .body(ErrorEnvelope.of("validation_error", message, requestId(request)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorEnvelope> handleUnexpected(
        Exception exc,
        HttpServletRequest request
    ) {
        String message = exc.getMessage() == null ? "internal server error" : exc.getMessage();
        return ResponseEntity
            .status(500)
            .body(ErrorEnvelope.of("internal_error", message, requestId(request)));
    }

    private static String requestId(HttpServletRequest request) {
        Object value = request.getAttribute(RequestIdFilter.ATTRIBUTE);
        return value instanceof String s ? s : "unknown";
    }
}
