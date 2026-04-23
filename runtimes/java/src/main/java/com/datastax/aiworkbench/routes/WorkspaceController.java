package com.datastax.aiworkbench.routes;

import com.datastax.aiworkbench.error.NotImplementedApiError;
import com.datastax.aiworkbench.model.CreateWorkspaceInput;
import com.datastax.aiworkbench.model.UpdateWorkspaceInput;
import com.datastax.aiworkbench.model.WorkspaceRecord;
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

/**
 * {@code /api/v1/workspaces} — workspace CRUD.
 *
 * <p>Scaffold: every handler throws {@link NotImplementedApiError}
 * (returns HTTP 501 via {@link com.datastax.aiworkbench.error.GlobalExceptionHandler}).
 * Fill in one handler at a time; the conformance tests will start
 * passing as you go.
 */
@RestController
@RequestMapping("/api/v1/workspaces")
public class WorkspaceController {

    @GetMapping
    public List<WorkspaceRecord> list() {
        throw new NotImplementedApiError("GET /api/v1/workspaces");
    }

    @PostMapping
    public WorkspaceRecord create(@Valid @RequestBody CreateWorkspaceInput body) {
        throw new NotImplementedApiError("POST /api/v1/workspaces");
    }

    @GetMapping("/{workspaceId}")
    public WorkspaceRecord get(@PathVariable String workspaceId) {
        throw new NotImplementedApiError("GET /api/v1/workspaces/" + workspaceId);
    }

    @PutMapping("/{workspaceId}")
    public WorkspaceRecord update(
        @PathVariable String workspaceId,
        @RequestBody UpdateWorkspaceInput body
    ) {
        throw new NotImplementedApiError("PUT /api/v1/workspaces/" + workspaceId);
    }

    @DeleteMapping("/{workspaceId}")
    public void delete(@PathVariable String workspaceId) {
        throw new NotImplementedApiError("DELETE /api/v1/workspaces/" + workspaceId);
    }
}
