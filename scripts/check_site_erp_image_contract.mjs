import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const schema = await readFile(new URL("lib/formSchemas.js", root), "utf8");
const component = await readFile(new URL("components/StaffForms.js", root), "utf8");
const route = await readFile(new URL("app/api/whs-forms/route.js", root), "utf8");
const styles = await readFile(new URL("app/globals.css", root), "utf8");

assert.match(schema, /"hospitalRouteEvidence",\s*"Route image: project site to nearest hospital",\s*"image"/s);
assert.match(schema, /"hospitalDirectionsImage",\s*"Directions image: access and turn-by-turn details",\s*"image"/s);
assert.match(schema, /"hospitalDirections",\s*"Written directions and access details",\s*"textarea"/s);
assert.match(component, /async function prepareFormImage/);
assert.match(component, /accept="image\/jpeg,image\/png,image\/webp"/);
assert.match(component, /canvas\.toDataURL\("image\/jpeg", 0\.72\)/);
assert.match(component, /className="sf-image-preview"/);
assert.match(component, /activeKey === "site_erp" \? " sf-erp-form"/);
assert.match(route, /function normaliseSiteErpDetails/);
assert.match(route, /hospitalDirectionsImage/);
assert.match(route, /data:image/);
assert.match(route, /jpeg\|png\|webp/);
assert.match(route, /b\.form_type === "site_erp"/);
assert.match(styles, /\.sf-erp-form \.sf-form/);
assert.match(styles, /\.sf-erp-form \.sf-field input/);
assert.match(styles, /\.sf-image-preview/);

console.log("Site Specific ERP image and readability contract passed: two image fields, written directions, compressed previews, server validation and Training Register-style typography.");
