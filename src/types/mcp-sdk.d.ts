declare module "@modelcontextprotocol/sdk/server/index.js" {
  export class Server {
    constructor(info: any, capabilities: any);
    connect(transport: any): Promise<void>;
    oninitialized?: () => void;
    getClientVersion?: () => any;
    tool?: (
      name: string,
      options: { input?: any; description?: string },
      handler: (ctx: any) => Promise<any>
    ) => void;
    addTool?: (def: any, handler: (ctx: any) => Promise<any>) => void;
    registerTool?: (def: any, handler: (ctx: any) => Promise<any>) => void;
  }
}

// Client/server stdio located under server/stdio for server transport
declare module "@modelcontextprotocol/sdk/server/stdio/index.js" {
  export class StdioServerTransport {
    constructor();
  }
}

// Also support subpath imports without explicit index.js for both
declare module "@modelcontextprotocol/sdk/server" {
  export { Server } from "@modelcontextprotocol/sdk/server/index.js";
}
declare module "@modelcontextprotocol/sdk/server/stdio" {
  export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio/index.js";
}
declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio/index.js";
}
