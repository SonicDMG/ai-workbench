package com.datastax.aiworkbench.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Mirrors the TypeScript runtime's {@code X-Request-Id} behavior: echo
 * a client-supplied id or generate a new one; make it available to
 * controllers and error handlers via a request attribute.
 *
 * <p>The TS runtime generates ULIDs; Java here generates UUID hex, which
 * the shared conformance normalizer already collapses to a stable
 * placeholder. Both are valid {@code REQID_N} matches.
 */
@Component
@Order(Integer.MIN_VALUE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    public static final String ATTRIBUTE = "requestId";

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain chain
    ) throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        String id = (incoming == null || incoming.isEmpty())
            ? UUID.randomUUID().toString().replace("-", "")
            : incoming;
        request.setAttribute(ATTRIBUTE, id);
        response.setHeader(HEADER, id);
        chain.doFilter(request, response);
    }
}
