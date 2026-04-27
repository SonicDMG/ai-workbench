package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.CreateKnowledgeBaseInput;
import com.datastax.aiworkbench.model.KnowledgeBaseRecord;
import com.datastax.aiworkbench.model.UpdateKnowledgeBaseInput;
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

/** {@code /api/v1/workspaces/{workspaceId}/knowledge-bases} stubs. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/knowledge-bases")
public class KnowledgeBaseController {

    @GetMapping
    public List<KnowledgeBaseRecord> list(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/knowledge-bases"
        );
    }

    @PostMapping
    public KnowledgeBaseRecord create(
        @PathVariable String workspaceId,
        @Valid @RequestBody CreateKnowledgeBaseInput body
    ) {
        throw new NotImplementedApiError(
            "POST /api/v1/workspaces/" + workspaceId + "/knowledge-bases"
        );
    }

    @GetMapping("/{knowledgeBaseId}")
    public KnowledgeBaseRecord get(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId
    ) {
        throw new NotImplementedApiError(
            "GET /api/v1/workspaces/" + workspaceId + "/knowledge-bases/" + knowledgeBaseId
        );
    }

    @PutMapping("/{knowledgeBaseId}")
    public KnowledgeBaseRecord update(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @RequestBody UpdateKnowledgeBaseInput body
    ) {
        throw new NotImplementedApiError(
            "PUT /api/v1/workspaces/" + workspaceId + "/knowledge-bases/" + knowledgeBaseId
        );
    }

    @DeleteMapping("/{knowledgeBaseId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId
    ) {
        throw new NotImplementedApiError(
            "DELETE /api/v1/workspaces/" + workspaceId + "/knowledge-bases/" + knowledgeBaseId
        );
    }
}
