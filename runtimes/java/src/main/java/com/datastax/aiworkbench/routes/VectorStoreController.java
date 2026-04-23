package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.VectorStoreRecord;
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
 * {@code /api/v1/workspaces/{w}/vector-stores} — descriptor CRUD and
 * data-plane routes (upsert, delete, search).
 *
 * <p>Scaffold: every handler throws {@link NotImplementedApiError}.
 */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/vector-stores")
public class VectorStoreController {

    @GetMapping
    public List<VectorStoreRecord> list(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/vector-stores"
        );
    }

    @PostMapping
    public VectorStoreRecord create(
        @PathVariable String workspaceId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/vector-stores"
        );
    }

    @GetMapping("/{vectorStoreId}")
    public VectorStoreRecord get(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId
    ) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId
        );
    }

    @PutMapping("/{vectorStoreId}")
    public VectorStoreRecord update(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "PUT /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId
        );
    }

    @DeleteMapping("/{vectorStoreId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId
    ) {
        throw new NotImplementedApiError(
            "DELETE /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId
        );
    }

    // -- Data plane --

    @PostMapping("/{vectorStoreId}/records")
    public Map<String, Integer> upsert(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId + "/records"
        );
    }

    @DeleteMapping("/{vectorStoreId}/records/{recordId}")
    public Map<String, Boolean> deleteRecord(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId,
        @PathVariable String recordId
    ) {
        throw new NotImplementedApiError(
            "DELETE /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId
                + "/records/" + recordId
        );
    }

    @PostMapping("/{vectorStoreId}/search")
    public List<Map<String, Object>> search(
        @PathVariable String workspaceId,
        @PathVariable String vectorStoreId,
        @RequestBody Map<String, Object> body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/vector-stores/" + vectorStoreId + "/search"
        );
    }
}
