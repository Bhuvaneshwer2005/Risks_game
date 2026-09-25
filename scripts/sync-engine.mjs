// Copies the rules engine (src/game/*.ts) byte-for-byte into the Edge
// Function bundle, so the server runs exactly the code the tests cover.
// Deno can't import from outside supabase/functions when deploying.
//
//   node scripts/sync-engine.mjs          # copy
//   node scripts/sync-engine.mjs --check  # exit 1 if the copy is stale

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_SRC = join(root, "src", "game");
export const ENGINE_DEST = join(root, "supabase", "functions", "game", "_engine");

export function engineFiles() {
  return readdirSync(ENGINE_SRC)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

export function staleFiles() {
  const expected = engineFiles();
  const stale = [];
  for (const f of expected) {
    const dest = join(ENGINE_DEST, f);
    if (!existsSync(dest) || !readFileSync(dest).equals(readFileSync(join(ENGINE_SRC, f)))) stale.push(f);
  }
  const extra = existsSync(ENGINE_DEST) ? readdirSync(ENGINE_DEST).filter((f) => !expected.includes(f)) : [];
  return [...stale, ...extra];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) {
      console.error(`Engine copy is stale: ${stale.join(", ")}. Run npm run sync:engine.`);
      process.exit(1);
    }
    console.log("Engine copy is up to date.");
  } else {
    rmSync(ENGINE_DEST, { recursive: true, force: true });
    mkdirSync(ENGINE_DEST, { recursive: true });
    for (const f of engineFiles()) writeFileSync(join(ENGINE_DEST, f), readFileSync(join(ENGINE_SRC, f)));
    console.log(`Copied ${engineFiles().length} engine files to supabase/functions/game/_engine/`);
  }
}
