import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TelegraphConfig } from "../types.js";
import { callDaemon } from "../client.js";

export function registerDaemonTools(server: McpServer, config: TelegraphConfig): void {
  server.registerTool(
    "tg_daemon_health",
    {
      description: "Check the health status of the Telegraph Daemon. Returns status and server time. No payment required.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await callDaemon(config.daemonUrl, "/health");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Daemon unreachable: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "tg_daemon_categories",
    {
      description: "List all signal categories tracked by the Telegraph Daemon. Shows category name, question count, and average interest score. Categories include POLITICS, ECONOMICS, GEOPOLITICS, TECHNOLOGY, CLIMATE, HEALTH, FINANCE, CRYPTO, SPORTS, SCIENCE, SOCIAL, OTHER. No payment required.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await callDaemon(config.daemonUrl, "/api/categories");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "tg_daemon_questions",
    {
      description: "Query Telegraph Daemon-collected signals and questions. Supports filtering by category, source, sort order, time range, minimum interest score. Returns questions with their metadata, results, and interest scores. No payment required.",
      inputSchema: z.object({
        category: z.string().optional().describe("Filter by category (e.g., CRYPTO, TECHNOLOGY, CLIMATE, HEALTH, POLITICS)"),
        source: z.string().optional().describe("Filter by data source (e.g., reddit, polymarket, gdelt)"),
        sort: z.enum(["interest", "timestamp"]).optional().describe("Sort order (default: timestamp)"),
        since_hours: z.number().optional().describe("Only return results from the last N hours"),
        min_interest: z.number().optional().describe("Minimum interest score filter"),
        limit: z.number().optional().describe("Max results to return (default: 10)"),
        offset: z.number().optional().describe("Pagination offset"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args: Record<string, unknown>) => {
      try {
        const queryParams: Record<string, string> = {};
        if (args.category) queryParams.category = args.category as string;
        if (args.source) queryParams.source = args.source as string;
        if (args.sort) queryParams.sort = args.sort as string;
        if (args.since_hours !== undefined) queryParams.since_hours = String(args.since_hours);
        if (args.min_interest !== undefined) queryParams.min_interest = String(args.min_interest);
        if (args.limit !== undefined) queryParams.limit = String(args.limit);
        if (args.offset !== undefined) queryParams.offset = String(args.offset);

        const result = await callDaemon(config.daemonUrl, "/api/questions", queryParams);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
