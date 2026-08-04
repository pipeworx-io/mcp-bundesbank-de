# mcp-bundesbank-de

Deutsche Bundesbank (Germany's central bank) statistics MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `list_dataflows` | List the available Bundesbank statistics dataflows (each is a series collection you can query with get_series). Returns SDMX 2.1 structure XML listing every dataflow id + name under agency BBK. Well-known flows: BBEX3 (exchange rates), BBK01 (legacy single time series), BBSIS (interest rates), BBBK1/BBBK2 (banking statistics), BBDB1 (balance of payments). Pass a flowRef to fetch just that one dataflow (includes its DataStructure reference). |
| `dataflow_structure` | Get the data structure definition (DSD) for a dataflow: its dimensions and the valid codes for each, which you need to build a series key for get_series. Returns SDMX 2.1 structure XML. The DSD id differs from the dataflow id (e.g. dataflow BBEX3 uses DSD "BBK_ERX"). Pass the dataflow id (flowRef) and this tool resolves the DSD for you; the dimensions appear in <DimensionList> in key order. Set withCodes=true (default) to inline the codelists (references=children). |
| `get_series` | Pull observations for a Bundesbank series as SDMX-JSON. flowRef is the dataflow id (e.g. "BBEX3"); key is a dot-separated SDMX dimension filter in key order (e.g. "D.USD.EUR.BB.AC.000" = daily USD/EUR reference rate). Use dataflow_structure to discover the dimensions/codes for a flow. Leave a dimension empty to wildcard it (e.g. "D..EUR.BB.AC.000"). Filter by lastNObservations (most recent N) or a startPeriod/endPeriod date range (YYYY, YYYY-MM, or YYYY-MM-DD). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "bundesbank-de": {
      "url": "https://gateway.pipeworx.io/bundesbank-de/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Bundesbank De data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
