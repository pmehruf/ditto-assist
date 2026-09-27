/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types/constants for Special Instructions — split out of
 * SpecialInstructionFormModal.tsx (2026-09) purely so that component file
 * only exports the component itself (Fast Refresh's react-refresh/only-
 * export-components rule: a file mixing component + constant exports loses
 * hot-reload isolation). Consumed by both SpecialInstructions.tsx (Knowledge
 * Base > Special Instructions) and SpecialInstructionFormModal.tsx / its
 * callers (e.g. ProductAssistQuotaPage.tsx's Unresolved Queries "Resolve"
 * flow).
 */

export type InstructionType = "override_rule" | "additional_information" | "general_instruction";

export interface KbCategoryLite {
  id: number;
  name: string;
  type: "insurer" | "general" | "fundamentals";
  planNames: string[];
}

export interface SpecialInstructionEntry {
  id: number;
  topic: string;
  instructionText: string;
  instructionType: InstructionType;
  insurerCategoryId: number | null;
  productPlanName: string | null;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export const INSTRUCTION_TYPE_OPTIONS: { value: InstructionType; label: string }[] = [
  { value: "override_rule", label: "Override Rule" },
  { value: "additional_information", label: "Additional Information" },
  { value: "general_instruction", label: "General Instruction" },
];
export const INSTRUCTION_TYPE_LABEL: Record<InstructionType, string> = Object.fromEntries(
  INSTRUCTION_TYPE_OPTIONS.map(o => [o.value, o.label])
) as Record<InstructionType, string>;

export interface SpecialInstructionFormState {
  id: number | null;
  topic: string;
  instructionText: string;
  instructionType: InstructionType;
  insurerCategoryId: string; // "" = none
  productPlanName: string;
}

export const EMPTY_SPECIAL_INSTRUCTION_FORM: SpecialInstructionFormState = {
  id: null,
  topic: "",
  instructionText: "",
  instructionType: "override_rule",
  insurerCategoryId: "",
  productPlanName: "",
};
