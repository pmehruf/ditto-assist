// One-off helper: psql isn't installed on this machine, so this uses the
// project's existing `postgres` package (already a dependency) instead.
// Usage:
//   node scripts/runGovernanceSql.mjs verify
//   node scripts/runGovernanceSql.mjs apply
// Reads DATABASE_URL from the environment (set it first, see commands below).

import postgres from "postgres";
import { readFileSync } from "fs";

const mode = process.argv[2];
if (!mode || !["verify", "apply", "diagnose", "diagnose-overrides", "diagnose-scope"].includes(mode)) {
  console.error("Usage: node scripts/runGovernanceSql.mjs <verify|apply|diagnose|diagnose-overrides|diagnose-scope>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Set it first (see the PowerShell commands provided).");
  process.exit(1);
}

// max: 1 -- the apply step sends a single multi-statement script containing
// its own BEGIN...COMMIT; postgres-js refuses to run that over a pooled
// connection (statements could land on different connections), so this
// script always uses one dedicated connection instead.
const sql = postgres(connectionString, { ssl: "require", max: 1 });

async function verify() {
  console.log("--- Query 1: canonical_name uniqueness for override targets (expect 0 rows) ---");
  const q1 = await sql`
    SELECT canonical_name, count(*) FROM ped_repository
    WHERE canonical_name IN (
      'Marfan Syndrome','Ehlers-Danlos Syndrome','Spinal Muscular Atrophy','G6PD Deficiency',
      'Cystic Fibrosis','Pompe Disease','Gaucher Disease','Alpha-1 Antitrypsin Deficiency',
      'Enzyme Deficiency','Down Syndrome','Turner Syndrome','Klinefelter Syndrome','Noonan Syndrome'
    )
    GROUP BY canonical_name HAVING count(*) <> 1;
  `;
  console.table(q1);

  console.log("--- Query 2: recategorization targets (expect exactly 4 rows, 1 each) ---");
  const q2 = await sql`
    SELECT canonical_name, count(*) FROM ped_repository
    WHERE canonical_name ILIKE 'Huntington%' OR canonical_name ILIKE 'Friedreich%Ataxia'
       OR canonical_name ILIKE 'Charcot%Marie%Tooth%' OR canonical_name ILIKE 'Spinocerebellar Ataxia'
    GROUP BY canonical_name;
  `;
  console.table(q2);

  console.log("--- Query 3: alias collisions for the 28 new PEDs (expect 0 rows) ---");
  const q3 = await sql`
    SELECT normalized_alias, ped_id FROM ped_aliases WHERE normalized_alias IN (
      'patent ductus arteriosus','pda','coarctation of aorta','transposition of great arteries','tga',
      'truncus arteriosus','hypoplastic left heart syndrome','hlhs','total anomalous pulmonary venous return','tapvr',
      'arnold chiari malformation','chiari malformation','dandy walker malformation','dandy walker syndrome',
      'holoprosencephaly','encephalocele','craniosynostosis','congenital hip dysplasia',
      'developmental dysplasia of the hip','ddh','renal agenesis','congenital solitary kidney','imperforate anus',
      'congenital diaphragmatic hernia','cdh','gastroschisis','omphalocele','tracheoesophageal fistula','tef',
      'prune belly syndrome','eagle barrett syndrome','bladder exstrophy','digeorge syndrome',
      '22q11.2 deletion syndrome','velocardiofacial syndrome','shprintzen syndrome','congenital hypothyroidism',
      'biliary atresia','congenital hydrocephalus','normal pressure hydrocephalus','acquired hydrocephalus',
      'choanal atresia','congenital ptosis','microcephaly','anencephaly'
    );
  `;
  console.table(q3);

  const clean = q1.length === 0 && q2.length === 4 && q3.length === 0;
  console.log(clean ? "\n✅ All clean — safe to run 'apply'." : "\n⚠️ Unexpected results above — stop and share this output before applying.");
}

async function diagnose() {
  console.log("--- PED rows behind the two colliding aliases ('pda', 'normal pressure hydrocephalus') ---");
  const rows = await sql.unsafe(
    "SELECT id, canonical_name, category_key, status FROM ped_repository WHERE id IN (1072, 1092)"
  );
  console.table(rows);

  console.log("\n--- The alias rows themselves, for full context ---");
  const aliasRows = await sql.unsafe(
    "SELECT id, ped_id, alias_text, normalized_alias, is_primary, is_visible FROM ped_aliases WHERE normalized_alias IN ('pda', 'normal pressure hydrocephalus')"
  );
  console.table(aliasRows);
}

async function diagnoseOverrides() {
  console.log("--- Do the 13 override-target PEDs actually exist, under this exact name? ---");
  const peds = await sql.unsafe(`
    SELECT canonical_name, id, category_key FROM ped_repository
    WHERE canonical_name IN (
      'Marfan Syndrome','Ehlers-Danlos Syndrome','Spinal Muscular Atrophy','G6PD Deficiency',
      'Cystic Fibrosis','Pompe Disease','Gaucher Disease','Alpha-1 Antitrypsin Deficiency',
      'Enzyme Deficiency','Down Syndrome','Turner Syndrome','Klinefelter Syndrome','Noonan Syndrome'
    )
    ORDER BY canonical_name;
  `);
  console.table(peds);
  console.log(`Found ${peds.length} of 13 expected names as exact matches.`);

  console.log("\n--- Do plan_overrides rows exist for those PEDs on Optima Secure? ---");
  const overrides = await sql.unsafe(`
    SELECT po.id, pr.canonical_name, po.category_key, po.reason
    FROM plan_overrides po
    JOIN ped_repository pr ON pr.id = po.ped_id
    WHERE po.plan_name = 'Optima Secure'
    ORDER BY pr.canonical_name;
  `);
  console.table(overrides);
  console.log(`Found ${overrides.length} override rows on Optima Secure (expected 13).`);

  console.log("\n--- Any of the 13 names that exist but got NO override row? ---");
  const pedNames = new Set(peds.map((p) => p.canonical_name));
  const overriddenNames = new Set(overrides.map((o) => o.canonical_name));
  for (const name of pedNames) {
    if (!overriddenNames.has(name)) console.log("  MISSING OVERRIDE:", name);
  }
}

async function diagnoseFullScope() {
  // All 23 canonical PEDs this whole review reasoned about as "currently
  // genetic in the repository" (9 default-routed + 13 override targets +
  // 1 excluded-by-earlier-recategorization). Checking every one against
  // the live DB, by both canonical_name and by alias, since a condition
  // could exist under a different canonical_name with this as an alias.
  const names = [
    "Congenital Heart Defect","Atrial Septal Defect","Ventricular Septal Defect","Tetralogy of Fallot",
    "Spina Bifida","Cleft Lip Cleft Palate","Clubfoot Deformity","Osteogenesis Imperfecta","Achondroplasia",
    "Marfan Syndrome","Ehlers-Danlos Syndrome","Spinal Muscular Atrophy","G6PD Deficiency","Cystic Fibrosis",
    "Pompe Disease","Gaucher Disease","Alpha-1 Antitrypsin Deficiency","Enzyme Deficiency",
    "Down Syndrome","Turner Syndrome","Klinefelter Syndrome","Noonan Syndrome","Spinocerebellar Ataxia"
  ];
  const aliasKeys = names.map((n) => n.toLowerCase());

  console.log("--- Exact canonical_name matches ---");
  const byName = await sql.unsafe(
    `SELECT canonical_name, category_key FROM ped_repository WHERE canonical_name = ANY($1::text[]) ORDER BY canonical_name`,
    [names]
  );
  console.table(byName);

  console.log("\n--- Matches via ped_aliases (canonical_name might differ) ---");
  const byAlias = await sql.unsafe(
    `SELECT a.normalized_alias, a.ped_id, pr.canonical_name, pr.category_key
     FROM ped_aliases a JOIN ped_repository pr ON pr.id = a.ped_id
     WHERE a.normalized_alias = ANY($1::text[]) ORDER BY a.normalized_alias`,
    [aliasKeys]
  );
  console.table(byAlias);

  const foundByName = new Set(byName.map((r) => r.canonical_name));
  const foundByAliasKey = new Set(byAlias.map((r) => r.normalized_alias));
  console.log("\n--- Of the 23, which have NEITHER an exact canonical_name NOR an alias match? ---");
  let missingCount = 0;
  for (const n of names) {
    if (!foundByName.has(n) && !foundByAliasKey.has(n.toLowerCase())) {
      console.log("  TRULY MISSING:", n);
      missingCount++;
    }
  }
  console.log(`\n${missingCount} of ${names.length} are completely absent from the live repository (no canonical_name, no alias).`);
}

async function apply() {
  const script = readFileSync(new URL("../congenital_governance_part_f.sql", import.meta.url), "utf8");
  console.log("Executing congenital_governance_part_f.sql ...");
  await sql.unsafe(script);
  console.log("✅ Done. No errors thrown.");
}

try {
  if (mode === "verify") await verify();
  else if (mode === "diagnose") await diagnose();
  else if (mode === "diagnose-overrides") await diagnoseOverrides();
  else if (mode === "diagnose-scope") await diagnoseFullScope();
  else await apply();
} catch (err) {
  console.error("❌ FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
