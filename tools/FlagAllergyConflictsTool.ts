import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirClientInstance } from "../fhir-client";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { fhirR4 } from "@smile-cdr/fhirts";

const CROSS_REACTIVITY_GROUPS = [
  { group: "penicillin", members: ["penicillin", "amoxicillin", "ampicillin", "piperacillin", "oxacillin"] },
  { group: "cephalosporin", members: ["cephalexin", "cefazolin", "ceftriaxone", "cefdinir", "cephalosporin"] },
  { group: "sulfonamide", members: ["sulfamethoxazole", "trimethoprim", "sulfa", "sulfadiazine"] },
  { group: "nsaid", members: ["ibuprofen", "naproxen", "aspirin", "ketorolac", "diclofenac"] },
  { group: "quinolone", members: ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin"] },
];

class FlagAllergyConflictsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "FlagAllergyConflicts",
      {
        description:
          "Detects direct allergy conflicts and cross-reactive allergy risks between a patient's documented allergies and their current or proposed medications. Returns CRITICAL alerts for direct matches and MODERATE alerts for class cross-reactivity. Uses FHIR AllergyIntolerance and MedicationRequest resources via SHARP context.",
        inputSchema: {
          patientId: z
            .string()
            .describe("The id of the patient. Optional if patient context already exists.")
            .optional(),
          proposedDrug: z
            .string()
            .describe("A new drug being considered — checked against the patient's documented allergies before prescribing.")
            .optional(),
        },
      },
      async ({ patientId, proposedDrug }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        const [medsBundle, allergyBundle] = await Promise.all([
          FhirClientInstance.search(req, "MedicationRequest", [
            `patient=${patientId}`,
            "status=active",
            "_count=50",
          ]),
          FhirClientInstance.search(req, "AllergyIntolerance", [
            `patient=${patientId}`,
            "_count=50",
          ]),
        ]);

        const medNames: string[] = (medsBundle?.entry || [])
          .filter((e) => !!e.resource)
          .map((e) => {
            const med = e.resource as fhirR4.MedicationRequest;
            return med.medicationCodeableConcept?.text ||
              med.medicationCodeableConcept?.coding?.[0]?.display || "Unknown";
          });

        if (proposedDrug) medNames.push(proposedDrug);

        const allergySubstances: string[] = (allergyBundle?.entry || [])
          .filter((e) => !!e.resource)
          .map((e) => {
            const al = e.resource as fhirR4.AllergyIntolerance;
            return al.code?.text || al.code?.coding?.[0]?.display || "Unknown";
          });

        const directConflicts: object[] = [];
        const crossReactiveRisks: object[] = [];

        for (const med of medNames) {
          const medLower = med.toLowerCase();

          // Direct match
          for (const allergen of allergySubstances) {
            if (
              medLower.includes(allergen.toLowerCase()) ||
              allergen.toLowerCase().includes(medLower.split(" ")[0])
            ) {
              directConflicts.push({
                severity: "CRITICAL",
                type: "DIRECT_ALLERGY_MATCH",
                drug: med,
                allergen,
                action: `STOP — patient has documented allergy to "${allergen}". Do not administer ${med}.`,
              });
            }
          }

          // Cross-reactivity
          for (const { group, members } of CROSS_REACTIVITY_GROUPS) {
            const drugInGroup = members.some((m) => medLower.includes(m));
            if (!drugInGroup) continue;

            for (const allergen of allergySubstances) {
              const allergenLower = allergen.toLowerCase();
              const allergyInGroup = members.some((m) => allergenLower.includes(m));
              const isDirect = medLower.includes(allergenLower) || allergenLower.includes(medLower.split(" ")[0]);

              if (allergyInGroup && !isDirect) {
                crossReactiveRisks.push({
                  severity: "MODERATE",
                  type: "CROSS_REACTIVE",
                  drug: med,
                  allergen,
                  drug_class: group,
                  note: `Both ${med} and the known allergen "${allergen}" belong to the ${group} class. Cross-reactivity is possible — verify with prescriber before administering.`,
                });
              }
            }
          }
        }

        const result = {
          patient_id: patientId,
          documented_allergies: allergySubstances,
          medications_screened: medNames,
          direct_conflicts: directConflicts,
          cross_reactive_risks: crossReactiveRisks,
          total_alerts: directConflicts.length + crossReactiveRisks.length,
          disclaimer: "Allergy detection is based on FHIR-documented allergies only. Always verbally confirm allergies with the patient.",
        };

        return McpUtilities.createTextResponse(JSON.stringify(result, null, 2));
      },
    );
  }
}

export const FlagAllergyConflictsToolInstance = new FlagAllergyConflictsTool();
