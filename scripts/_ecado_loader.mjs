/**
 * Loads lib/ecado/* into Node without a bundler.
 *
 * The modules are ESM but use extensionless relative specifiers ("./types"),
 * which Node's ESM resolver does not complete, and the package is not
 * type:module. Rather than change either — both would affect the Next build —
 * this mirrors the files into a temp directory as .mjs with specifiers
 * rewritten. The source is otherwise untouched, so the tests exercise exactly
 * the code that ships.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function loadEcado(moduleName = "classify") {
  const src = path.join(process.cwd(), "lib", "ecado");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ecado-eval-"));

  for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".js"))) {
    const code = fs
      .readFileSync(path.join(src, file), "utf8")
      // Flatten parent-relative specifiers (../staffDirectory) into the temp
      // dir, and give every relative specifier an explicit .mjs extension.
      .replace(/(from\s+")(\.\.?\/[^"]+?)(")/g, (m, a, spec, c) => {
        const flat = "./" + spec.replace(/^(\.\.?\/)+/, "");
        return `${a}${flat}.mjs${c}`;
      });
    fs.writeFileSync(path.join(out, file.replace(/\.js$/, ".mjs")), code);
  }
  // ../staffDirectory and ./supabase-server are only needed by collect.js at
  // runtime; stub them so the rule engine can be loaded in isolation.
  fs.writeFileSync(path.join(out, "staffDirectory.mjs"), "export const listDirectoryUsers=async()=>[];export const directoryById=()=>new Map();export const staffDirectoryRecord=(u)=>u;export const normaliseStaffEmail=(e)=>e;\n");
  fs.writeFileSync(path.join(out, "supabase-server.mjs"), "export const readerClient=()=>{throw new Error('not used in evals')};export const writerClient=readerClient;export const WRITABLE_TABLES=[];export const assertWritable=()=>{};\n");

  return import(path.join(out, `${moduleName}.mjs`));
}

/** Build a snapshot in the shape collectSnapshot() produces. */
export function snapshot(feeds = {}, generatedAt = "2026-09-11T00:00:00.000Z") {
  const built = {};
  for (const [name, rows] of Object.entries(feeds)) {
    built[name] = { feed: name, table: `t_${name}`, rows, gap: null, dataCurrentTo: generatedAt };
  }
  return { generatedAt, feeds: built, gaps: [], dataCurrentTo: {} };
}
