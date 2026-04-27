package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.ChunkingServiceRecord;
import com.datastax.aiworkbench.model.CreateChunkingServiceInput;
import com.datastax.aiworkbench.model.CreateEmbeddingServiceInput;
import com.datastax.aiworkbench.model.CreateRerankingServiceInput;
import com.datastax.aiworkbench.model.EmbeddingServiceRecord;
import com.datastax.aiworkbench.model.RerankingServiceRecord;
import com.datastax.aiworkbench.model.UpdateChunkingServiceInput;
import com.datastax.aiworkbench.model.UpdateEmbeddingServiceInput;
import com.datastax.aiworkbench.model.UpdateRerankingServiceInput;
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

/** Chunking, embedding, and reranking service stubs. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}")
public class ExecutionServiceController {

    @GetMapping("/chunking-services")
    public List<ChunkingServiceRecord> listChunking(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(path("GET", workspaceId, "chunking-services", null));
    }

    @PostMapping("/chunking-services")
    public ChunkingServiceRecord createChunking(
        @PathVariable String workspaceId,
        @Valid @RequestBody CreateChunkingServiceInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, "chunking-services", null));
    }

    @GetMapping("/chunking-services/{serviceId}")
    public ChunkingServiceRecord getChunking(
        @PathVariable String workspaceId,
        @PathVariable String serviceId
    ) {
        throw new NotImplementedApiError(path("GET", workspaceId, "chunking-services", serviceId));
    }

    @PutMapping("/chunking-services/{serviceId}")
    public ChunkingServiceRecord updateChunking(
        @PathVariable String workspaceId,
        @PathVariable String serviceId,
        @RequestBody UpdateChunkingServiceInput body
    ) {
        throw new NotImplementedApiError(path("PUT", workspaceId, "chunking-services", serviceId));
    }

    @DeleteMapping("/chunking-services/{serviceId}")
    public void deleteChunking(@PathVariable String workspaceId, @PathVariable String serviceId) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, "chunking-services", serviceId)
        );
    }

    @GetMapping("/embedding-services")
    public List<EmbeddingServiceRecord> listEmbedding(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(path("GET", workspaceId, "embedding-services", null));
    }

    @PostMapping("/embedding-services")
    public EmbeddingServiceRecord createEmbedding(
        @PathVariable String workspaceId,
        @Valid @RequestBody CreateEmbeddingServiceInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, "embedding-services", null));
    }

    @GetMapping("/embedding-services/{serviceId}")
    public EmbeddingServiceRecord getEmbedding(
        @PathVariable String workspaceId,
        @PathVariable String serviceId
    ) {
        throw new NotImplementedApiError(path("GET", workspaceId, "embedding-services", serviceId));
    }

    @PutMapping("/embedding-services/{serviceId}")
    public EmbeddingServiceRecord updateEmbedding(
        @PathVariable String workspaceId,
        @PathVariable String serviceId,
        @RequestBody UpdateEmbeddingServiceInput body
    ) {
        throw new NotImplementedApiError(path("PUT", workspaceId, "embedding-services", serviceId));
    }

    @DeleteMapping("/embedding-services/{serviceId}")
    public void deleteEmbedding(@PathVariable String workspaceId, @PathVariable String serviceId) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, "embedding-services", serviceId)
        );
    }

    @GetMapping("/reranking-services")
    public List<RerankingServiceRecord> listReranking(@PathVariable String workspaceId) {
        throw new NotImplementedApiError(path("GET", workspaceId, "reranking-services", null));
    }

    @PostMapping("/reranking-services")
    public RerankingServiceRecord createReranking(
        @PathVariable String workspaceId,
        @Valid @RequestBody CreateRerankingServiceInput body
    ) {
        throw new NotImplementedApiError(path("POST", workspaceId, "reranking-services", null));
    }

    @GetMapping("/reranking-services/{serviceId}")
    public RerankingServiceRecord getReranking(
        @PathVariable String workspaceId,
        @PathVariable String serviceId
    ) {
        throw new NotImplementedApiError(path("GET", workspaceId, "reranking-services", serviceId));
    }

    @PutMapping("/reranking-services/{serviceId}")
    public RerankingServiceRecord updateReranking(
        @PathVariable String workspaceId,
        @PathVariable String serviceId,
        @RequestBody UpdateRerankingServiceInput body
    ) {
        throw new NotImplementedApiError(path("PUT", workspaceId, "reranking-services", serviceId));
    }

    @DeleteMapping("/reranking-services/{serviceId}")
    public void deleteReranking(@PathVariable String workspaceId, @PathVariable String serviceId) {
        throw new NotImplementedApiError(
            path("DELETE", workspaceId, "reranking-services", serviceId)
        );
    }

    private static String path(String method, String workspaceId, String collection, String id) {
        var base = method + " /api/v1/workspaces/" + workspaceId + "/" + collection;
        return id == null ? base : base + "/" + id;
    }
}
