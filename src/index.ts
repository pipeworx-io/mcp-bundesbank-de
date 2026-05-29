interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Deutsche Bundesbank (Germany's central bank) statistics MCP.
 *
 * Wraps the keyless SDMX REST API at https://api.statistiken.bundesbank.de/rest.
 * No auth/key required; stateless.
 *
 * Quirk: the /data endpoint returns SDMX-JSON (Accept: application/json), but the
 * /metadata endpoints only serve SDMX 2.1 *XML* (JSON is rejected with HTTP 406),
 * so the structure tools return the raw XML string as text.
 */


const BASE = 'https://api.statistiken.bundesbank.de/rest';
const UA = 'pipeworx-mcp-bundesbank-de/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_dataflows',
    description:
      'List the available Bundesbank statistics dataflows (each is a series collection you can query with get_series). ' +
      'Returns SDMX 2.1 structure XML listing every dataflow id + name under agency BBK. ' +
      'Well-known flows: BBEX3 (exchange rates), BBK01 (legacy single time series), BBSIS (interest rates), ' +
      'BBBK1/BBBK2 (banking statistics), BBDB1 (balance of payments). ' +
      'Pass a flowRef to fetch just that one dataflow (includes its DataStructure reference).',
    inputSchema: {
      type: 'object',
      properties: {
        flowRef: {
          type: 'string',
          description: 'Optional. A single dataflow id (e.g. "BBEX3") to fetch instead of the full list.',
        },
      },
    },
  },
  {
    name: 'dataflow_structure',
    description:
      'Get the data structure definition (DSD) for a dataflow: its dimensions and the valid codes for each, ' +
      'which you need to build a series key for get_series. ' +
      'Returns SDMX 2.1 structure XML. The DSD id differs from the dataflow id (e.g. dataflow BBEX3 uses DSD "BBK_ERX"). ' +
      'Pass the dataflow id (flowRef) and this tool resolves the DSD for you; the dimensions appear in <DimensionList> ' +
      'in key order. Set withCodes=true (default) to inline the codelists (references=children).',
    inputSchema: {
      type: 'object',
      properties: {
        flowRef: {
          type: 'string',
          description: 'Dataflow id whose structure you want, e.g. "BBEX3".',
        },
        withCodes: {
          type: 'boolean',
          description: 'Include the referenced codelists (valid dimension values). Default true.',
        },
      },
      required: ['flowRef'],
    },
  },
  {
    name: 'get_series',
    description:
      'Pull observations for a Bundesbank series as SDMX-JSON. ' +
      'flowRef is the dataflow id (e.g. "BBEX3"); key is a dot-separated SDMX dimension filter in key order ' +
      '(e.g. "D.USD.EUR.BB.AC.000" = daily USD/EUR reference rate). ' +
      'Use dataflow_structure to discover the dimensions/codes for a flow. ' +
      'Leave a dimension empty to wildcard it (e.g. "D..EUR.BB.AC.000"). ' +
      'Filter by lastNObservations (most recent N) or a startPeriod/endPeriod date range (YYYY, YYYY-MM, or YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        flowRef: { type: 'string', description: 'Dataflow id, e.g. "BBEX3".' },
        key: {
          type: 'string',
          description: 'Dot-separated SDMX dimension filter, e.g. "D.USD.EUR.BB.AC.000". Empty segments wildcard a dimension.',
        },
        lastNObservations: { type: 'number', description: 'Return only the most recent N observations.' },
        startPeriod: { type: 'string', description: 'Inclusive start period (YYYY, YYYY-MM, or YYYY-MM-DD).' },
        endPeriod: { type: 'string', description: 'Inclusive end period (YYYY, YYYY-MM, or YYYY-MM-DD).' },
        detail: {
          type: 'string',
          description: 'SDMX detail level: "full" (default), "dataonly", "serieskeysonly", or "nodata".',
        },
      },
      required: ['flowRef', 'key'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_dataflows': {
      const flowRef = optStr(args, 'flowRef');
      const path = flowRef ? `/metadata/dataflow/BBK/${encodeURIComponent(flowRef)}` : '/metadata/dataflow/BBK';
      return { format: 'sdmx-structure-xml', xml: await bbkXml(path) };
    }
    case 'dataflow_structure': {
      const flowRef = reqStr(args, 'flowRef', '"BBEX3"');
      const withCodes = args.withCodes === undefined ? true : Boolean(args.withCodes);
      // The data structure (DSD) id differs from the dataflow id, so resolve it from the dataflow first.
      const flowXml = await bbkXml(`/metadata/dataflow/BBK/${encodeURIComponent(flowRef)}`);
      const dsdId = extractDsdId(flowXml);
      if (!dsdId) {
        throw new Error(
          `Bundesbank: could not find a DataStructure reference for dataflow "${flowRef}". ` +
            `Use list_dataflows to confirm the id.`,
        );
      }
      const ref = withCodes ? '?references=children' : '';
      const xml = await bbkXml(`/metadata/datastructure/BBK/${encodeURIComponent(dsdId)}${ref}`);
      return { dataflow: flowRef, dataStructureId: dsdId, format: 'sdmx-structure-xml', xml };
    }
    case 'get_series': {
      const flowRef = reqStr(args, 'flowRef', '"BBEX3"');
      const key = reqStr(args, 'key', '"D.USD.EUR.BB.AC.000"');
      const params = new URLSearchParams();
      const lastN = args.lastNObservations;
      if (typeof lastN === 'number' && Number.isFinite(lastN)) params.set('lastNObservations', String(Math.trunc(lastN)));
      const startPeriod = optStr(args, 'startPeriod');
      if (startPeriod) params.set('startPeriod', startPeriod);
      const endPeriod = optStr(args, 'endPeriod');
      if (endPeriod) params.set('endPeriod', endPeriod);
      const detail = optStr(args, 'detail');
      if (detail) params.set('detail', detail);
      const qs = params.toString();
      const path = `/data/${encodeURIComponent(flowRef)}/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;
      return bbkJson(path);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Fetch SDMX-JSON (the /data endpoint serves application/json). */
async function bbkJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Bundesbank: ${res.status} ${await body(res)}`);
  return res.json();
}

/** Fetch SDMX 2.1 structure XML (the /metadata endpoints reject JSON with 406). */
async function bbkXml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    // metadata only serves XML; */* lets the server pick its default (structure+xml).
    headers: { Accept: 'application/vnd.sdmx.structure+xml, */*', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Bundesbank: ${res.status} ${await body(res)}`);
  return res.text();
}

async function body(res: Response): Promise<string> {
  return res
    .text()
    .then((t) => t.slice(0, 200))
    .catch(() => '');
}

/** Pull the referenced DataStructure id out of a dataflow's structure XML. */
function extractDsdId(xml: string): string | undefined {
  const m = xml.match(/<Ref\b[^>]*class="DataStructure"[^>]*>/);
  if (!m) return undefined;
  const id = m[0].match(/\bid="([^"]+)"/);
  return id?.[1];
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v.trim();
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
