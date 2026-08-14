# Clinical Decision Support (CDS) MCP Server

### Agents Assemble Hackathon Project — Prompt Opinion

A Model Context Protocol (MCP) server designed to provide healthcare AI agents with access to clinical decision-support capabilities through structured tools and live FHIR data.

The project was developed as a submission for the **Agents Assemble Hackathon** hosted through Prompt Opinion.

---

## Overview

The Clinical Decision Support (CDS) MCP Server exposes clinical decision-support functionality as MCP tools that can be consumed by compatible AI agents.

The server is designed around four core capabilities:

- Drug interaction checking
- Contraindication checking
- Dosing guideline retrieval
- Allergy conflict detection

The system uses **FHIR R4** data and is designed to support structured access to clinical information by AI agents.

> **Disclaimer:** This project is a technical prototype/hackathon submission and is not intended to replace professional clinical judgment or serve as a production medical decision-making system.

---

## MCP Tools

The server exposes the following tools:

### `CheckDrugInteractions`

Checks medications for potential drug-drug interactions.

### `CheckContraindications`

Checks whether a medication or treatment may be contraindicated based on available clinical information.

### `GetDosingGuidelines`

Provides access to relevant dosing guidance.

### `FlagAllergyConflicts`

Checks for potential conflicts between medications and known allergies.

---

## Architecture

The project uses the Model Context Protocol to expose clinical decision-support functions as tools that can be called by an AI agent.

```text
                 AI Agent
                    │
                    │ MCP
                    ▼
          ┌───────────────────┐
          │   CDS MCP Server  │
          └─────────┬─────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ▼           ▼           ▼
     Drug       Contra-      Allergy /
 Interaction   indications    Dosing
        │           │           │
        └───────────┼───────────┘
                    │
                    ▼
                 FHIR R4
