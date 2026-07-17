# Declaration Assistant

A production-oriented medical condition mapping engine designed to improve the consistency and accuracy of insurance pre-existing disease (PED) declarations.

The project helps map customer-reported medical conditions to the appropriate declaration questions across multiple insurance products using a rule-based architecture, structured medical taxonomy, and AI-assisted decision support.

---

## Overview

Declaration Assistant standardizes medical terminology and intelligently routes conditions through a governed mapping engine instead of relying on simple keyword matching.

The system is designed to:

- Standardize medical conditions and procedures
- Handle synonyms, abbreviations and acronyms
- Preserve production mapping logic
- Reduce false-positive and false-negative declarations
- Improve advisor consistency
- Support multiple insurance products with plan-specific logic

---

## Key Features

- Medical condition normalization
- PED synonym & acronym handling
- Rule-based declaration hierarchy
- Plan-specific declaration mapping
- Zero-regression integration philosophy
- Collision detection
- Production-safe mapping workflow
- AI-assisted condition integration
- Search optimization for advisor workflows

---

## Declaration Engine Philosophy

The engine follows a strict declaration hierarchy:

```
Condition
      │
      ▼
P0 – Direct Question Match
      │
      ▼
P1 – Organ/System Match
      │
      ▼
P2 – Umbrella Declaration
      │
      ▼
P3 – Fallback
```

Key principles:

- Underwriting wording takes precedence over medical similarity.
- Specific declaration questions override generic questions.
- Existing production mappings are never modified unless explicitly approved.
- Fallback is preferred over speculative mapping.

---

## Architecture

```
Medical Condition
        │
        ▼
Normalization
        │
        ▼
Clinical Classification
        │
        ▼
Declaration Hierarchy
        │
        ▼
Plan-Specific Mapping
        │
        ▼
Collision Validation
        │
        ▼
Recommendation Engine
```

---

## Technologies

- TypeScript
- React
- Vite
- Google AI Studio (Gemini)
- Rule-based Mapping Engine
- JSON Knowledge Base

---

## Project Goals

- Improve declaration accuracy
- Reduce manual advisor effort
- Minimize mapping inconsistencies
- Standardize medical terminology
- Enable safe expansion of new conditions
- Preserve backward compatibility

---

## Future Roadmap

- Expanded PED knowledge base
- Advanced synonym engine
- Automated regression validation
- Medical ontology improvements
- AI-assisted mapping suggestions
- Fuzzy search improvements
- Mapping audit dashboard

---

## Disclaimer

This project is intended as a decision-support system for insurance declaration workflows.

It is **not** a diagnostic or clinical decision-making tool and should not be used for medical advice.

Final underwriting decisions should always follow insurer guidelines and applicable policy wording.

---

## License

This repository is provided for educational and portfolio purposes unless otherwise specified.
