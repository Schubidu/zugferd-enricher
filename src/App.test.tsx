import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("invoice selection screen", () => {
  it("states that data stays local and downstream work is not yet available", () => {
    render(<App />);
    expect(screen.getByText(/keine Übertragung an einen Server/i)).toBeInTheDocument();
    expect(screen.getByText(/folgen in den nächsten Issues/i)).toBeInTheDocument();
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
