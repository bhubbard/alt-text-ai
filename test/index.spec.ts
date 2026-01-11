import { env, createExecutionContext, waitOnExecutionContext, self } from 'cloudflare:test';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import worker from '../src/index';

// Mock specific methods
const fetchMock = vi.fn();
// @ts-ignore
globalThis.fetch = fetchMock;

describe('Worker Tests', () => {
    // Shared mock AI Response
    const mockAIResponse = {
        response: JSON.stringify({
            language: "English",
            "alt-text": "A test image",
            caption: "Test Caption",
            description: "Test Description",
            filename: "test-image",
            "focus-keyword": "test"
        })
    };

    beforeAll(() => {
        // Mock AI binding
        // @ts-ignore
        env.AI = {
            run: vi.fn().mockResolvedValue(mockAIResponse)
        };
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    const validImageTypes = [
        { ext: 'jpg', mime: 'image/jpeg' },
        { ext: 'png', mime: 'image/png' },
        { ext: 'webp', mime: 'image/webp' },
        { ext: 'gif', mime: 'image/gif' },
        { ext: 'avif', mime: 'image/avif' }
    ];

    describe('/optimize', () => {
        describe('URL Input', () => {
            validImageTypes.forEach(({ ext, mime }) => {
                it(`should handle ${ext} image via URL and return correct filename extension`, async () => {
                    // Mock Fetch Response
                    fetchMock.mockResolvedValueOnce({
                        ok: true,
                        arrayBuffer: async () => new ArrayBuffer(10), // Dummy buffer
                        headers: { get: () => mime }
                    });

                    const request = new Request('http://example.com/optimize', {
                        method: 'POST',
                        body: JSON.stringify({ url: `https://example.com/image.${ext}` }),
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const ctx = createExecutionContext();
                    const response = await worker.fetch(request, env, ctx);
                    await waitOnExecutionContext(ctx);

                    expect(response.status).toBe(200);
                    const json = await response.json() as any;

                    expect(json).toHaveProperty('alt-text');
                    expect(json).toHaveProperty('filename');
                    expect(json.filename.endsWith(`.${ext}`)).toBe(true);
                });
            });
        });

        describe('Binary Input', () => {
            validImageTypes.forEach(({ ext, mime }) => {
                it(`should handle ${ext} binary image and return correct filename extension`, async () => {
                    const request = new Request('http://example.com/optimize', {
                        method: 'POST',
                        body: new ArrayBuffer(10),
                        headers: { 'Content-Type': mime }
                    });

                    const ctx = createExecutionContext();
                    const response = await worker.fetch(request, env, ctx);
                    await waitOnExecutionContext(ctx);

                    expect(response.status).toBe(200);
                    const json = await response.json() as any;

                    expect(json.filename.endsWith(`.${ext}`)).toBe(true);
                });
            });
        });
    });

    describe('/filename', () => {
        describe('URL Input', () => {
            validImageTypes.forEach(({ ext, mime }) => {
                it(`should return correct filename extension for ${ext}`, async () => {
                    // Mock Fetch Response
                    fetchMock.mockResolvedValueOnce({
                        ok: true,
                        arrayBuffer: async () => new ArrayBuffer(10),
                        headers: { get: () => mime }
                    });

                    // Force AI to return raw string for filename endpoint
                    // @ts-ignore
                    env.AI.run.mockResolvedValueOnce({ response: "generated-filename" });

                    const request = new Request('http://example.com/filename', {
                        method: 'POST',
                        body: JSON.stringify({ url: `https://example.com/image.${ext}` }),
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const ctx = createExecutionContext();
                    const response = await worker.fetch(request, env, ctx);
                    await waitOnExecutionContext(ctx);

                    expect(response.status).toBe(200);
                    const json = await response.json() as any;
                    expect(json.result).toBe(`generated-filename.${ext}`);
                });
            });
        });

        describe('Binary Input', () => {
            validImageTypes.forEach(({ ext, mime }) => {
                it(`should return correct filename extension for ${ext} binary`, async () => {
                    // @ts-ignore
                    env.AI.run.mockResolvedValueOnce({ response: "generated-filename-binary" });

                    const request = new Request('http://example.com/filename', {
                        method: 'POST',
                        body: new ArrayBuffer(10),
                        headers: { 'Content-Type': mime }
                    });

                    const ctx = createExecutionContext();
                    const response = await worker.fetch(request, env, ctx);
                    await waitOnExecutionContext(ctx);

                    expect(response.status).toBe(200);
                    const json = await response.json() as any;
                    expect(json.result).toBe(`generated-filename-binary.${ext}`);
                });
            });
        });
    });
});
