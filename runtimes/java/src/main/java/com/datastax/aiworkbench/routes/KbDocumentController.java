package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.CreateRagDocumentInput;
import com.datastax.aiworkbench.model.IngestInput;
import com.datastax.aiworkbench.model.RagDocumentRecord;
import com.datastax.aiworkbench.model.UpdateRagDocumentInput;
import jakarta.validation.Valid;
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

/** Knowledge Base document and ingest stubs. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/knowledge-bases/{knowledgeBaseId}")
public class KbDocumentController {

    @GetMapping("/documents")
    public List<RagDocumentRecord> list(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId
    ) {
        throw new NotImplementedApiError(path("GET", workspaceId, knowledgeBaseId, "documents"));
    }

    @PostMapping("/documents")
    public RagDocumentRecord create(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @Valid @RequestBody CreateRagDocumentInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, knowledgeBaseId, "documents"));
    }

    @PostMapping("/ingest")
    public Map<String, Object> ingest(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @RequestBody IngestInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, knowledgeBaseId, "ingest"));
    }

    @GetMapping("/documents/{documentId}")
    public RagDocumentRecord get(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String documentId
    ) {
        throw new NotImplementedApiError(
            path("GET", workspaceId, knowledgeBaseId, "documents/" + documentId)
        );
    }

    @PutMapping("/documents/{documentId}")
    public RagDocumentRecord update(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String documentId,
        @RequestBody UpdateRagDocumentInput body
    ) {
        throw new NotImplementedApiError(
            path("PUT", workspaceId, knowledgeBaseId, "documents/" + documentId)
        );
    }

    @DeleteMapping("/documents/{documentId}")
    public void delete(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String documentId
    ) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, knowledgeBaseId, "documents/" + documentId)
        );
    }

    @GetMapping("/documents/{documentId}/chunks")
    public List<Map<String, Object>> chunks(
        @PathVariable String workspaceId,
        @PathVariable String knowledgeBaseId,
        @PathVariable String documentId
    ) {
        throw new NotImplementedApiError(
            path("GET", workspaceId, knowledgeBaseId, "documents/" + documentId + "/chunks")
        );
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
