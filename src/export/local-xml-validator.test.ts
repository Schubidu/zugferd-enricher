import { afterEach, describe, expect, it, vi } from "vitest";
import { validateCiiXmlInBrowser } from "./local-xml-validator";

type MockReply = {id: number; result: {
  status: "valid-xml-only" | "invalid" | "unavailable";
  checkedProfiles?: number; failures?: string[]; reason?: string;
}};

class FakeWorker {
  onmessage: ((message: MessageEvent<MockReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  constructor() {created.push(this);}
  postMessage(message: unknown) {this.posted.push(message);}
  terminate() {this.terminated = true;}
  reply(message: MockReply) {
    this.onmessage?.({data:message} as MessageEvent<MockReply>);
  }
}
const created: FakeWorker[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  created.length = 0;
});
function install() {vi.stubGlobal("Worker",FakeWorker);}
const validInput = "x".repeat(200);

describe("one-shot private browser CII validation worker", () => {
  it("passes XML to an isolated Worker, accepts its XML-only result and releases memory", async () => {
    install();
    const pending = validateCiiXmlInBrowser(validInput);
    expect(created).toHaveLength(1);
    expect(created[0]?.posted).toEqual([{id:1,xml:validInput}]);
    created[0]!.reply({id:1,result:{status:"valid-xml-only",checkedProfiles:2}});
    expect(await pending).toEqual({status:"valid-xml-only",checkedProfiles:2});
    expect(created[0]?.terminated).toBe(true);
  });

  it("rejects changed rule or malformed worker responses rather than allowing export", async () => {
    install();
    const pending = validateCiiXmlInBrowser(validInput);
    created[0]!.reply({id:50,result:{status:"valid-xml-only",checkedProfiles:2}});
    expect(await pending).toMatchObject({status:"unavailable"});
    expect(created[0]?.terminated).toBe(true);
  });

  it("rejects a Worker result that claims success without both profile checks", async () => {
    install();
    const pending = validateCiiXmlInBrowser(validInput);
    created[0]!.reply({id:1,result:{status:"valid-xml-only",checkedProfiles:1}});
    expect(await pending).toEqual({
      status:"unavailable",reason:"LOCAL_VALIDATION_INVALID_RESPONSE",
    });
    expect(created[0]?.terminated).toBe(true);
  });

  it("rejects empty failure or unavailable responses instead of trusting a status alone", async () => {
    install();
    for (const result of [
      {status:"invalid" as const,failures:[]},
      {status:"unavailable" as const,reason:""},
    ]) {
      const pending = validateCiiXmlInBrowser(validInput);
      const worker = created[created.length - 1]!;
      worker.reply({id:1,result});
      expect(await pending).toMatchObject({
        status:"unavailable",reason:"LOCAL_VALIDATION_INVALID_RESPONSE",
      });
      expect(worker.terminated).toBe(true);
    }
  });

  it("never starts a Worker for invalid or dangerous inputs", async () => {
    install();
    expect(await validateCiiXmlInBrowser("<!DOCTYPE x>" + validInput)).toMatchObject({
      status:"invalid",failures:["UNSAFE_XML"],
    });
    expect(await validateCiiXmlInBrowser("x".repeat(2_000_001))).toMatchObject({
      status:"invalid",failures:["UNSAFE_XML"],
    });
    expect(created).toHaveLength(0);
  });

  it("aborts ongoing validation, terminates its Worker, and rejects with AbortError", async () => {
    install();
    const controller = new AbortController();
    const pending = validateCiiXmlInBrowser(validInput,controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({name:"AbortError"});
    expect(created[0]?.terminated).toBe(true);
    expect(created[0]?.onmessage).not.toBeNull();
  });

  it("fails closed when the browser lacks Worker support", async () => {
    vi.stubGlobal("Worker", class { constructor() {throw new Error("unsupported");} });
    expect(await validateCiiXmlInBrowser(validInput)).toMatchObject({
      status:"unavailable",reason:"LOCAL_VALIDATION_WORKER_UNAVAILABLE",
    });
  });

  it("does not let an unresponsive Worker hang or authorize export", async () => {
    vi.useFakeTimers();
    install();
    const pending = validateCiiXmlInBrowser(validInput);
    await vi.advanceTimersByTimeAsync(30_100);
    expect(await pending).toEqual({
      status:"unavailable",reason:"LOCAL_VALIDATION_TIMEOUT",
    });
    expect(created[0]?.terminated).toBe(true);
  });

  it("propagates already cancelled requests without starting a Worker", async () => {
    install();
    const controller = new AbortController();
    controller.abort();
    await expect(validateCiiXmlInBrowser(validInput,controller.signal))
      .rejects.toMatchObject({name:"AbortError"});
    expect(created).toHaveLength(0);
  });
});
