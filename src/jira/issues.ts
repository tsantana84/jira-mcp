/* Lightweight helpers for ADF and normalization (skeleton) */

export function toADF(plain?: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: plain ? [{ type: "text", text: plain }] : [],
      },
    ],
  } as const;
}

export function issueUrl(baseUrl: string, key: string) {
  return `${baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

export function adfToPlainText(adf: any): string {
  if (!adf || typeof adf !== "object") return "";
  // Very minimal flattener: concatenates text nodes with newlines between paragraphs
  const lines: string[] = [];
  const content = Array.isArray(adf.content) ? adf.content : [];
  for (const node of content) {
    if (node?.type === "paragraph") {
      const texts: string[] = [];
      const inner = Array.isArray(node.content) ? node.content : [];
      for (const t of inner) {
        if (t?.type === "text" && typeof t.text === "string") texts.push(t.text);
      }
      lines.push(texts.join(""));
    }
  }
  return lines.filter(Boolean).join("\n");
}

// Normalization stub: real mapping deferred until client is implemented
export function normalizeIssue(raw: any, baseUrl: string) {
  // Expect Jira REST v3 issue payload in `raw`
  const key = raw?.key ?? "UNKNOWN-0";
  return {
    id: String(raw?.id ?? "0"),
    key,
    url: issueUrl(baseUrl, key),
    summary: raw?.fields?.summary ?? "",
    status: {
      id: String(raw?.fields?.status?.id ?? ""),
      name: raw?.fields?.status?.name ?? "",
      category: {
        key: raw?.fields?.status?.statusCategory?.key ?? "",
        name: raw?.fields?.status?.statusCategory?.name ?? "",
      },
    },
    assignee: raw?.fields?.assignee
      ? {
          accountId: raw.fields.assignee.accountId,
          displayName: raw.fields.assignee.displayName,
        }
      : undefined,
    reporter: raw?.fields?.reporter
      ? {
          accountId: raw.fields.reporter.accountId,
          displayName: raw.fields.reporter.displayName,
        }
      : undefined,
    priority: raw?.fields?.priority
      ? { id: String(raw.fields.priority.id), name: raw.fields.priority.name }
      : undefined,
    labels: Array.isArray(raw?.fields?.labels) ? raw.fields.labels : [],
    project: {
      id: String(raw?.fields?.project?.id ?? ""),
      key: raw?.fields?.project?.key ?? "",
      name: raw?.fields?.project?.name ?? "",
    },
    issueType: {
      id: String(raw?.fields?.issuetype?.id ?? ""),
      name: raw?.fields?.issuetype?.name ?? "",
    },
    created: raw?.fields?.created ?? new Date().toISOString(),
    updated: raw?.fields?.updated ?? new Date().toISOString(),
    custom: undefined,
    raw,
  };
}
