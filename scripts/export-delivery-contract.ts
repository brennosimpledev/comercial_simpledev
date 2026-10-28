import { mkdirSync, writeFileSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { scopeSchema, planSchema } from "../src/lib/delivery/schema";
mkdirSync("integrations/escopo-simpledev/references", { recursive: true });
for (const [name, schema] of [
  ["scope", scopeSchema],
  ["plan", planSchema],
] as const)
  writeFileSync(
    `integrations/escopo-simpledev/references/${name}.schema.json`,
    JSON.stringify(zodToJsonSchema(schema, name), null, 2) + "\n",
  );
