import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirClientInstance } from "../fhir-client";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { fhirR4 } from "@smile-cdr/fhirts";

const INTERACTIONS: [string, string, string, string, string][] = [
  ["warfarin", "ibuprofen", "HIGH", "NSAIDs displace warfarin from protein binding and inhibit platelet function", "Avoid combination — use acetaminophen instead."],
  ["warfarin", "aspirin", "HIGH", "Additive anticoagulant and antiplatelet effect", "Monitor INR closely; risk of major bleeding."],
  ["warfarin", "naproxen", "HIGH", "NSAID increases bleeding risk", "Avoid; monitor INR if unavoidable."],
  ["warfarin", "fluconazole", "HIGH", "CYP2C9 inhibition increases warfarin levels", "Reduce warfarin dose; daily INR monitoring."],
  ["warfarin", "amiodarone", "HIGH", "CYP2C9/CYP3A4 inhibition significantly increases warfarin effect", "Reduce warfarin dose 30-50%; weekly INR monitoring."],
  ["maoi", "sertraline", "CRITICAL", "Serotonin syndrome — potentially fatal", "Absolute contraindication; 14-day washout required."],
  ["maoi", "fluoxetine", "CRITICAL", "Serotonin syndrome; fluoxetine has 5-week half-life", "Absolute contraindication; 5-week washout required."],
  ["maoi", "tramadol", "CRITICAL", "Serotonin syndrome risk", "Absolute contraindication."],
  ["ssri", "tramadol", "HIGH", "Serotonin syndrome risk via serotonergic activity", "Avoid combination; use alternative analgesia."],
  ["simvastatin", "amiodarone", "HIGH", "CYP3A4 inhibition raises statin levels — myopathy/rhabdomyolysis risk", "Do not exceed simvastatin 20mg; consider alternative statin."],
  ["clopidogrel", "omeprazole", "MODERATE", "CYP2C19 inhibition reduces clopidogrel antiplatelet activation", "Use pantoprazole instead of omeprazole."],
  ["sildenafil", "nitroglycerin", "CRITICAL", "Severe synergistic hypotension — potentially fatal", "Absolute contraindication."],
  ["methotrexate", "ibuprofen", "HIGH", "NSAIDs reduce renal methotrexate clearance — toxicity risk", "Avoid combination; monitor renal function and CBC."],
  ["lithium", "ibuprofen", "HIGH", "NSAIDs reduce renal lithium clearance — toxicity risk", "Avoid NSAIDs; use acetaminophen."],
  ["digoxin", "amiodarone", "HIGH", "P-glycoprotein inhibition increases digoxin levels", "Reduce digoxin dose by 50%; monitor serum levels."],
];

class CheckDrugInteractionsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "CheckDrugInteractions",
      {
        description:
          "Screens a patient's active medication list for clinically significant drug-drug interactions. Returns severity-ranked alerts (CRITICAL, HIGH, MODERATE) with mechanism and clinical recommendations. Uses FHIR MedicationRequest resources via SHARP context.",
        inputSchema: {
          patientId: z
            .string()
            .describe("The id of the patient. Optional if patient context already exists.")
            .optional(),
          additionalDrugs: z
            .array(z.string())
            .describe("Extra drug names to include in the check — e.g. a newly proposed medication not yet in FHIR.")
            .optional(),
        },
      },
      async ({ patientId, additionalDrugs = [] }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        // Fetch active medications from FHIR
        let fhirMedNames: string[] = [];
        try {
          const bundle = await FhirClientInstance.search(req, "MedicationRequest", [
            `patient=${patientId}`,
            "status=active",
            "_count=50",
          ]);

          fhirMedNames = (bundle?.entry || [])
            .filter((e) => !!e.resource)
            .map((e) => {
              const med = e.resource as fhirR4.MedicationRequest;
              return (
                med.medicationCodeableConcept?.text ||
                med.medicationCodeableConcept?.coding?.[0]?.display ||
                "Unknown"
              );
            });
        } catch {
          fhirMedNames = [];
        }

        const allMeds = [...new Set([...fhirMedNames, ...additionalDrugs])];
        if (allMeds.length < 2) {
          return McpUtilities.createTextResponse(
            JSON.stringify({
              patient_id: patientId,
              medications_checked: allMeds,
              interactions_found: 0,
              message: "Fewer than 2 medications found — no interaction check needed.",
            }, null, 2)
          );
        }

        const normalized = allMeds.map((m) => m.toLowerCase());
        const found: object[] = [];

        for (const [a, b, severity, mechanism, recommendation] of INTERACTIONS) {
          const hasA = normalized.some((n) => n.includes(a));
          const hasB = normalized.some((n) => n.includes(b));
          if (hasA && hasB) {
            found.push({ severity, drugs: `${a} + ${b}`, mechanism, recommendation });
          }
        }

        const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };
        found.sort((a: any, b: any) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

        const result = {
          patient_id: patientId,
          medications_checked: allMeds,
          interactions_found: found.length,
          critical_count: found.filter((f: any) => f.severity === "CRITICAL").length,
          high_count: found.filter((f: any) => f.severity === "HIGH").length,
          interactions: found,
          disclaimer: "This tool supports clinical decision-making and does not replace clinical judgment.",
        };

        return McpUtilities.createTextResponse(JSON.stringify(result, null, 2));
      },
    );
  }
}

export const CheckDrugInteractionsToolInstance = new CheckDrugInteractionsTool();
