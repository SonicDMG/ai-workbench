package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.CreateKnowledgeFilterInput;
import com.datastax.aiworkbench.model.KnowledgeFilterRecord;
import com.datastax.aiworkbench.model.UpdateKnowledgeFilterInput;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code /api/v1/workspaces/{workspaceId}/knowledge-bases/{kbId}/filters} stubs. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}/filters")
public class KnowledgeFilterController {

    @GetMapping
    public List<KnowledgeFilterRecord> list(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId
    ) {
        throw new NotImplementedApiError(path("GET", workspaceId, knowledgeBaseId, null));
    }

    @PostMapping
    public KnowledgeFilterRecord create(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @Valid @RequestBody CreateKnowledgeFilterInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, knowledgeBaseId, null));
    }

    @GetMapping("/{knowledgeFilterId}")
    public KnowledgeFilterRecord get(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String knowledgeFilterId
    ) {
        throw new NotImplementedApiError(
            path("GET", workspaceId, knowledgeBaseId, knowledgeFilterId)
        );
    }

    @PutMapping("/{knowledgeFilterId}")
    public KnowledgeFilterRecord update(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String knowledgeFilterId,
        @RequestBody UpdateKnowledgeFilterInput body
    ) {
        throw new NotImplementedApiError(
            path("PUT", workspaceId, knowledgeBaseId, knowledgeFilterId)
        );
    }

    @DeleteMapping("/{knowledgeFilterId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String knowledgeFilterId
    ) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, knowledgeBaseId, knowledgeFilterId)
        );
    }

    private static String path(
        String method,
        String workspaceId,
        String knowledgeBaseId,
        String knowledgeFilterId
    ) {
        var base = method
            + " /api/v1/workspaces/"
            + workspaceId
            + "/knowledge-bases/"
            + knowledgeBaseId
            + "/filters";
        return knowledgeFilterId == null ? base : base + "/" + knowledgeFilterId;
    }
}
