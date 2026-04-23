package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.DocumentRecord;
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
 * {@code /api/v1/workspaces/{w}/catalogs/{c}/documents} — document
 * metadata CRUD.
 *
 * <p>Scaffold: every handler throws {@link NotImplementedApiError}.
 */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents")
public class DocumentController {

    @GetMapping
    public List<DocumentRecord> list(
        @PathVariable String workspaceId,
        @PathVariable String catalogId
    ) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId + "/documents"
        );
    }

    @PostMapping
    public DocumentRecord create(
        @PathVariable String workspaceId,
        @PathVariable String catalogId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId + "/documents"
        );
    }

    @GetMapping("/{documentId}")
    public DocumentRecord get(
        @PathVariable String workspaceId,
        @PathVariable String catalogId,
        @PathVariable String documentId
    ) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
                + "/documents/" + documentId
        );
    }

    @PutMapping("/{documentId}")
    public DocumentRecord update(
        @PathVariable String workspaceId,
        @PathVariable String catalogId,
        @PathVariable String documentId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "PUT /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
                + "/documents/" + documentId
        );
    }

    @DeleteMapping("/{documentId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String catalogId,
        @PathVariable String documentId
    ) {
        throw new NotImplementedApiError(
            "DELETE /api/v1/workspaces/" + workspaceId + "/catalogs/" + catalogId
                + "/documents/" + documentId
        );
    }
}
