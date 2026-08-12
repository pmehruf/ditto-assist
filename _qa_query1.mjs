import postgres from "postgres";
import fs from "fs";

const envFile = fs.readFileSync(".env", "utf8");
const match = envFile.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
const url = match[1];
const sql = postgres(url, { max: 2 });

const cats = await sql`SELECT category_key, label, description FROM categories ORDER BY sort_order`;
console.log("=== CATEGORIES ===");
for (const c of cats) console.log(c.category_key, "|", c.label, "|", (c.description||"").slice(0,100));

await sql.end();
