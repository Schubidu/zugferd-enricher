import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyFields } from "../invoice/model";
import type { InvoiceDraft } from "../invoice/model";
import { buildCiiCandidate } from "./cii-candidate";
import { validateCiiXmlInBrowser } from "./local-xml-validator";
import ExportStatus from "./ExportStatus";

vi.mock("./preflight",() => ({
  assessExportPreflight: () => ({
    exportAllowed:false,sourceAligned:true,blockers:[],
  }),
}));
vi.mock("./cii-candidate",() => ({buildCiiCandidate:vi.fn()}));
vi.mock("./local-xml-validator",() => ({validateCiiXmlInBrowser:vi.fn()}));

const source: InvoiceDraft = {
  pageCount:1,sourceLines:[],fields:emptyFields(),items:[],taxGroups:[],warnings:[],
};
const candidate = vi.mocked(buildCiiCandidate);
const validate = vi.mocked(validateCiiXmlInBrowser);
const proof = "<?xml version=\"1.0\"?><rsm:CrossIndustryInvoice>source-backed</rsm:CrossIndustryInvoice>";

beforeEach(() => {
  candidate.mockReset();
  validate.mockReset();
});

describe("evidence-gated and non-exporting local XML validation", () => {
  it("does not create a Worker or alter the approved disclosure for incomplete invoices", () => {
    candidate.mockReturnValue({status:"blocked",reasons:["SOURCE_LINE_COVERAGE_UNVERIFIED"]});
    render(<ExportStatus original={source} reviewed={source}/>);
    expect(validate).not.toHaveBeenCalled();
    expect(screen.getByText(/vollständige EN-16931-Datenbasis/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
  });

  it("shows XML-only success only after the independent local Worker reports both profiles", async () => {
    candidate.mockReturnValue({status:"unvalidated",profile:"EN16931",xml:proof});
    validate.mockResolvedValue({status:"valid-xml-only",checkedProfiles:2});
    render(<ExportStatus original={source} reviewed={source}/>);
    expect(await screen.findByText(/erkannten XML-Daten bestehen die lokalen EN-16931-Regeln/))
      .toBeInTheDocument();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(proof,expect.any(AbortSignal));
    expect(screen.getByText(/Vollständiger Originalabgleich und PDF\/A-3 fehlen weiterhin/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
  });

  it("does not mistake a failed Schematron result for export readiness", async () => {
    candidate.mockReturnValue({status:"unvalidated",profile:"EN16931",xml:proof});
    validate.mockResolvedValue({status:"invalid",failures:["BR-CO-15"]});
    render(<ExportStatus original={source} reviewed={source}/>);
    expect(await screen.findByText(/lokale EN-16931-Prüfung hat Widersprüche erkannt/))
      .toBeInTheDocument();
    expect(screen.getByText(/Ein Export bleibt gesperrt/)).toBeInTheDocument();
  });

  it("cancels a pending XML validation when the original/reviewed state changes", () => {
    const replacement = {...source,warnings:["new invoice"]};
    candidate.mockImplementation((_original,reviewed) =>
      reviewed === replacement
        ? {status:"blocked",reasons:["SOURCE_CHANGED"]}
        : {status:"unvalidated",profile:"EN16931",xml:proof});
    validate.mockImplementation(() => new Promise(() => {}));
    const {rerender} = render(<ExportStatus original={source} reviewed={source}/>);
    expect(validate).toHaveBeenCalledTimes(1);
    const signal = validate.mock.calls[0]![1]!;
    expect(signal.aborted).toBe(false);
    rerender(<ExportStatus original={source} reviewed={replacement}/>);
    expect(signal.aborted).toBe(true);
    expect(screen.getByText(/vollständige EN-16931-Datenbasis/)).toBeInTheDocument();
  });
});
