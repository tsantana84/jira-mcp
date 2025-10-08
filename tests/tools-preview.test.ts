import { describe, it, expect } from "vitest";
import { registerTools } from "../src/mcp/tools.js";
import type { Config } from "../src/config.js";

// Minimal fake server that captures tool registrations
class FakeServer {
  public tools = new Map<string, { schema: any; handler: Function }>();
  tool(name: string, opts: { input: any; description?: string }, handler: Function) {
    this.tools.set(name, { schema: opts.input, handler });
  }
}

function setup() {
  const server = new FakeServer();
  const config: Config = {
    baseUrl: "https://example.atlassian.net",
    confluenceBaseUrl: "https://example.atlassian.net/wiki",
    email: "user@example.com",
    apiToken: "x",
    defaults: {},
  };
  registerTools(server as any, config);
  return server;
}

describe("Tool preview behavior", () => {
  // note: write operations (create_issue, update_issue, add_comment, transition_issue) are intentionally
  // disabled in the main server (out of scope for dependency analysis). these tests are skipped.

  it.skip("create_issue returns preview when confirm=false", async () => {
    const server = setup();
    const tool = server.tools.get("create_issue")!;
    const res = await tool.handler({ input: { summary: "Hello", confirm: false } });
    expect(res.preview).toBe(true);
    expect(res.request).toMatchObject({ method: "POST", path: "/rest/api/3/issue" });
  });

  it.skip("update_issue returns preview when confirm=false", async () => {
    const server = setup();
    const tool = server.tools.get("update_issue")!;
    const res = await tool.handler({ input: { issueKey: "ABC-1", summary: "X", confirm: false } });
    expect(res.preview).toBe(true);
    expect(res.request).toMatchObject({ method: "PUT", path: "/rest/api/3/issue/ABC-1" });
  });

  it.skip("add_comment returns preview when confirm=false", async () => {
    const server = setup();
    const tool = server.tools.get("add_comment")!;
    const res = await tool.handler({ input: { issueKey: "ABC-1", body: "Note", confirm: false } });
    expect(res.preview).toBe(true);
    expect(res.request).toMatchObject({ method: "POST", path: "/rest/api/3/issue/ABC-1/comment" });
  });

  it.skip("transition_issue returns preview when confirm=false without network lookups", async () => {
    const server = setup();
    const tool = server.tools.get("transition_issue")!;
    const res = await tool.handler({ input: { issueKey: "ABC-1", transition: "Done", confirm: false } });
    expect(res.preview).toBe(true);
    expect(res.request).toMatchObject({ method: "POST", path: "/rest/api/3/issue/ABC-1/transitions" });
    // The payload uses provided transition value as id in preview
    expect(res.request.body.transition.id).toBe("Done");
  });
});

