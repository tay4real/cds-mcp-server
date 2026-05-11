import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirClientInstance } from "../fhir-client";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { fhirR4 } from "@smile-cdr/fhirts";

const RULES = [
  {
    drug: "metformin",
    condition: "chronic kidney",
    severity: "HIGH",
    note: "Metformin contraindicated when eGFR < 30 — lactic acidosis risk. Use with caution eGFR 30-45.",
  },
  {
    drug: "metformin",
    condition: "heart failure",
    severity: "HIGH",
    note: "Metformin contraindicated in decompensated heart failure (NYHA III-IV).",
  },
  {
    drug: "ibuprofen",
    condition: "chronic kidney",
    severity: "HIGH",
    note: "NSAIDs reduce renal blood flow — contraindicated in CKD stage 3+. Use acetaminophen.",
  },
  {
    drug: "ibuprofen",
    condition: "peptic ulcer",
    severity: "HIGH",
    note: "NSAIDs contraindicated in active peptic ulcer disease.",
  },
  {
    drug: "ibuprofen",
    condition: "heart failure",
    severity: "HIGH",
    note: "NSAIDs cause sodium retention worsening heart failure. Use acetaminophen.",
  },
  {
    drug: "naproxen",
    condition: "chronic kidney",
    severity: "HIGH",
    note: "NSAIDs contraindicated in CKD stage 3+.",
  },
  {
    drug: "naproxen",
    condition: "peptic ulcer",
    severity: "HIGH",
    note: "NSAIDs contraindicated in active peptic ulcer disease.",
  },
  {
    drug: "lisinopril",
    condition: "pregnancy",
    severity: "CRITICAL",
    note: "ACE inhibitors absolutely contraindicated in pregnancy — fetal renal toxicity.",
  },
  {
    drug: "lisinopril",
    condition: "angioedema",
    severity: "HIGH",
    note: "History of ACE inhibitor-induced angioedema: absolute contraindication.",
  },
  {
    drug: "warfarin",
    condition: "pregnancy",
    severity: "CRITICAL",
    note: "Warfarin is a teratogen — contraindicated in pregnancy.",
  },
  {
    drug: "beta blocker",
    condition: "asthma",
    severity: "HIGH",
    note: "Non-selective beta blockers contraindicated in asthma. Cardioselective only with specialist guidance.",
  },
  {
    drug: "propranolol",
    condition: "asthma",
    severity: "HIGH",
    note: "Propranolol (non-selective beta blocker) contraindicated in asthma.",
  },
  {
    drug: "methotrexate",
    condition: "renal impairment",
    severity: "HIGH",
    note: "Methotrexate requires dose reduction in renal impairment; toxicity risk.",
  },
  {
    drug: "spironolactone",
    condition: "hyperkalemia",
    severity: "HIGH",
    note: "Spironolactone contraindicated in hyperkalemia — potassium-sparing diuretic.",
  },
];

class CheckContraindicationsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "CheckContraindications",
      {
        description:
          "Checks a patient's active medications against their active diagnoses for known contraindications. Flags dangerous drug-disease combinations with severity ratings and clinical guidance. Uses FHIR MedicationRequest and Condition resources via SHARP context.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. Optional if patient context already exists.",
            )
            .optional(),
          proposedDrug: z
            .string()
            .describe(
              "A newly proposed drug name to check against existing diagnoses before prescribing.",
            )
            .optional(),
        },
      },
      async ({ patientId, proposedDrug }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        const [medsBundle, condBundle] = await Promise.all([
          FhirClientInstance.search(req, "MedicationRequest", [
            `patient=${patientId}`,
            "status=active",
            "_count=50",
          ]),
          FhirClientInstance.search(req, "Condition", [
            `patient=${patientId}`,
            "clinical-status=active",
            "_count=50",
          ]),
        ]);

        const medNames: string[] = (medsBundle?.entry || [])
          .filter((e) => !!e.resource)
          .map((e) => {
            const med = e.resource as fhirR4.MedicationRequest;
            return (
              med.medicationCodeableConcept?.text ||
              med.medicationCodeableConcept?.coding?.[0]?.display ||
              "Unknown"
            );
          });

        if (proposedDrug) medNames.push(proposedDrug);

        const conditionNames: string[] = (condBundle?.entry || [])
          .filter((e) => !!e.resource)
          .map((e) => {
            const cond = e.resource as fhirR4.Condition;
            return (
              cond.code?.text || cond.code?.coding?.[0]?.display || "Unknown"
            );
          });

        const alerts: object[] = [];
        for (const rule of RULES) {
          const hasDrug = medNames.some((m) =>
            m.toLowerCase().includes(rule.drug),
          );
          const hasCond = conditionNames.some((c) =>
            c.toLowerCase().includes(rule.condition),
          );
          if (hasDrug && hasCond) {
            alerts.push({
              severity: rule.severity,
              drug: rule.drug,
              condition: rule.condition,
              clinical_note: rule.note,
            });
          }
        }

        const order: Record<string, number> = {
          CRITICAL: 0,
          HIGH: 1,
          MODERATE: 2,
        };
        alerts.sort(
          (a: any, b: any) =>
            (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
        );

        const result = {
          patient_id: patientId,
          medications_screened: medNames,
          active_conditions: conditionNames,
          contraindications_found: alerts.length,
          contraindications: alerts,
          disclaimer:
            "Rule-based contraindication engine. Clinical context may modify recommendations.",
        };

        return McpUtilities.createTextResponse(JSON.stringify(result, null, 2));
      },
    );
  }
}

export const CheckContraindicationsToolInstance =
  new CheckContraindicationsTool();
