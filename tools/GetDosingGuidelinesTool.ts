import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { McpUtilities } from "../mcp-utilities";

const RENAL_RULES: {
  drug: string;
  rules: { below: number; action: string; note: string }[];
}[] = [
  {
    drug: "metformin",
    rules: [
      { below: 30, action: "CONTRAINDICATED", note: "Metformin contraindicated when eGFR < 30 — lactic acidosis risk. Discontinue immediately." },
      { below: 45, action: "REDUCE_DOSE", note: "Use with caution when eGFR 30-45. Reduce dose by 50%; monitor renal function every 3-6 months." },
    ],
  },
  {
    drug: "gabapentin",
    rules: [
      { below: 15, action: "CONTRAINDICATED", note: "Gabapentin contraindicated in end-stage renal disease without dialysis guidance." },
      { below: 30, action: "REDUCE_DOSE", note: "Reduce gabapentin to max 300mg/day when eGFR < 30." },
      { below: 60, action: "REDUCE_DOSE", note: "Reduce gabapentin dose by 50% when eGFR 30-60." },
    ],
  },
  {
    drug: "digoxin",
    rules: [
      { below: 30, action: "REDUCE_DOSE", note: "Reduce digoxin dose significantly. Target serum levels 0.5-0.9 ng/mL. Monitor levels closely." },
    ],
  },
  {
    drug: "ciprofloxacin",
    rules: [
      { below: 30, action: "REDUCE_DOSE", note: "Reduce ciprofloxacin dose by 50% when eGFR < 30." },
    ],
  },
  {
    drug: "lisinopril",
    rules: [
      { below: 10, action: "USE_WITH_CAUTION", note: "Use ACE inhibitors with extreme caution in severe renal impairment. Monitor K+ and creatinine closely." },
    ],
  },
  {
    drug: "allopurinol",
    rules: [
      { below: 20, action: "REDUCE_DOSE", note: "Reduce allopurinol to max 100mg/day when eGFR < 20." },
      { below: 60, action: "REDUCE_DOSE", note: "Reduce allopurinol dose proportional to eGFR decline." },
    ],
  },
  {
    drug: "spironolactone",
    rules: [
      { below: 30, action: "CONTRAINDICATED", note: "Spironolactone contraindicated when eGFR < 30 — hyperkalemia risk." },
    ],
  },
  {
    drug: "atenolol",
    rules: [
      { below: 15, action: "REDUCE_DOSE", note: "Reduce atenolol dose by 50% when eGFR < 15." },
      { below: 35, action: "REDUCE_DOSE", note: "Reduce atenolol dose by 50% when eGFR 15-35." },
    ],
  },
];

class GetDosingGuidelinesTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetDosingGuidelines",
      {
        description:
          "Gets renal-adjusted dosing recommendations for a specific drug based on the patient's eGFR (kidney function). Critical for patients with chronic kidney disease — 20% of hospitalized patients require dose modifications. Provide the drug name and eGFR value.",
        inputSchema: {
          drugName: z
            .string()
            .describe("Name of the drug to get dosing guidance for. E.g. metformin, gabapentin, digoxin."),
          egfr: z
            .number()
            .describe("Patient eGFR in mL/min/1.73m². Normal is > 60. CKD stage 3a is 45-59, stage 3b is 30-44, stage 4 is 15-29, stage 5 is < 15."),
          weightKg: z
            .number()
            .describe("Patient weight in kg. Used for weight-based dosing calculations.")
            .optional(),
        },
      },
      async ({ drugName, egfr, weightKg }) => {
        const drugLower = drugName.toLowerCase();
        const entry = RENAL_RULES.find((r) => drugLower.includes(r.drug));

        let recommendation: { action: string; note: string } = {
          action: "NO_ADJUSTMENT_REQUIRED",
          note: `No renal dose adjustment identified for ${drugName} at eGFR ${egfr} mL/min/1.73m². Standard dosing applies. Always verify with current formulary.`,
        };

        if (entry) {
          for (const rule of entry.rules) {
            if (egfr < rule.below) {
              recommendation = { action: rule.action, note: rule.note };
              break;
            }
          }
        }

        // eGFR staging
        let ckdStage = "Normal (eGFR ≥ 60)";
        if (egfr < 15) ckdStage = "CKD Stage 5 — Kidney Failure (eGFR < 15)";
        else if (egfr < 30) ckdStage = "CKD Stage 4 — Severe (eGFR 15-29)";
        else if (egfr < 45) ckdStage = "CKD Stage 3b — Moderate-Severe (eGFR 30-44)";
        else if (egfr < 60) ckdStage = "CKD Stage 3a — Moderate (eGFR 45-59)";

        const result: Record<string, unknown> = {
          drug: drugName,
          egfr_provided: egfr,
          ckd_stage: ckdStage,
          action: recommendation.action,
          guidance: recommendation.note,
          disclaimer: "Dosing guidance is for reference only. Verify with current formulary, renal pharmacist, and clinical context.",
        };

        if (weightKg) {
          result.weight_kg = weightKg;
        }

        return McpUtilities.createTextResponse(JSON.stringify(result, null, 2));
      },
    );
  }
}

export const GetDosingGuidelinesToolInstance = new GetDosingGuidelinesTool();
