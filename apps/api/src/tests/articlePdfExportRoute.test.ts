import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";

const articlePdfMock = vi.hoisted(() => {
  class MockPdfBrowserUnavailableError extends Error {
    statusCode = 503;

    constructor() {
      super("Chrome unavailable");
    }
  }
  return {
    createArticlesPdf: vi.fn(),
    PdfBrowserUnavailableError: MockPdfBrowserUnavailableError
  };
});

vi.mock("../services/export/articlePdf.js", () => articlePdfMock);

describe("article PDF export API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    articlePdfMock.createArticlesPdf.mockReset();
  });

  it("rejects empty article ids, too many article ids, and invalid view modes", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/export/articles/pdf",
      payload: { articleIds: [], viewMode: "persian" }
    });
    expect(empty.statusCode).toBe(400);

    const tooMany = await app.inject({
      method: "POST",
      url: "/api/export/articles/pdf",
      payload: {
        articleIds: Array.from({ length: 51 }, (_, index) => `a${index}`),
        viewMode: "persian"
      }
    });
    expect(tooMany.statusCode).toBe(400);

    const invalidMode = await app.inject({
      method: "POST",
      url: "/api/export/articles/pdf",
      payload: { articleIds: ["a1"], viewMode: "compact" }
    });
    expect(invalidMode.statusCode).toBe(400);
    expect(articlePdfMock.createArticlesPdf).not.toHaveBeenCalled();
  });

  it("returns a PDF attachment for one or multiple selected articles", async () => {
    const pdf = Buffer.from("%PDF-1.7\nselected articles");
    articlePdfMock.createArticlesPdf.mockResolvedValue(pdf);

    const response = await app.inject({
      method: "POST",
      url: "/api/export/articles/pdf",
      payload: { articleIds: ["a2", "a1"], viewMode: "split" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=localreader-fa-articles.pdf"
    );
    expect(response.rawPayload).toEqual(pdf);
    expect(articlePdfMock.createArticlesPdf).toHaveBeenCalledWith({
      articleIds: ["a2", "a1"],
      viewMode: "split"
    });
  });

  it("returns 503 when Chrome is not available", async () => {
    articlePdfMock.createArticlesPdf.mockRejectedValue(
      new articlePdfMock.PdfBrowserUnavailableError()
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/export/articles/pdf",
      payload: { articleIds: ["a1"], viewMode: "persian" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Chrome unavailable" });
  });
});
