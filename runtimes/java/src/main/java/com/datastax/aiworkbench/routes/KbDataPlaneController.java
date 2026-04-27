package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.SearchInput;
import com.datastax.aiworkbench.model.UpsertRecordsInput;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Knowledge Base upsert/search data-plane stubs. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}")
public class KbDataPlaneController {

    @PostMapping("/records")
    public Map<String, Object> upsert(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @RequestBody UpsertRecordsInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, knowledgeBaseId, "records"));
    }

    @DeleteMapping("/records/{recordId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String recordId
    ) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, knowledgeBaseId, "records/" + recordId)
        );
    }

    @PostMapping("/search")
    public Map<String, Object> search(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @RequestBody SearchInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, knowledgeBaseId, "search"));
    }

    private static String path(
        String method,
        String workspaceId,
        String knowledgeBaseId,
        String suffix
    ) {
        return method
            + " /api/v1/workspaces/"
            + workspaceId
            + "/knowledge-bases/"
            + knowledgeBaseId
            + "/"
            + suffix;
    }
}
