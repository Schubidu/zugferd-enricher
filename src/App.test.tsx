import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("invoice selection screen", () => {
  it("states that data stays local and downstream work is not yet available", () => {
    render(<App />);
    expect(screen.getByText(/keine Übertragung an einen Server/i)).toBeInTheDocument();
    expect(screen.getByText(/OCR für gescannte PDFs und der ZUGFeRD-Export sind noch nicht verfügbar/i)).toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"Geplanter Ablauf"})).not.toBeInTheDocument();
    expect(screen.queryByText(/LOCAL-FIRST/)).not.toBeInTheDocument();
  });

  it("selects a PDF locally, shows the name and can remove it without a network request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<App />);
      const input = screen.getByLabelText(/PDF auswählen/i);
      fireEvent.change(input, {
        target: { files: [new File(["synthetic"], "example.pdf", { type: "application/pdf" })] },
      });
      expect(screen.getByText("example.pdf")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));
      expect(screen.queryByText("example.pdf")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears the native picker after a valid selection, allowing re-selection after drag and drop", () => {
    render(<App />);
    const input = screen.getByLabelText(/PDF auswählen/i) as HTMLInputElement;
    const clearInput = vi.spyOn(input, "value", "set");
    const initial = new File(["first"], "initial.pdf", { type: "application/pdf" });
    const dropped = new File(["second"], "dropped.pdf", { type: "application/pdf" });

    fireEvent.change(input, { target: { files: [initial] } });
    expect(screen.getByText("initial.pdf")).toBeInTheDocument();
    expect(clearInput).toHaveBeenCalledTimes(1);
    expect(clearInput).toHaveBeenLastCalledWith("");

    fireEvent.drop(screen.getByRole("region", { name: "PDF-Datei auswählen" }), {
      dataTransfer: { files: { item: () => dropped } },
    });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
    expect(clearInput).toHaveBeenCalledTimes(2);
    expect(clearInput).toHaveBeenLastCalledWith("");

    // In a real browser, clearing the native value lets the user pick initial.pdf again.
    fireEvent.change(input, { target: { files: [initial] } });
    expect(screen.getByText("initial.pdf")).toBeInTheDocument();
    expect(screen.queryByText("dropped.pdf")).not.toBeInTheDocument();
    expect(clearInput).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported file types and reports an accessible error", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/PDF auswählen/i), {
      target: { files: [new File(["sample"], "file.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Endung .pdf/i);
  });

  it("supports dropping a PDF without uploading it", () => {
    render(<App />);
    fireEvent.drop(screen.getByRole("region", { name: "PDF-Datei auswählen" }), {
      dataTransfer: {
        files: { item: () => new File(["test"], "dropped.pdf", { type: "application/pdf" }) },
      },
    });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  });
});
