package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.CatalogRecord;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /api/v1/workspaces/{w}/catalogs} — catalog CRUD.
 *
 * <p>Scaffold: every handler throws {@link NotImplementedApiError}.
 */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/catalogs")
public class CatalogController {

    @GetMapping
    public List<CatalogRecord> list(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/catalogs"
        );
    }

    @PostMapping
    public CatalogRecord create(
        @PathVariable String workspaceId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/catalogs"
        );
    }

    @GetMapping("/{catalogId}")
    public CatalogRecord get(
        @PathVariable String workspaceId,
        @PathVariable String catalogId
    ) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
        );
    }

    @PutMapping("/{catalogId}")
    public CatalogRecord update(
        @PathVariable String workspaceId,
        @PathVariable String catalogId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "PUT /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
        );
    }

    @DeleteMapping("/{catalogId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String catalogId
    ) {
        throw new NotImplementedApiError(
            "DELETE /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
        );
    }
}
