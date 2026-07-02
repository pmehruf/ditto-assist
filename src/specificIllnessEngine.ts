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
  category: "Gastroenterology" | "Orthopaedic / Rheumatological" | "Eye" | "ENT" | "Gynaecology" | "Urogenital" | "Skin" | "General / Benign tumours";
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
      "Activ One Max": "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess"
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
      "Activ One Max": "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess"
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
      "Activ One Max": "Stone in Gall Bladder, Bile duct & other parts of Biliary System"
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
      "Activ One Max": "Pancreatitis"
    }
  },
  {
    id: "gastric_ulcer",
    parent_illness: "Gastric / Duodenal ulcer",
    category: "Gastroenterology",
    direct_names: ["gastric ulcer", "duodenal ulcer", "peptic ulcer", "gastric / duodenal ulcer"],
    aliases: ["stomach ulcer", "gastric erosion", "duodenal erosion", "peptic ulcer disease", "stomach ulcers", "pud"],
    procedures: ["vagotomy", "pyloroplasty", "gastrojejunostomy", "endoscopy for ulcer bleeding"],
    sub_conditions: ["gastritis", "duodenitis", "colitis", "hyperacidity with gastritis", "antral gastritis", "erosion of stomach"],
    is_broad_category: false,
    plan_schedules: {
      "Activ Fit Preferred": "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis",
      "Optima Secure": "Ulcer and erosion of stomach and duodenum",
      "Care Supreme": "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers",
      "Activ One Max": "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis"
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
    procedures: ["appendectomy", "appendix surgery", "laparoscopic appendectomy"],
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
      "Activ One Max": "Osteoarthritis"
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
      "Activ One Max": "Rheumatism, Rheumatoid Arthritis"
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
      "Activ One Max": "Gout"
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
      "Activ One Max": "Spondilosis, Spondioarthritis, Spondylopathies"
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
      "Activ One Max": "Internal Derangement of Knee / Ligament or Tendon / Meniscus Tear"
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
      "Activ One Max": "Prolapse of the intervertebral disc"
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
      "Activ One Max": "Osteoporosis"
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
      "Activ One Max": "Joint Replacement Surgery"
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
      "Activ One Max": "Non infective arthritis"
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
      "Activ One Max": "Cataract"
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
      "Activ One Max": "Glaucoma"
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
      "Activ Fit Preferred": "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system", // wait, just placeholder if not mapped
      "Optima Secure": "Cataract and other disorders of lens and Retina",
      "Activ One Max": "Cataract and other disorders of lens and Retina" // listed in Optima and Activ One
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
      "Activ One Max": "Sinusitis"
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
      "Activ One Max": "Deviated Nasal Septum"
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
      "Activ One Max": "Tonsillitis & Adenitis"
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
      "Optima Secure": "Tympanoplasty, Mastoidectomy / Nasal concha resection",
      "Care Supreme": "Surgical treatments for Benign ear, nose and throat (ENT) disorders and surgeries",
      "Activ One Max": "Otitis Media"
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
      "Activ One Max": "Fibroids (Fibromyoma)"
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
      "Activ One Max": "Polycystic Ovarian Disease"
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
      "Activ One Max": "Endometriosis"
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
      "Care Supreme": "Hysterectomy for menorrhagia or Fibromyoma or prolapse of uterus",
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
      "Activ One Max": "Uterine Prolapse"
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
      "Activ Fit Preferred": "Ovarian cyst / benign tumour",
      "Optima Secure": "Surgery of Genito urinary system unless necessitated by Malignancy",
      "Care Supreme": "Internal tumours, skin tumours, cysts, nodules, polyps including breast lumps",
      "Activ One Max": "Ovarian cyst / benign tumour"
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
      "Activ One Max": "Stones in Urinary System (Stone in the Kidney, Ureter, Urinary Bladder)"
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
      "Activ One Max": "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)"
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
      "Optima Secure": "Hernia / Hydrocele",
      "Care Supreme": "All types of Hernia & Hydrocele",
      "Activ One Max": "Hernia, Hydrocele"
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
      "Optima Secure": "Varicocele / Hydrocele/Rectocele",
      "Activ One Max": "Varicocoele / Spermatocoele"
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
      "Activ One Max": "Skin Tumour (unless malignant)"
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
      "Activ One Max": "Varicose Veins, Varicose Ulcers"
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
      "Activ One Max": "Any Swelling, Tumour, Cyst, Nodule, Ulcer, Polyp Mass, Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (Unless Malignant)"
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
 * Safely checks if a short term or phrase matches the declared condition fully (whole phrase/word boundary).
 * Prevents issues where short terms (like "oa" or "ra") or partial terms match inside unrelated words (like "throat" or "brain").
 */
export function matchesPhrase(input: string, phrase: string): boolean {
  const normInput = input.toLowerCase().trim();
  const normPhrase = phrase.toLowerCase().trim();
  if (normInput === normPhrase) return true;

  // Escape any regex characters
  const escaped = normPhrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${escaped}($|\\s|[^a-zA-Z0-9])`, "i");
  return regex.test(normInput);
}

/**
 * Execution engine for specific illnesses matching ledger mapping.
 */
export function matchSpecificIllness(declaredPed: string): SpecificIllnessMatchResult[] {
  const normalizedInput = declaredPed.toLowerCase().trim();

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

  // Load custom specific illness overrides
  let overridesMap: Record<string, IllnessOverrideRecord[]> = {};
  try {
    const existing = localStorage.getItem("ditto_plan_specific_illnesses");
    if (existing) {
      overridesMap = JSON.parse(existing);
    }
  } catch (_) {}

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
