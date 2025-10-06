/* adf parser - extract confluence links from atlassian document format */

export interface ConfluenceLink {
  pageId?: string;
  url: string;
  title?: string;
}

/**
 * extract confluence links from adf (atlassian document format) content
 * handles inlineCard nodes with confluence urls and confluencePage nodes
 */
export function extractConfluenceLinks(adf: any, confluenceBaseUrl: string): ConfluenceLink[] {
  const links: ConfluenceLink[] = [];
  const seen = new Set<string>();

  const traverse = (node: any): void => {
    if (!node || typeof node !== "object") return;

    // check for inlineCard with confluence url
    if (node.type === "inlineCard" && node.attrs?.url) {
      const url = node.attrs.url;
      if (url.includes(confluenceBaseUrl) || url.includes("/wiki/")) {
        if (!seen.has(url)) {
          seen.add(url);
          links.push({
            url,
            title: node.attrs.title,
            pageId: extractPageIdFromUrl(url),
          });
        }
      }
    }

    // check for confluencePage node (specific confluence embed)
    if (node.type === "confluencePage" && node.attrs) {
      const pageId = node.attrs.id || node.attrs.pageId;
      const url = node.attrs.url || (pageId ? `${confluenceBaseUrl}/pages/viewpage.action?pageId=${pageId}` : undefined);
      if (url && !seen.has(url)) {
        seen.add(url);
        links.push({
          url,
          title: node.attrs.title,
          pageId: pageId ? String(pageId) : extractPageIdFromUrl(url),
        });
      }
    }

    // check for bodiedExtension with confluence macros
    if (node.type === "bodiedExtension" && node.attrs?.extensionKey === "confluence-content") {
      const params = node.attrs.parameters;
      if (params?.contentId) {
        const pageId = String(params.contentId);
        const url = `${confluenceBaseUrl}/pages/viewpage.action?pageId=${pageId}`;
        if (!seen.has(url)) {
          seen.add(url);
          links.push({
            url,
            pageId,
            title: params.title,
          });
        }
      }
    }

    // recurse into content array
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }

    // recurse into marks (for link marks)
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === "link" && mark.attrs?.href) {
          const href = mark.attrs.href;
          if (href.includes(confluenceBaseUrl) || href.includes("/wiki/")) {
            if (!seen.has(href)) {
              seen.add(href);
              links.push({
                url: href,
                pageId: extractPageIdFromUrl(href),
              });
            }
          }
        }
      }
    }
  };

  traverse(adf);
  return links;
}

/**
 * extract page id from confluence url
 * handles formats:
 * - /pages/viewpage.action?pageId=123456
 * - /wiki/spaces/SPACE/pages/123456/title
 * - /display/SPACE/title+words?pageId=123456
 */
function extractPageIdFromUrl(url: string): string | undefined {
  // try pageId query param
  const pageIdMatch = url.match(/[?&]pageId=(\d+)/);
  if (pageIdMatch) return pageIdMatch[1];

  // try /pages/123456/ pattern
  const pagesMatch = url.match(/\/pages\/(\d+)/);
  if (pagesMatch) return pagesMatch[1];

  return undefined;
}
