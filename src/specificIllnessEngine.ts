/**
 * Specific Illness Waiting Period Ledger Matching Engine
 * Compares customer-declared PEDs against specific 2-year wait list schedules.
 */

export interface SpecificIllnessMatchResult {
  declared_condition: string;
  matched_listed_illness: string | null;
  match_type: "direct" | "alias" | "procedure_mapped" | "sub_condition" | "broad_category" | "no_match";
  plans_applicable: string[];
  confidence: "high" | "medium" | "low";
  notes: string;
}

/**
 * Shape of a single manual override record as stored (JSON-serialized) under
 * the `ditto_plan_specific_illnesses` localStorage key — a per-plan list of
 * illness-schedule text overrides that supplements/patches the static
 * `plan_schedules` map on `MasterIllnessDefinition`.
 */
export interface IllnessOverrideRecord {
  illnessId?: string;
  scheduleText?: string;
}

export interface MasterIllnessDefinition {
  id: string; // unique key
  parent_illness: string; // normalized English parent
  category: "Gastroenterology" | "Orthopaedic / Rheumatological" | "Eye" | "ENT" | "Gynaecology" | "Urogenital" | "Skin" | "Neurological" | "General / Benign tumours";
  direct_names: string[]; // standard direct names
  aliases: string[]; // different names, same condition
  procedures: string[]; // surgical/medical interventions
  sub_conditions: string[]; // nested sub-types or direct extensions
  is_broad_category: boolean;
  broad_category_terms?: string[]; // keywords triggering broad category resolution
  plan_schedules: Record<string, string>; // exact wording of schedule per plan
}

export const MASTER_ILLNESSES: MasterIllnessDefinition[] = [
  {
    id: "piles",
    parent_illness: "Haemorrhoids / Piles",
    category: "Gastroenterology",
    direct_names: ["haemorrhoids", "hemorrhoids", "piles", "piles / piles in back", "haemorrhoids / piles"],
    aliases: ["hemorrhoid", "haemorrhoid", "internal piles", "external hemorrhoids", "internal haemorrhoids", "external piles"],
    procedures: ["haemorrhoidectomy", "hemorrhoidectomy", "piles surgery", "banding of piles", "stapled haemorrhoidopexy"],
    sub_conditions: ["haemorrhoidectomy", "hemorrhoidectomy"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Fissure, Fistula in ano, hemorrhoids (piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess",
      "Optima Secure": "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism",
      "Care Supreme": "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers",
      "Activ One Max": "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess",
      "Aspire": "Hemorrhoids, fissure, fistula or abscess of anal and rectal region",
      "Reassure 2.0": "Hemorrhoids, fissure, fistula or abscess of anal and rectal region"
    }
  },
  {
    id: "fissure_fistula",
    parent_illness: "Fissure / Fistula in Ano",
    category: "Gastroenterology",
    direct_names: ["fissure", "fistula", "fissure in ano", "fistula in ano", "anal fissure", "anal fistula", "fissure / fistula in ano"],
    aliases: ["fissures", "fistulas", "fistula-in-ano", "fissure-in-ano"],
    procedures: ["fissurectomy", "fistulectomy", "sphincterotomy", "fistula plug", "ligation of intersphincteric fistula tract", "lift procedure", "anal dilatation"],
    sub_conditions: ["perianal abscess", "ano-rectal abscess", "perianal abscesses", "perineal abscesses", "anal abscess", "rectal abscess"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Fissure, Fistula in ano, hemorrhoids (piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess",
      "Optima Secure": "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism",
      "Care Supreme": "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers",
      "Activ One Max": "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess",
      "Aspire": "Hemorrhoids, fissure, fistula or abscess of anal and rectal region",
      "Reassure 2.0": "Hemorrhoids, fissure, fistula or abscess of anal and rectal region"
    }
  },
  {
    id: "pilonidal_sinus",
    parent_illness: "Pilonidal sinus",
    category: "Gastroenterology",
    direct_names: ["pilonidal sinus", "pilonidal disease"],
    aliases: ["pilonidal cyst", "pilonidal abscess", "pilonidal sinus disease"],
    procedures: ["pilonidal sinus excision", "pilonidal cystectomy", "excision of pilonidal sinus", "flap surgery for pilonidal"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Fissure, Fistula in ano, hemorrhoids (piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess",
      "Optima Secure": "Pilonidal sinus",
      "Care Supreme": "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers",
      "Activ One Max": "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess"
    }
  },
  {
    // Added 2026-08-19, verified against the actual Optima Secure policy
    // wording — "Perianal Abscesses" (and a near-duplicate "Perineal
    // Abscesses" line, and a separate "Surgery for Perianal Abscesses"
    // procedure line) are their own standalone schedule entries there, not
    // part of the Fissure/Fistula/Haemorrhoids line. Only Optima Secure is
    // populated: for Activ Fit Preferred, Care Supreme, Activ One Max,
    // Aspire, and Reassure 2.0, abscess IS genuinely bundled into the
    // fissure_fistula/piles wording above (their own text explicitly says
    // "...Ano-rectal & Perianal Abscess" / "...abscess of anal and rectal
    // region"), so `fissure_fistula`'s sub_conditions list is left
    // unchanged — correct for those plans.
    id: "perianal_abscess",
    parent_illness: "Perianal / Perineal Abscess",
    category: "Gastroenterology",
    direct_names: ["perianal abscess", "perineal abscess"],
    aliases: ["perianal abscesses", "perineal abscesses", "ano-rectal abscess", "anal abscess", "rectal abscess"],
    procedures: ["surgery for perianal abscess", "incision and drainage of perianal abscess"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Optima Secure": "Perianal Abscesses"
    }
  },
  {
    id: "gallbladder_stone",
    parent_illness: "Gallbladder stone / Cholecystitis",
    category: "Gastroenterology",
    direct_names: ["gallbladder stone", "cholecystitis", "gallbladder stone / cholecystitis"],
    aliases: ["cholelithiasis", "gallstone", "gallstones", "biliary calculus", "stone in bile duct", "biliary stone", "gallbladder stones", "biliary stones", "stone in gall bladder"],
    procedures: ["cholecystectomy", "gallbladder removal", "ercp", "laparoscopic cholecystectomy"],
    sub_conditions: ["biliary colic", "biliary tract infection", "gallbladder sludge"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Stone in Gall Bladder, Bile duct & other parts of Biliary System",
      "Optima Secure": "Diseases of gall bladder including cholecystitis",
      "Care Supreme": "Kidney Stone/ Ureteric Stone/ Lithotripsy/ Gall Bladder Stone",
      "Activ One Max": "Stone in Gall Bladder, Bile duct & other parts of Biliary System",
      "Aspire": "Pancreatitis and stones in biliary and urinary system",
      "Reassure 2.0": "Pancreatitis and stones in biliary and urinary system"
    }
  },
  {
    id: "pancreatitis",
    parent_illness: "Pancreatitis",
    category: "Gastroenterology",
    direct_names: ["pancreatitis"],
    aliases: ["acute pancreatitis", "chronic pancreatitis", "pancreatic inflammation"],
    procedures: ["pancreatoduodenectomy", "pancreatic surgery", "pseudocyst drainage"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Pancreatitis",
      "Optima Secure": "Pancreatitis",
      "Care Supreme": "Pancreatitis or Liver disease (including but not limited to Cirrhosis / Hepatitis B or C / Willson's disease) or any other digestive track disorder",
      "Activ One Max": "Pancreatitis",
      "Aspire": "Pancreatitis and stones in biliary and urinary system",
      "Reassure 2.0": "Pancreatitis and stones in biliary and urinary system"
    }
  },
  {
    id: "gastric_ulcer",
    parent_illness: "Gastric / Duodenal ulcer",
    category: "Gastroenterology",
    direct_names: ["gastric ulcer", "duodenal ulcer", "peptic ulcer", "gastric / duodenal ulcer"],
    aliases: ["stomach ulcer", "gastric erosion", "duodenal erosion", "peptic ulcer disease", "stomach ulcers", "pud", "duodenal ulcer disease", "gastroduodenal ulcer", "gastric ulcer disease", "erosive gastritis"],
    procedures: ["vagotomy", "pyloroplasty", "gastrojejunostomy", "endoscopy for ulcer bleeding"],
    sub_conditions: ["gastritis", "duodenitis", "colitis", "hyperacidity with gastritis", "antral gastritis", "erosion of stomach"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis",
      "Optima Secure": "Ulcer and erosion of stomach and duodenum",
      "Care Supreme": "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers",
      "Activ One Max": "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis",
      "Aspire": "Ulcer, erosion or varices of gastro intestinal tract",
      "Reassure 2.0": "Ulcer, erosion or varices of gastro intestinal tract"
    }
  },
  {
    id: "gerd",
    parent_illness: "GERD",
    category: "Gastroenterology",
    direct_names: ["gerd", "gastroesophageal reflux disease"],
    aliases: ["acid reflux", "gord", "reflux disease", "heartburn", "esophagitis", "reflux esophagitis"],
    procedures: ["fundoplication", "nissen fundoplication"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Gastro Esophageal Reflux Disease (GERD)",
      "Optima Secure": "Gastro Esophageal Reflux Disorder (GERD)",
      "Activ One Max": "Gastro Esophageal Reflux Disease (GERD)"
    }
  },
  {
    id: "cirrhosis",
    parent_illness: "Cirrhosis",
    category: "Gastroenterology",
    direct_names: ["cirrhosis", "liver cirrhosis"],
    aliases: ["hepatic cirrhosis", "fibrosis of liver", "hepatic fibrosis", "cirrhosis of liver", "liver fibrosis"],
    procedures: ["paracentesis", "tips procedure", "liver transplantation"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Cirrhosis",
      "Optima Secure": "All forms of Cirrhosis",
      "Activ One Max": "Cirrhosis"
    }
  },
  {
    id: "rectal_prolapse",
    parent_illness: "Rectal prolapse",
    category: "Gastroenterology",
    direct_names: ["rectal prolapse", "prolapsed rectum"],
    aliases: ["procidentia of rectum", "rectal mucosal prolapse"],
    procedures: ["rectopexy", "rectal prolapse repair", "delorme procedure", "althmeier procedure"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Rectal Prolapse",
      "Optima Secure": "Rectal Prolapse",
      "Activ One Max": "Rectal Prolapse"
    }
  },
  {
    id: "appendicitis",
    parent_illness: "Appendicitis",
    category: "Gastroenterology",
    direct_names: ["appendicitis"],
    aliases: ["chronic appendicitis", "appendicular abscess", "appendicular lump", "recurrent appendicitis"],
    procedures: ["appendectomy", "appendicectomy", "appendix surgery", "laparoscopic appendectomy", "laparoscopic appendicectomy"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Chronic Appendicitis",
      "Activ One Max": "Chronic Appendicitis"
    }
  },

  // Orthopaedic / Rheumatological
  {
    id: "osteoarthritis",
    parent_illness: "Osteoarthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["osteoarthritis"],
    aliases: ["oa", "degenerative joint disease", "wear-and-tear arthritis", "degenerative arthritis"],
    procedures: ["knee arthroscopy", "joint debridement"],
    sub_conditions: ["knee oa", "hip oa", "bilateral knee osteoarthritis", "osteoarthritis of knee", "osteoarthritis of hip"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Osteoarthritis",
      "Optima Secure": "Osteoarthritis and osteoporosis",
      "Care Supreme": "Osteoarthritis and Osteoporosis",
      "Activ One Max": "Osteoarthritis",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "rheumatoid_arthritis",
    parent_illness: "Rheumatoid Arthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["rheumatoid arthritis", "rheumatism"],
    aliases: ["ra", "autoimmune arthritis", "rheuma", "rheumatoid disease", "rheumatic arthritis"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Rheumatism, Rheumatoid Arthritis",
      "Optima Secure": "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism",
      "Care Supreme": "Rheumatism",
      "Activ One Max": "Rheumatism, Rheumatoid Arthritis",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "gout",
    parent_illness: "Gout",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["gout"],
    aliases: ["gouty arthritis", "hyperuricemia with arthritis", "podagra", "uric acid joint arthritis", "gouty arthropathy"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Gout",
      "Optima Secure": "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism",
      "Care Supreme": "Gout",
      "Activ One Max": "Gout",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "spondylosis",
    parent_illness: "Spondylosis / Spondyloarthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["spondylosis", "spondyloarthritis", "spondilitis", "spondylitis", "spondylopathies"],
    aliases: ["cervical spondylosis", "lumbar spondylosis", "spondylosis deformans", "ankylosing spondylitis", "cervical spondylitis", "lumbar spondylitis", "ankylosing spondilitis", "spinal osteitis"],
    procedures: ["laminectomy", "spinal decompression", "discectomy", "foraminotomy"],
    sub_conditions: ["psoriatic arthritis", "spondyloarthropathy", "psoriatic spondylitis", "enteropathic arthritis"],
    is_broad_category: true,
    broad_category_terms: ["spondylosis", "spondylitis", "spondioarthritis", "spondyloarthritis", "back pain stiffness", "ankylosing"],
    plan_schedules: {
      "Activ Fit Preferred": "Spondilosis, Spondioarthritis, Spondylopathies",
      "Optima Secure": "Non infective Arthritis",
      "Care Supreme": "Spinal Disorders",
      "Activ One Max": "Spondilosis, Spondioarthritis, Spondylopathies",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "knee_derangement",
    parent_illness: "Internal derangement of knee",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["internal derangement of knee", "ligament tear", "tendon tear", "meniscus tear", "meniscal tear", "meniscal injury"],
    aliases: ["idk", "ligament injury", "acl tear", "pcl tear", "mcl tear", "lcl tear", "knee ligament tear", "internal derangement of knee / ligament or tendon or meniscus", "knee cartillage tear"],
    procedures: ["acl reconstruction", "meniscal repair", "ligament repair", "arthroscopic knee surgery", "knee arthroscopy", "meniscectomy", "ligament reconstruction"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["derangement of knee", "ligament", "meniscus", "meniscal", "acl", "pcl", "tendon", "idk"],
    plan_schedules: {
      "Activ Fit Preferred": "Internal Derangement of Knee / Ligament or Tendon or Meniscus",
      "Optima Secure": "Ligament, Tendon and Meniscal tear",
      "Care Supreme": "Arthroscopic Knee Surgeries/ ACL Reconstruction/ Meniscal and Ligament Repair",
      "Activ One Max": "Internal Derangement of Knee / Ligament or Tendon / Meniscus Tear",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "slipped_disc",
    parent_illness: "Prolapsed intervertebral disc",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["prolapsed intervertebral disc", "slipped disc", "pivd", "disc prolapse"],
    aliases: ["pid", "herniated disc", "disc bulge", "herniated nucleus pulposus", "disc extrusion", "bulging disc", "herniated backbone disk", "spinal disc herniation"],
    procedures: ["discectomy", "microdiscectomy", "laminectomy", "disc replacement", "spinal fusion"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Prolapse of the intervertebral disc",
      "Optima Secure": "Surgery for prolapsed inter vertebral disc",
      "Care Supreme": "Spinal Disorders",
      "Activ One Max": "Prolapse of the intervertebral disc",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "osteoporosis",
    parent_illness: "Osteoporosis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["osteoporosis"],
    aliases: ["bone density loss", "low bone mass", "osteopenia"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Osteoporosis",
      "Optima Secure": "Osteoarthritis and osteoporosis",
      "Care Supreme": "Osteoarthritis and Osteoporosis",
      "Activ One Max": "Osteoporosis",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "joint_replacement",
    parent_illness: "Joint replacement surgery",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["joint replacement", "joint replacement surgery"],
    aliases: ["knee replacement", "hip replacement", "total knee arthroplasty", "tkr", "thr", "shoulder replacement", "total hip arthroplasty", "arthroplasty of joints"],
    procedures: ["knee replacement", "hip replacement", "total knee arthroplasty", "tkr", "thr", "shoulder replacement", "joint replacement surgery"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["replacement", "arthroplasty", "tkr", "thr"],
    plan_schedules: {
      "Activ Fit Preferred": "Joint Replacement Surgery",
      "Optima Secure": "Joint replacement surgeries",
      "Care Supreme": "Joint Replacement Surgery",
      "Activ One Max": "Joint Replacement Surgery",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    id: "non_infective_arthritis",
    parent_illness: "Non-infective arthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["non-infective arthritis", "non-infectious arthritis"],
    aliases: ["reactive arthritis", "psoriatic arthritis", "non infective arthritis", "ankylosing arthritis", "noninfectious arthritis", "juvenile chronic arthritis"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["arthritis", "arthropathy", "joint inflammation", "non infective", "non infectious"],
    plan_schedules: {
      "Activ Fit Preferred": "Non infective arthritis",
      "Optima Secure": "Non infective Arthritis",
      "Care Supreme": "Arthritis (if non-infective)",
      "Activ One Max": "Non infective arthritis",
      "Aspire": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair",
      "Reassure 2.0": "Osteoarthritis, joint replacement, osteoporosis, systemic connective tissue disorders, inflammatory polyarthropathies, Rheumatoid Arthritis, gout, intervertebral disc disorders, arthroscopic surgeries for ligament repair"
    }
  },
  {
    // Added 2026-08-19, verified against the Activ Fit Preferred and Activ
    // One Max policy PDFs — "Non Specific Arthritis" is its own standalone
    // schedule line there, distinct from "Non infective arthritis" above
    // (both appear as separate rows in the same Orthopedic/Rheumatological
    // section). Kept as its own entry rather than folded into
    // `non_infective_arthritis` so the quoted wording stays accurate.
    id: "non_specific_arthritis",
    parent_illness: "Non Specific Arthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["non specific arthritis", "nonspecific arthritis"],
    aliases: ["arthritis nos", "unspecified arthritis"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Non Specific Arthritis",
      "Activ One Max": "Non Specific Arthritis"
    }
  },
  {
    // Added 2026-08-19, verified against the Activ One Max policy PDF —
    // "Ankylosing Spondylitis / Spondyloarthropathies" is its own additional
    // schedule line unique to Activ One Max (not present in Activ Fit
    // Preferred's otherwise-identical list), separate from the generic
    // "Spondilosis, Spondioarthritis, Spondylopathies" line on `spondylosis`
    // above. Since "ankylosing spondylitis" is already an alias on
    // `spondylosis`, a search for it will correctly surface both cards for
    // Activ One Max — the generic spondylosis line and this more precise
    // one — rather than only the less-precise one.
    id: "ankylosing_spondylitis",
    parent_illness: "Ankylosing Spondylitis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["ankylosing spondylitis"],
    aliases: ["ankylosing spondyloarthropathies", "bechterew disease", "ankylosing spondyloarthritis"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ One Max": "Ankylosing Spondylitis / Spondyloarthropathies"
    }
  },
  {
    // Added 2026-08-19, verified against the Activ One Max policy PDF —
    // "Psoriatic Arthritis / Arthropathy" is its own additional schedule
    // line unique to Activ One Max, separate from the generic "Non infective
    // arthritis" line on `non_infective_arthritis` (which already lists
    // "psoriatic arthritis" as an alias). Kept as its own entry for the same
    // reason as `ankylosing_spondylitis` above — precise wording for the one
    // plan that lists it separately, while the broader card still surfaces
    // too.
    id: "psoriatic_arthritis",
    parent_illness: "Psoriatic Arthritis",
    category: "Orthopaedic / Rheumatological",
    direct_names: ["psoriatic arthritis", "psoriatic arthropathy"],
    aliases: ["psoriatic joint disease"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ One Max": "Psoriatic Arthritis / Arthropathy"
    }
  },

  // Eye
  {
    id: "cataract",
    parent_illness: "Cataract",
    category: "Eye",
    direct_names: ["cataract"],
    aliases: ["lens opacity", "opaque lens", "nuclear sclerosis", "cortical cataract"],
    procedures: ["cataract surgery", "phacoemulsification", "phaco", "lens replacement", "cataract extraction", "intraocular lens implantation", "iol implantation"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Cataract",
      "Optima Secure": "Cataract and other disorders of lens and Retina",
      "Care Supreme": "Cataract",
      "Activ One Max": "Cataract",
      "Aspire": "Cataract, glaucoma and retinal detachment",
      "Reassure 2.0": "Cataract, glaucoma and retinal detachment"
    }
  },
  {
    id: "glaucoma",
    parent_illness: "Glaucoma",
    category: "Eye",
    direct_names: ["glaucoma"],
    aliases: ["open angle glaucoma", "closed angle glaucoma", "intraocular pressure", "iop elevation", "narrow angle glaucoma", "ocular hypertension"],
    procedures: ["trabeculectomy", "glaucoma drainage device", "laser peripheral iridotomy", "lpi", "laser trabeculoplasty"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Glaucoma",
      "Optima Secure": "Glaucoma",
      "Activ One Max": "Glaucoma",
      "Aspire": "Cataract, glaucoma and retinal detachment",
      "Reassure 2.0": "Cataract, glaucoma and retinal detachment"
    }
  },
  {
    id: "refractive_error",
    parent_illness: "Refractive error correction",
    category: "Eye",
    direct_names: ["refractive error correction", "refractive surgery"],
    aliases: ["lasik", "prk", "laser eye surgery", "smile eye surgery", "smile laser", "icl surgery", "phakic lens", "refractive error surgery"],
    procedures: ["lasik", "prk", "laser eye surgery", "phakic iol", "smile surgery", "radial keratotomy"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["lasik", "prk", "refractive error", "laser eye", "nearsightedness correction", "myopia correction"],
    plan_schedules: {
      "Activ Fit Preferred": "Refractive Error Correction",
      "Activ One Max": "Refractive Error Correction"
    }
  },
  {
    id: "retinal_disorders",
    parent_illness: "Retinal disorders",
    category: "Eye",
    direct_names: ["retinal disorders", "retinopathy"],
    aliases: ["retinal detachment", "retinopathy", "macular degeneration", "amd", "diabetic retinopathy", "retinal tear", "macular hole"],
    procedures: ["vitrectomy", "scleral buckle", "pneumatic retinopexy", "retinal photocoagulation", "anti vegf injection"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["retinal", "retina", "retinopathy", "macular", "photocoagulation"],
    plan_schedules: {
      // Verified against the actual Optima Secure policy wording (2026-08-19):
      // "Retinal detachment" is its own distinct schedule line, separate from
      // "Cataract and other disorders of lens and Retina" — previously this
      // reused the cataract line's text, which was a wording inaccuracy
      // (the condition was still correctly flagged as covered, but quoted
      // the wrong policy line to the advisor).
      "Optima Secure": "Retinal detachment",
      "Aspire": "Cataract, glaucoma and retinal detachment",
      "Reassure 2.0": "Cataract, glaucoma and retinal detachment"
      // Verified 2026-08-19 against the Activ Fit Preferred and Activ One
      // Max policy PDFs: their Eye sections only list Cataract / Glaucoma /
      // Refractive Error Correction — neither plan has a separate
      // retinal-disorder line item, so no entry is populated for them here.
      // (The old Activ Fit Preferred entry was a stray Gynaecology-section
      // string pasted in by mistake; the old Activ One Max entry quoted
      // text that doesn't appear anywhere in that plan's schedule.)
    }
  },

  // ENT
  {
    id: "sinusitis",
    parent_illness: "Sinusitis",
    category: "ENT",
    direct_names: ["sinusitis"],
    aliases: ["chronic sinusitis", "sinusitis maxillaris", "paranasal sinusitis", "frontal sinusitis", "ethmoid sinusitis", "maxillary sinusitis"],
    procedures: ["fess", "functional endoscopic sinus surgery", "sinus surgery", "antral puncture"],
    sub_conditions: ["rhinosinusitis", "allergic rhinosinusitis"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Sinusitis",
      "Optima Secure": "Sinusitis, Rhinitis",
      "Care Supreme": "Nasal Septum Deviation, Sinusitis and realted disorders",
      "Activ One Max": "Sinusitis",
      "Aspire": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses",
      "Reassure 2.0": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses"
    }
  },
  {
    id: "rhinitis",
    parent_illness: "Rhinitis",
    category: "ENT",
    direct_names: ["rhinitis"],
    aliases: ["allergic rhinitis", "chronic rhinitis", "vasomotor rhinitis", "rhinorrhoea", "stuffy nose chronic"],
    procedures: ["turbinoplastic resection", "turbinate reduction"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Rhinitis",
      "Optima Secure": "Sinusitis, Rhinitis",
      "Activ One Max": "Rhinitis"
    }
  },
  {
    id: "deviated_nasal_septum",
    parent_illness: "Deviated nasal septum",
    category: "ENT",
    direct_names: ["deviated nasal septum", "nasal septum deviation"],
    aliases: ["dns", "crooked septum", "deviated septum"],
    procedures: ["septoplasty", "submucous resection", "smr", "septorhinoplasty"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Deviated Nasal Septum",
      "Optima Secure": "Surgery for Nasal septum deviation",
      "Care Supreme": "Nasal Septum Deviation, Sinusitis and realted disorders",
      "Activ One Max": "Deviated Nasal Septum",
      "Aspire": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses",
      "Reassure 2.0": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses"
    }
  },
  {
    id: "tonsillitis",
    parent_illness: "Tonsillitis",
    category: "ENT",
    direct_names: ["tonsillitis", "tonsillectomy", "tonsillitis & adenitis"],
    aliases: ["chronic tonsillitis", "tonsillar hypertrophy", "adenotonsillitis", "enlarged tonsils"],
    procedures: ["tonsillectomy", "adenoidectomy", "adenotonsillectomy"],
    sub_conditions: ["adenoiditis", "adenoids", "adenoid hypertrophy", "adenoiditis chronic"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Tonsillitis & Adenitis",
      "Optima Secure": "Tonsillitis",
      "Care Supreme": "Surgical treatments for Benign ear, nose and throat (ENT) disorders and surgeries",
      "Activ One Max": "Tonsillitis & Adenitis",
      "Aspire": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses",
      "Reassure 2.0": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses"
    }
  },
  {
    id: "otitis_media",
    parent_illness: "Otitis media",
    category: "ENT",
    direct_names: ["otitis media", "middle ear infection"],
    aliases: ["chronic otitis media", "tympanitis", "non-traumatic tympanic perforation", "glue ear", "chronic suppurative otitis media", "csom", "tympanic perforation"],
    procedures: ["tympanoplasty", "myringoplasty", "mastoidectomy", "grommet insertion", "myringotomy"],
    sub_conditions: ["mastoiditis", "cholesteatoma", "tympanoplasty", "mastoidectomy"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Otitis Media",
      // Verified against the actual Optima Secure policy wording
      // (2026-08-19): "Tympanoplasty, Mastoidectomy" and "Nasal concha
      // resection" are two separate schedule lines, not one combined phrase
      // — the nasal concha resection half now lives in its own catalog entry
      // below instead of being appended here.
      "Optima Secure": "Tympanoplasty, Mastoidectomy",
      "Care Supreme": "Surgical treatments for Benign ear, nose and throat (ENT) disorders and surgeries",
      "Activ One Max": "Otitis Media",
      "Aspire": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses",
      "Reassure 2.0": "Surgical treatment for diseases of middle ear and mastoid (including otitis media, cholesteatoma, perforation of tympanic membrane), Tonsils and adenoids, nasal septum and nasal sinuses"
    }
  },
  {
    // Added 2026-08-19, verified against the actual Optima Secure policy
    // wording — a standalone schedule line, distinct from otitis_media's
    // "Tympanoplasty, Mastoidectomy" line above (previously incorrectly
    // appended to it as one merged phrase). Only Optima Secure is populated
    // here since that's the only plan verified against a primary source so
    // far — add other plans' schedule text only once verified the same way.
    id: "nasal_concha_resection",
    parent_illness: "Nasal concha resection",
    category: "ENT",
    direct_names: ["nasal concha resection"],
    aliases: ["turbinate resection", "concha resection", "inferior turbinate resection"],
    procedures: ["turbinectomy", "submucous diathermy of turbinate"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Optima Secure": "Nasal concha resection"
    }
  },
  {
    id: "nasal_polyps",
    parent_illness: "Nasal polyps",
    category: "ENT",
    direct_names: ["nasal polyps", "nasal polyp"],
    aliases: ["nasal polypectomy", "sinonasal polyp", "ethmoidal polyp", "antrochoanal polyp"],
    procedures: ["nasal polypectomy", "polyp removal from nose"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Any swelling, tumour, cyst, nodule, ulcer, polyp Mass",
      "Optima Secure": "Nasal polypectomy",
      "Activ One Max": "Nasal polyps"
    }
  },

  // Gynaecology
  {
    id: "fibroids",
    parent_illness: "Fibroids / Fibromyoma",
    category: "Gynaecology",
    direct_names: ["fibroids", "fibromyoma", "uterine fibroids"],
    aliases: ["uterine fibroid", "leiomyoma", "myoma", "uterine leiomyomas", "myomas", "fibroid uterus"],
    procedures: ["myomectomy", "hysterectomy", "uterine artery embolization", "uae", "mrgfus"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Fibroids (Fibromyoma)",
      "Optima Secure": "Fibroids (fibromyoma)",
      "Care Supreme": "Hysterectomy for menorrhagia or Fibromyoma or prolapse of uterus",
      "Activ One Max": "Fibroids (Fibromyoma)",
      "Aspire": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)",
      "Reassure 2.0": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)"
    }
  },
  {
    // Added 2026-08-19, verified against the actual Optima Secure policy
    // wording — "Hysterectomy" is its own standalone schedule line there,
    // distinct from "Fibroids (fibromyoma)". Left deliberately narrow
    // (only Optima Secure populated): for Care Supreme, Aspire, and
    // Reassure 2.0, "hysterectomy" is genuinely bundled into their
    // fibroids/menorrhagia/prolapse wording already (see those plans'
    // schedule text on the `fibroids` entry below), so this entry must NOT
    // duplicate a plan_schedules value for them, or "hysterectomy" would
    // show two conflicting quoted lines for the same plan. `fibroids`
    // keeps its existing "hysterectomy" procedure mapping unchanged for
    // that reason — this entry only adds the missing Optima Secure line.
    id: "hysterectomy_standalone",
    parent_illness: "Hysterectomy",
    category: "Gynaecology",
    direct_names: ["hysterectomy"],
    aliases: ["total hysterectomy", "subtotal hysterectomy", "radical hysterectomy", "hysterectomy surgery"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Optima Secure": "Hysterectomy"
    }
  },
  {
    id: "pcod",
    parent_illness: "Polycystic ovarian disease",
    category: "Gynaecology",
    direct_names: ["polycystic ovarian disease", "pcod", "pcos"],
    aliases: ["polycystic ovary syndrome", "polycystic ovarian syndrome", "polycystic ovaries"],
    procedures: ["laparoscopic ovarian drilling", "lod", "ovarian wedge resection"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Polycystic Ovarian Disease",
      "Optima Secure": "Polycystic ovarian diseases",
      "Activ One Max": "Polycystic Ovarian Disease",
      "Aspire": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)",
      "Reassure 2.0": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)"
    }
  },
  {
    id: "endometriosis",
    parent_illness: "Endometriosis",
    category: "Gynaecology",
    direct_names: ["endometriosis"],
    aliases: ["endometrial growth outside uterus", "endometrial cyst", "endometriotic cyst", "ovarian endometrioma", "chocolate cyst of ovary"],
    procedures: ["endometriosis cyst ablation", "laparoscopy for chocolate cyst"],
    sub_conditions: ["adenomyosis", "adenomyoma"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Endometriosis",
      "Optima Secure": "Endometriosis",
      "Activ One Max": "Endometriosis",
      "Aspire": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)",
      "Reassure 2.0": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)"
    }
  },
  {
    id: "menorrhagia",
    parent_illness: "Menorrhagia / DUB",
    category: "Gynaecology",
    direct_names: ["menorrhagia", "dub", "dysfunctional uterine bleeding"],
    aliases: ["heavy periods", "abnormal uterine bleeding", "aub", "heavy menstrual bleeding", "metrorrhagia", "menometrorrhagia"],
    procedures: ["dilation and curettage", "d&c", "dandc", "endometrial ablation", "hysteroscopic transcervical resection of endometrium", "tcre"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Dysfunctional Uterine Bleeding (DUB)",
      "Optima Secure": "Dilatation and curettage (D&C)",
      // Verified 2026-08-19 against the Care Supreme policy PDF: "Dilatation
      // and Curettage" is its own numbered schedule item there, separate
      // from "Hysterectomy for menorrhagia or Fibromyoma or prolapse of
      // uterus" (which stays on `fibroids` / `uterine_prolapse` below,
      // unchanged — that text is correct for those). The previous entry
      // here mistakenly reused the hysterectomy line's text instead of D&C's.
      "Care Supreme": "Dilatation and Curettage",
      "Activ One Max": "Dysfunctional Uterine Bleeding (DUB)"
    }
  },
  {
    id: "uterine_prolapse",
    parent_illness: "Uterine prolapse",
    category: "Gynaecology",
    direct_names: ["uterine prolapse", "prolapsed uterus"],
    aliases: ["uterovaginal prolapse", "cystocele", "rectocele", "urethrocele", "pelvic organ prolapse", "vaginal prolapse"],
    procedures: ["hysterectomy for prolapse", "pelvic floor repair", "colporrhaphy", "sacrocolpopexy"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Uterine Prolapse",
      "Optima Secure": "Prolapsed Uterus",
      "Care Supreme": "Hysterectomy for menorrhagia or Fibromyoma or prolapse of uterus",
      "Activ One Max": "Uterine Prolapse",
      "Aspire": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)",
      "Reassure 2.0": "Prolapse uterus or cervix, endometriosis, Fibroids, Polycystic ovarian disease (PCOD), hysterectomy (unless necessitated by Malignancy)"
    }
  },
  {
    id: "pid_gyn",
    parent_illness: "Pelvic inflammatory disease",
    category: "Gynaecology",
    direct_names: ["pelvic inflammatory disease", "pid"],
    aliases: ["salpingitis", "pelvic infection", "oophoritis", "endometritis chronic", "tubo ovarian abscess"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Pelvic Inflammatory Disease",
      "Activ One Max": "Pelvic Inflammatory Disease"
    }
  },
  {
    id: "breast_lump",
    parent_illness: "Breast lumps (benign)",
    category: "Gynaecology",
    direct_names: ["breast lumps", "breast lump", "benign breast lump"],
    aliases: ["fibroadenoma", "breast cyst", "fibrocystic breast disease", "mammary dysplasia", "breast calcification", "adenofibroma"],
    procedures: ["lumpectomy", "excision of breast lump", "fibroadenoma excision", "breast biopsy", "microdochectomy"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Breast lumps (excluding Malignant)",
      "Optima Secure": "Benign tumors, cysts, nodules, polyps including breast lumps",
      "Care Supreme": "Internal tumours, skin tumours, cysts, nodules, polyps including breast lumps",
      "Activ One Max": "Breast lumps (excluding Malignant)"
    }
  },
  {
    id: "ovarian_cyst",
    parent_illness: "Ovarian cyst / benign tumour",
    category: "Gynaecology",
    direct_names: ["ovarian cyst", "ovarian tumor", "benign ovarian tumor"],
    aliases: ["dermoid cyst", "follicular cyst", "corpus luteum cyst", "ovarian cystadenoma", "mucinous cystadenoma"],
    procedures: ["ovarian cystectomy", "oophorectomy", "laparoscopy for ovarian cyst"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["ovarian cyst", "dermoid cyst", "follicular cyst", "ovary cyst", "theca lutein cyst"],
    plan_schedules: {
      // Verified 2026-08-19 against the source policy PDFs: neither Activ
      // Fit Preferred nor Activ One Max actually uses the phrase "Ovarian
      // cyst / benign tumour" anywhere — their Gynaecology sections list
      // "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids &
      // Benign Tumour of the female genito urinary system" as its own line
      // item, which is what this condition maps to for those two plans.
      "Activ Fit Preferred": "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system",
      "Optima Secure": "Surgery of Genito urinary system unless necessitated by Malignancy",
      // Verified 2026-08-19: Care Supreme's genito-urinary-surgery line
      // ("Surgery of Genito-urinary system unless necessitated by
      // malignancy") is the correct match for ovarian cysts, not the
      // internal/skin-tumour line (that text is already correctly used on
      // `breast_lump`, `skin_tumour`, and `any_cyst` below).
      "Care Supreme": "Surgery of Genito-urinary system unless necessitated by malignancy",
      "Activ One Max": "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system"
    }
  },

  // Urogenital
  {
    id: "urinary_stone",
    parent_illness: "Kidney / Urinary stones",
    category: "Urogenital",
    direct_names: ["kidney stones", "urinary stones", "renal calculus", "kidney / urinary stones"],
    aliases: ["nephrolithiasis", "ureterolithiasis", "bladder stone", "crystal in urine", "urinary calculi", "kidney stone", "ureteric stone", "ureteric calculus", "bladder calculus"],
    procedures: ["lithotripsy", "eswl", "pcnl", "urs", "ursl", "dj stenting", "retrograde intrarenal surgery", "rirs", "nephrolithotomy"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Stones in Urinary system (Stone in the Kidney, Ureter, Urinary Bladder)",
      "Optima Secure": "Calculus diseases of Urogenital system e.g. Kidneystone, Urinary Bladder Stone",
      "Care Supreme": "Kidney Stone/ Ureteric Stone/ Lithotripsy/ Gall Bladder Stone",
      "Activ One Max": "Stones in Urinary System (Stone in the Kidney, Ureter, Urinary Bladder)",
      "Aspire": "Pancreatitis and stones in biliary and urinary system",
      "Reassure 2.0": "Pancreatitis and stones in biliary and urinary system"
    }
  },
  {
    id: "bph",
    parent_illness: "Benign prostatic hypertrophy",
    category: "Urogenital",
    direct_names: ["benign prostatic hypertrophy", "bph"],
    aliases: ["bep", "enlarged prostate", "benign prostatic hyperplasia", "prostatomegaly", "adenoma of prostate", "prostate enlargement"],
    procedures: ["turp", "transurethral resection of prostate", "prostateectomy", "holep", "pax", "prostate surgery", "urolift"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)",
      "Optima Secure": "Benign Hyperplasia of Prostate",
      "Care Supreme": "Benign Prostatic Hypertrophy",
      "Activ One Max": "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)",
      "Aspire": "Hyperplasia of prostate, hydrocele and spermatocele",
      "Reassure 2.0": "Hyperplasia of prostate, hydrocele and spermatocele"
    }
  },
  {
    id: "hernia",
    parent_illness: "Hernia",
    category: "Urogenital",
    direct_names: ["hernia"],
    aliases: ["inguinal hernia", "umbilical hernia", "incisional hernia", "hiatal hernia", "femoral hernia", "epigastric hernia"],
    procedures: ["hernioplasty", "herniorrhaphy", "hernia repair", "herniotomy", "laparoscopic hernia repair"],
    sub_conditions: ["hydrocele", "hydrocoele"],
    is_broad_category: true,
    broad_category_terms: ["hernia", "hernioplasty", "herniorrhaphy", "hiatal", "inguinal", "umbilical", "incisional", "epigastric"],
    plan_schedules: {
      "Activ Fit Preferred": "Hernia, Hydrocele",
      // Verified against the actual Optima Secure policy wording
      // (2026-08-19): "Hernia" is its own standalone line there — Hydrocele
      // is bundled with Rectocele instead (see the new
      // "hydrocele_rectocele" entry below), not with Hernia. Hydrocele
      // itself stays a `sub_condition` above because that's still correct
      // for Activ Fit Preferred / Care Supreme / Activ One Max, where it
      // genuinely is bundled with Hernia in their own wording.
      "Optima Secure": "Hernia",
      "Care Supreme": "All types of Hernia & Hydrocele",
      "Activ One Max": "Hernia, Hydrocele",
      "Aspire": "Hernia of any site or type",
      "Reassure 2.0": "Hernia of any site or type"
    }
  },
  {
    // Added 2026-08-19, verified against the actual Optima Secure policy
    // wording — "Hydrocele/Rectocele" is its own standalone schedule line
    // there, separate from both Hernia and Prolapsed Uterus. Only Optima
    // Secure is populated: for the plans above, Hydrocele is already
    // correctly covered as a `hernia` sub_condition (their wording
    // genuinely bundles it with Hernia), so this entry must not also add a
    // conflicting plan_schedules value for them.
    id: "hydrocele_rectocele",
    parent_illness: "Hydrocele / Rectocele",
    category: "Urogenital",
    direct_names: ["hydrocele/rectocele"],
    aliases: ["hydrocele", "hydrocoele", "rectocele"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Optima Secure": "Hydrocele/Rectocele"
    }
  },
  {
    id: "varicocele",
    parent_illness: "Varicocele",
    category: "Urogenital",
    direct_names: ["varicocele"],
    aliases: ["varicocoele", "varicocele of testis", "spermatocele", "spermatocoele"],
    procedures: ["varicocelectomy", "spermatocelectomy"],
    sub_conditions: ["spermatocele", "spermatocoele"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Varicocoele / Spermatocoele",
      // Verified against the actual Optima Secure policy wording
      // (2026-08-19): "Varicocele" is its own standalone line — the
      // Hydrocele/Rectocele part belongs to the separate
      // "hydrocele_rectocele" entry above, not bundled with Varicocele.
      "Optima Secure": "Varicocele",
      "Activ One Max": "Varicocoele / Spermatocoele",
      "Aspire": "Hyperplasia of prostate, hydrocele and spermatocele",
      "Reassure 2.0": "Hyperplasia of prostate, hydrocele and spermatocele"
    }
  },

  // Skin
  {
    id: "skin_tumour",
    parent_illness: "Skin tumours (benign)",
    category: "Skin",
    direct_names: ["skin tumours", "skin tumour", "benign skin growth"],
    aliases: ["sebaceous cyst", "lipoma", "dermoid cyst", "epidermal cyst", "pilar cyst", "skin polyp", "seborrheic keratosis", "warts benign", "skin tag benign", "nevus", "benign skin tumor", "benign skin growth"],
    procedures: ["excision of cyst", "excision of lipoma", "skin tag removal", "cyst removal", "lipoma removal", "punch biopsy"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["sebaceous cyst", "lipoma", "skin growth", "skin tumour", "skin tumor", "epidermal cyst", "skin nodule"],
    plan_schedules: {
      "Activ Fit Preferred": "Skin tumour (unless malignant)",
      "Optima Secure": "Skin tumors",
      "Care Supreme": "Internal tumours, skin tumours, cysts, nodules, polyps",
      "Activ One Max": "Skin Tumour (unless malignant)",
      "Aspire": "All internal or external benign neoplasms/tumours, cyst, sinus, polyps, nodules, mass or lump",
      "Reassure 2.0": "All internal or external benign neoplasms/tumours, cyst, sinus, polyps, nodules, mass or lump"
    }
  },
  {
    id: "varicose_veins",
    parent_illness: "Varicose veins",
    category: "Skin",
    direct_names: ["varicose veins", "varicose ulcers"],
    aliases: ["venous insufficiency", "varicose ulcer", "varices", "chronic venous insufficiency", "spider veins", "varico phlebitis"],
    procedures: ["sclerotherapy", "evla", "endovenous laser ablation", "vein stripping", "varicose vein surgery", "radiofrequency ablation of veins"],
    sub_conditions: [],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Varicose veins, Varicose ulcers",
      "Optima Secure": "Surgery for varicose veins and varicose ulcers",
      "Care Supreme": "Varicose veins and varicose ulcers",
      "Activ One Max": "Varicose Veins, Varicose Ulcers",
      "Aspire": "Varicose veins of lower extremities",
      "Reassure 2.0": "Varicose veins of lower extremities"
    }
  },
  {
    id: "all_skin_diseases",
    parent_illness: "All skin diseases",
    category: "Skin",
    direct_names: ["all skin diseases"],
    aliases: ["psoriasis", "eczema", "dermatitis", "ichthyosis", "vitiligo", "skin disorder nos", "atopic dermatitis", "urticaria", "hives", "alopecia", "pemphigus", "lichen planus", "melasma"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["psoriasis", "eczema", "dermatitis", "vitiligo", "ichthyosis", "urticaria", "lichen planus", "pemphigus"],
    plan_schedules: {
      "Activ Fit Preferred": "All skin diseases",
      "Activ One Max": "All Skin Diseases"
    }
  },

  // Neurological
  {
    // Added 2026-08-19, verified against the Care Supreme policy PDF —
    // "Parkinson's or Alzheimer's disease or Dementia" is its own numbered
    // schedule item there. This is a genuinely new condition not covered by
    // any existing catalog entry, so it gets a new "Neurological" category
    // rather than being force-fit into an unrelated one. Only Care Supreme
    // is populated — none of the other verified plans list this separately.
    id: "parkinsons_alzheimers_dementia",
    parent_illness: "Parkinson's / Alzheimer's disease / Dementia",
    category: "Neurological",
    direct_names: ["parkinson's disease", "parkinsons disease", "alzheimer's disease", "alzheimers disease", "dementia"],
    aliases: ["parkinsonism", "alzheimer's", "alzheimers", "cognitive decline dementia", "senile dementia", "vascular dementia"],
    procedures: [],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["parkinson", "alzheimer", "dementia"],
    plan_schedules: {
      "Care Supreme": "Parkinson's or Alzheimer's disease or Dementia"
    }
  },

  // General / Benign tumours
  {
    id: "any_cyst",
    parent_illness: "Any cyst / nodule / polyp / benign tumour",
    category: "General / Benign tumours",
    direct_names: ["any cyst", "nodule", "polyp", "benign tumour"],
    aliases: ["lipoma", "sebaceous cyst", "benign swelling", "polyp nos", "nodule nos", "swelling nos", "granuloma", "benign tumor", "benign tumor anywhere", "cyst of body", "nodule of body", "lump benign"],
    procedures: ["excision of cyst", "polyp removal", "excision of swelling", "excision of tumor"],
    sub_conditions: [],
    is_broad_category: true,
    broad_category_terms: ["cyst", "nodule", "polyp", "tumor", "tumour", "swelling", "lump", "granuloma"],
    plan_schedules: {
      "Activ Fit Preferred": "Any swelling, tumour, cyst, nodule, ulcer, polyp Mass , Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (unless malignant)",
      "Optima Secure": "Benign tumors, cysts, nodules, polyps including breast lumps",
      "Care Supreme": "Internal tumours, skin tumours, cysts, nodules, polyps including breast lumps (each of any kind) unless malignant",
      "Activ One Max": "Any Swelling, Tumour, Cyst, Nodule, Ulcer, Polyp Mass, Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (Unless Malignant)",
      "Aspire": "All internal or external benign neoplasms/tumours, cyst, sinus, polyps, nodules, mass or lump",
      "Reassure 2.0": "All internal or external benign neoplasms/tumours, cyst, sinus, polyps, nodules, mass or lump"
    }
  }
];

/**
 * Standardizes general system plan names to the matching scope keys
 */
export function normalizePlanName(rawPlan: string): string {
  const normalized = rawPlan.toLowerCase();
  if (normalized.includes("optima") || normalized.includes("secure") || normalized.includes("hdfc")) {
    return "Optima Secure";
  }
  if (normalized.includes("care supreme") || normalized.includes("care health") || (normalized.includes("care") && !normalized.includes("secure"))) {
    return "Care Supreme";
  }
  if (normalized.includes("activ one") || normalized.includes("one max") || normalized.includes("aditya birla activ one")) {
    return "Activ One Max";
  }
  if (normalized.includes("activ fit") || normalized.includes("fit preferred") || normalized.includes("aditya birla activ fit")) {
    return "Activ Fit Preferred";
  }
  return rawPlan;
}

/**
 * Collapses hyphens/underscores/em-dashes into plain spaces and normalizes
 * whitespace, so "fistula-in-ano" and "fistula in ano" are treated as the
 * same phrase instead of requiring every hyphenated variant to be listed
 * out separately as its own alias.
 */
function collapseSeparators(text: string): string {
  return text.replace(/[-–—_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Crude, deliberately conservative English pluralization stripper — applied
 * identically to both sides of a comparison, so it only ever makes matching
 * MORE permissive (never changes whether two equal strings match). Fixes
 * the class of bug where a declared condition entered as a plural (e.g.
 * "Peptic Ulcers") failed to match a catalog entry stored in the singular
 * ("peptic ulcer"), or vice versa.
 *
 * Guards:
 * - Words of length <= 4 are left untouched, so short clinical abbreviations
 *   ("ra", "oa", "pcod", "copd") are never mangled.
 * - Words ending in "-itis" or "-sis" (gastritis, sinusitis, psoriasis,
 *   nephrolithiasis, ...) are left untouched — these are singular disease
 *   names that happen to end in "s", not plurals.
 */
function singularizeToken(token: string): string {
  if (token.length <= 4) return token;
  if (/(itis|sis)$/i.test(token)) return token;
  if (/[^aeiou]ies$/i.test(token)) return token.slice(0, -3) + "y";
  if (/(sses|shes|ches|xes)$/i.test(token)) return token.slice(0, -2);
  if (/s$/i.test(token) && !/ss$/i.test(token)) return token.slice(0, -1);
  return token;
}

function singularizeText(text: string): string {
  return text.replace(/[a-zA-Z]+/g, (word) => singularizeToken(word));
}

/**
 * Safely checks if a short term or phrase matches the declared condition fully (whole phrase/word boundary).
 * Prevents issues where short terms (like "oa" or "ra") or partial terms match inside unrelated words (like "throat" or "brain").
 *
 * Tolerant of: hyphen vs. space variants ("fistula-in-ano" == "fistula in ano")
 * and simple plural/singular mismatches ("peptic ulcers" == "peptic ulcer").
 */
export function matchesPhrase(input: string, phrase: string): boolean {
  const normInput = singularizeText(collapseSeparators(input.toLowerCase().trim()));
  const normPhrase = singularizeText(collapseSeparators(phrase.toLowerCase().trim()));
  if (normInput === normPhrase) return true;

  // Escape any regex characters
  const escaped = normPhrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${escaped}($|\\s|[^a-zA-Z0-9])`, "i");
  return regex.test(normInput);
}

/** A plan's DB-backed Specific Illness List, as fetched from /api/plan-configs
 * (`DbPlanConfigEntry` in src/types/plans.ts). Declared structurally here
 * (rather than importing that type) so this engine — which also runs
 * standalone in tests — has no dependency on the server/DB type module. */
export interface DbPlanSpecificIllnessConfig {
  planName: string;
  specificIllnesses?: IllnessOverrideRecord2[];
}
interface IllnessOverrideRecord2 {
  category?: string | null;
  illness: string;
}

/** True if a free-text illness label (from a plan's DB-backed Specific
 * Illness List) already refers to a catalog condition — i.e. it names the
 * same condition MASTER_ILLNESSES already knows under `parent_illness`, a
 * `direct_names` entry, or an `aliases` entry. Used to decide whether a DB
 * entry should extend an existing catalog match to a new plan, versus stand
 * on its own as a plan-specific custom illness the catalog doesn't have. */
function dbEntryMatchesCatalogDefinition(definition: MasterIllnessDefinition, illnessText: string): boolean {
  return (
    matchesPhrase(illnessText, definition.parent_illness) ||
    definition.direct_names.some((dn) => matchesPhrase(illnessText, dn)) ||
    definition.aliases.some((al) => matchesPhrase(illnessText, al))
  );
}

/**
 * Execution engine for specific illnesses matching ledger mapping.
 *
 * @param declaredPed The advisor-entered condition to check.
 * @param dbPlanConfigs Optional live, DB-backed Specific Illness Lists per
 *   plan (from /api/plan-configs). Additive on top of the hardcoded
 *   MASTER_ILLNESSES catalog below — never replaces it — in two ways:
 *   (1) a DB entry that names a condition the catalog already knows extends
 *   that catalog match's `plans_applicable` to the new plan; (2) a DB entry
 *   for a condition the catalog does NOT know produces its own "direct"
 *   match, sourced entirely from that plan's own admin-entered text.
 *   Callers that only care about the hardcoded catalog (e.g. tests) can
 *   omit this parameter entirely.
 */
export function matchSpecificIllness(
  declaredPed: string,
  dbPlanConfigs: DbPlanSpecificIllnessConfig[] = []
): SpecificIllnessMatchResult[] {
  const normalizedInput = singularizeText(collapseSeparators(declaredPed.toLowerCase().trim()));

  const results: SpecificIllnessMatchResult[] = [];

  // Dynamically load all plans in scope (default + dynamically created ones)
  let PLANS_IN_SCOPE = ["Optima Secure", "Care Supreme", "Activ One Max", "Activ Fit Preferred"];
  try {
    const savedProd = localStorage.getItem("ditto_production_plans");
    if (savedProd) {
      const arr = JSON.parse(savedProd);
      if (Array.isArray(arr) && arr.length > 0) {
        PLANS_IN_SCOPE = Array.from(new Set([...PLANS_IN_SCOPE, ...arr]));
      }
    }
    const savedDraft = localStorage.getItem("ditto_draft_plans");
    if (savedDraft) {
      const arr = JSON.parse(savedDraft) as Array<{ name: string }>;
      if (Array.isArray(arr)) {
        PLANS_IN_SCOPE = Array.from(new Set([...PLANS_IN_SCOPE, ...arr.map((d) => d.name)]));
      }
    }
  } catch (_) {}
  // Always include every plan that has its own DB-backed Specific Illness
  // List, even if it wasn't in the production/draft plan localStorage lists
  // above (e.g. Aspire, Reassure 2.0, or any newly added plan).
  dbPlanConfigs.forEach((cfg) => {
    if (cfg.specificIllnesses && cfg.specificIllnesses.length > 0 && !PLANS_IN_SCOPE.includes(cfg.planName)) {
      PLANS_IN_SCOPE.push(cfg.planName);
    }
  });

  // Load custom specific illness overrides
  let overridesMap: Record<string, IllnessOverrideRecord[]> = {};
  try {
    const existing = localStorage.getItem("ditto_plan_specific_illnesses");
    if (existing) {
      overridesMap = JSON.parse(existing);
    }
  } catch (_) {}

  const dbEntriesByPlan: Record<string, IllnessOverrideRecord2[]> = {};
  dbPlanConfigs.forEach((cfg) => {
    if (cfg.specificIllnesses && cfg.specificIllnesses.length > 0) {
      dbEntriesByPlan[cfg.planName] = cfg.specificIllnesses;
    }
  });

  for (const definition of MASTER_ILLNESSES) {
    // High-fidelity safeguard: "valve replacement", "cardiac valve", and "lens replacement" or "cataract" shouldn't map to orthopaedic Joint replacement
    if (definition.id === "joint_replacement") {
      const lower = normalizedInput.toLowerCase();
      if (lower.includes("valve") || lower.includes("lens") || lower.includes("cataract") || lower.includes("heart") || lower.includes("cardiac")) {
        continue;
      }
    }

    let matched = false;
    let matchType: SpecificIllnessMatchResult["match_type"] = "no_match";
    let confidence: SpecificIllnessMatchResult["confidence"] = "low";
    let notes = "";

    // 1. Direct match check
    const isDirectMain = definition.direct_names.some(
      dn => matchesPhrase(normalizedInput, dn)
    );
    if (isDirectMain) {
      matched = true;
      matchType = "direct";
      confidence = "high";
      notes = `Direct correlation to registered specific illness list: ${definition.parent_illness}.`;
    }

    // 2. Alias match check
    if (!matched) {
      const isAliasMatch = definition.aliases.some(
        al => matchesPhrase(normalizedInput, al)
      );
      if (isAliasMatch) {
         matched = true;
         matchType = "alias";
         confidence = "high";
         notes = `Alias match: "${declaredPed}" is a recognized synonym for ${definition.parent_illness}.`;
      }
    }

    // 3. Procedure mapping check
    if (!matched) {
      const isProcedureMatch = definition.procedures.some(
        proc => matchesPhrase(normalizedInput, proc)
      );
      if (isProcedureMatch) {
        matched = true;
        matchType = "procedure_mapped";
        confidence = "high";
        notes = `Procedure-to-diagnosis mapping: Undergoing or history of surgical/mechanical intervention "${declaredPed}" maps back to the root diagnosis of ${definition.parent_illness}.`;
      }
    }

    // 4. Sub-conditions mapping check
    if (!matched) {
      const isSubMatch = definition.sub_conditions.some(
        sub => matchesPhrase(normalizedInput, sub)
      );
      if (isSubMatch) {
        matched = true;
        matchType = "sub_condition";
        confidence = "medium";
        notes = `Sub-condition correlation: Registered as a recognized sub-type or clinical development of ${definition.parent_illness}.`;
      }
    }

    // 5. Broad category keyword mapping
    if (!matched && definition.is_broad_category && definition.broad_category_terms) {
      const matchesBroadKeyword = definition.broad_category_terms.some(term => {
        return matchesPhrase(normalizedInput, term);
      });
      if (matchesBroadKeyword) {
        matched = true;
        matchType = "broad_category";
        confidence = "medium";
        notes = `Broad category resolution: Triggered by general umbrella term keywords mapping to the ${definition.parent_illness} class.`;
      }
    }

    // If matched, filter which plans contain this specific illness in their exclusion schedules
    if (matched) {
      const plansApplicable = PLANS_IN_SCOPE.filter(plan => {
        // checks static map
        if (definition.plan_schedules[plan]) return true;
        // checks dynamic override map
        const planOverrides = overridesMap[plan];
        if (Array.isArray(planOverrides)) {
          const matchOverride = planOverrides.find((item) =>
            item.illnessId?.toLowerCase() === definition.id.toLowerCase() ||
            item.illnessId?.toLowerCase() === definition.parent_illness.toLowerCase()
          );
          if (matchOverride && matchOverride.scheduleText) {
            return true;
          }
        }
        // checks this plan's live, DB-backed Specific Illness List (Plan
        // Management's Plan-Specific Illness Manager) — an admin-added entry
        // whose free text names this same catalog condition confirms/extends
        // the catalog's coverage to this plan, even where plan_schedules
        // above has no hardcoded entry for it (e.g. Aspire, Reassure 2.0, or
        // any plan whose list has since been edited in the admin UI).
        const dbEntries = dbEntriesByPlan[plan];
        if (Array.isArray(dbEntries)) {
          const dbConfirms = dbEntries.some((entry) => dbEntryMatchesCatalogDefinition(definition, entry.illness));
          if (dbConfirms) return true;
        }
        return false;
      });

      // If the matched condition maps to a plan, record it
      if (plansApplicable.length > 0) {
        results.push({
          declared_condition: declaredPed,
          matched_listed_illness: definition.parent_illness,
          match_type: matchType,
          plans_applicable: plansApplicable,
          confidence,
          notes: notes || `Falls under ${definition.parent_illness} específica list.`
        });
      }
    }
  }

  // Fold in any DB-backed Specific Illness List entries that don't
  // correspond to a known MASTER_ILLNESSES catalog condition at all — a
  // plan-specific illness an admin has entered that the hardcoded catalog
  // simply doesn't have yet. Matched purely against its own free text
  // (direct name matching only — no alias/procedure/sub-condition expansion,
  // since none exists for admin-entered text), and clearly labeled as
  // sourced from the plan's own list rather than the master catalog.
  const customMatches = new Map<string, { illness: string; plans: Set<string> }>();
  Object.entries(dbEntriesByPlan).forEach(([plan, entries]) => {
    entries.forEach((entry) => {
      const illnessText = entry.illness?.trim();
      if (!illnessText) return;
      const isKnownCatalogIllness = MASTER_ILLNESSES.some((def) => dbEntryMatchesCatalogDefinition(def, illnessText));
      if (isKnownCatalogIllness) return; // already handled via plansApplicable extension above
      if (!matchesPhrase(normalizedInput, illnessText)) return;
      const key = illnessText.toLowerCase();
      if (!customMatches.has(key)) {
        customMatches.set(key, { illness: illnessText, plans: new Set() });
      }
      customMatches.get(key)!.plans.add(plan);
    });
  });
  customMatches.forEach(({ illness, plans }) => {
    results.push({
      declared_condition: declaredPed,
      matched_listed_illness: illness,
      match_type: "direct",
      plans_applicable: Array.from(plans),
      confidence: "medium",
      notes: `Matched against ${plans.size > 1 ? "these plans'" : "this plan's"} own Specific Illness List entry (admin-managed, not yet in the master catalog): "${illness}".`
    });
  });

  // If we have matches, return them. If empty, return standard "no match"
  if (results.length > 0) {
    return results;
  }

  return [
    {
      declared_condition: declaredPed,
      matched_listed_illness: null,
      match_type: "no_match",
      plans_applicable: [],
      confidence: "high",
      notes: "Not found in any specific illness schedule. Standard 36-month non-specific waiting limits apply instead."
    }
  ];
}
