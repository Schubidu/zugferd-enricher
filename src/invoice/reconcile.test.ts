import { describe, expect, it } from "vitest";
import { reconcileInvoice } from "./reconcile";
import { emptyFields } from "./model";
import type { InvoiceDraft, LineItem } from "./model";

const makeDraft = ():InvoiceDraft=>({
  pageCount:2,sourceLines:[],fields:emptyFields(),items:[],taxGroups:[],warnings:[],
});
function fieldsWithMoney(draft:InvoiceDraft,net:string,tax:string,gross:string) {
  draft.fields.netTotal={value:net,origin:"pdf",evidenceIds:["net"]};
  draft.fields.taxTotal={value:tax,origin:"pdf",evidenceIds:["tax"]};
  draft.fields.grossTotal={value:gross,origin:"pdf",evidenceIds:["gross"]};
}
function item(overrides:Partial<LineItem> = {}):LineItem{
  return {id:"item",description:"Logis",quantity:"2",unitPrice:"100,00",
    amount:"200,00",taxRate:"7%",origin:"pdf",evidenceIds:["item-source"],...overrides};
}
describe("source-backed invoice reconciliation",()=>{
  it("passes a consistent document and mixed VAT groups",()=>{
    const draft=makeDraft();
    fieldsWithMoney(draft,"235,00","20,65","255,65");
    draft.taxGroups=[
      {rate:"7%",net:"200,00",tax:"14,00",evidenceIds:["group-7"]},
      {rate:"19%",net:"35,00",tax:"6,65",evidenceIds:["group-19"]},
    ];
    draft.items=[item()];
    expect(reconcileInvoice(draft)).toEqual([]);
  });
  it("detects document total mismatch using exact cents",()=>{
    const draft=makeDraft();fieldsWithMoney(draft,"0,10","0,20","0,31");
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"document-total",severity:"mismatch",evidenceIds:["net","tax","gross"]}),
    ]));
  });
  it("does not manufacture missing VAT or net amounts",()=>{
    const draft=makeDraft();draft.fields.grossTotal={value:"119,00",origin:"pdf",evidenceIds:["gross"]};
    expect(reconcileInvoice(draft).find(f=>f.id==="document-total")?.severity).toBe("review");
    expect(draft.fields.netTotal).toBeNull();
  });
  it("detects wrong VAT by rate and retains source evidence",()=>{
    const draft=makeDraft();fieldsWithMoney(draft,"100,00","18,00","118,00");
    draft.taxGroups=[{rate:"19%",net:"100,00",tax:"18,00",evidenceIds:["tax-line"]}];
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({severity:"mismatch",id:"tax-tax-line",evidenceIds:["tax-line"]}),
    ]));
  });
  it("allows a one-cent rounding difference but not a two-cent difference",()=>{
    const draft=makeDraft();
    draft.taxGroups=[{rate:"7%",net:"12,50",tax:"0,89",evidenceIds:["a"]}];
    expect(reconcileInvoice(draft).some(f=>f.id==="tax-a")).toBe(false);
    draft.taxGroups[0]!.tax="0,90";
    expect(reconcileInvoice(draft).some(f=>f.id==="tax-a")).toBe(true);
  });
  it("detects missing tax groups but doesn't guess missing tax allocations",()=>{
    const draft=makeDraft();fieldsWithMoney(draft,"120,00","19,00","139,00");
    draft.taxGroups=[{rate:"7%",net:"20,00",tax:"1,40",evidenceIds:["7"]}];
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"tax-summary",severity:"review"}),
    ]));
  });
  it("compares quantity x stated unit price with stated item total in exact cents",()=>{
    const draft=makeDraft();
    draft.items=[item({quantity:"1,5",unitPrice:"10,00",amount:"14,99"})];
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"quantity-item",severity:"mismatch",evidenceIds:["item-source"]}),
    ]));
    draft.items[0]!.amount="15,00";
    expect(reconcileInvoice(draft).some(f=>f.id==="quantity-item")).toBe(false);
  });
  it("does not claim Kurtaxe is VAT-exempt just from the category label",()=>{
    const draft=makeDraft();draft.items=[item({description:"Kurtaxe",taxRate:null,quantity:null,unitPrice:null})];
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"missing-tax-rates",severity:"review"}),
    ]));
    expect(draft.items[0]!.taxRate).toBeNull();
  });
  it("flags absent VAT breakdown without allocating an implied rate",()=>{
    const draft=makeDraft();
    fieldsWithMoney(draft,"100,00","19,00","119,00");
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id:"tax-breakdown",severity:"review",
        evidenceIds:["tax"],
      }),
    ]));
    expect(draft.taxGroups).toHaveLength(0);
  });
  it("flags due dates before invoice dates but abstains on ambiguous formats",()=>{
    const draft=makeDraft();
    draft.fields.invoiceDate={value:"15.11.2026",origin:"pdf",evidenceIds:["invoice-date"]};
    draft.fields.dueDate={value:"2026-11-10",origin:"pdf",evidenceIds:["due-date"]};
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"date-order",severity:"review",
        evidenceIds:["invoice-date","due-date"]}),
    ]));
    draft.fields.dueDate.value="11/10/2026";
    expect(reconcileInvoice(draft).some(f=>f.id==="date-order")).toBe(false);
  });

});
