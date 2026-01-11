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
      language: 'English',
      'alt-text': 'A test image',
      title: 'Test Title',
      caption: 'Test Caption',
      description: 'Test Description',
      filename: 'test-image',
      'focus-keyword': 'test',
    }),
  };

  beforeAll(() => {
    // Mock AI binding
    // @ts-ignore
    env.AI = {
      run: vi.fn().mockResolvedValue(mockAIResponse),
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
    { ext: 'avif', mime: 'image/avif' },
    { ext: 'svg', mime: 'image/svg+xml' },
    { ext: 'bmp', mime: 'image/bmp' },
  ];

  describe('/optimize', () => {
    describe('URL Input', () => {
      validImageTypes.forEach(({ ext, mime }) => {
        it(`should handle ${ext} image via URL and return correct filename extension`, async () => {
          // Mock Fetch Response
          fetchMock.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(10), // Dummy buffer
            headers: { get: () => mime },
          });

          const request = new Request('http://example.com/optimize', {
            method: 'POST',
            body: JSON.stringify({ url: `https://example.com/image.${ext}` }),
            headers: { 'Content-Type': 'application/json' },
          });

          const ctx = createExecutionContext();
          const response = await worker.fetch(request, env, ctx);
          await waitOnExecutionContext(ctx);

          expect(response.status).toBe(200);
          const json = (await response.json()) as any;

          expect(json).toHaveProperty('alt-text');
          expect(json).toHaveProperty('title');
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
            headers: { 'Content-Type': mime },
          });

          const ctx = createExecutionContext();
          const response = await worker.fetch(request, env, ctx);
          await waitOnExecutionContext(ctx);

          expect(response.status).toBe(200);
          const json = (await response.json()) as any;

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
            headers: { get: () => mime },
          });

          // Force AI to return raw string for filename endpoint
          // @ts-ignore
          env.AI.run.mockResolvedValueOnce({ response: 'generated-filename' });

          const request = new Request('http://example.com/filename', {
            method: 'POST',
            body: JSON.stringify({ url: `https://example.com/image.${ext}` }),
            headers: { 'Content-Type': 'application/json' },
          });

          const ctx = createExecutionContext();
          const response = await worker.fetch(request, env, ctx);
          await waitOnExecutionContext(ctx);

          expect(response.status).toBe(200);
          const json = (await response.json()) as any;
          expect(json.result).toBe(`generated-filename.${ext}`);
        });
      });
    });

    describe('Binary Input', () => {
      validImageTypes.forEach(({ ext, mime }) => {
        it(`should return correct filename extension for ${ext} binary`, async () => {
          // @ts-ignore
          env.AI.run.mockResolvedValueOnce({ response: 'generated-filename-binary' });

          const request = new Request('http://example.com/filename', {
            method: 'POST',
            body: new ArrayBuffer(10),
            headers: { 'Content-Type': mime },
          });

          const ctx = createExecutionContext();
          const response = await worker.fetch(request, env, ctx);
          await waitOnExecutionContext(ctx);

          expect(response.status).toBe(200);
          const json = (await response.json()) as any;
          expect(json.result).toBe(`generated-filename-binary.${ext}`);
        });
      });
    });
  });
  describe('/title', () => {
    it('should return a title for the image', async () => {
      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({ response: 'Generated Title' });

      const request = new Request('http://example.com/title', {
        method: 'POST',
        body: new ArrayBuffer(10),
        headers: { 'Content-Type': 'image/jpeg' },
      });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const json = (await response.json()) as any;
      expect(json.result).toBe('Generated Title');
    });
  });

  describe('SEO Features', () => {
    it('should include keyword and context in the AI prompt', async () => {
      const keyword = 'vintage lamp';
      const context = 'e-commerce product page';

      const request = new Request(`http://example.com/optimize?keyword=${encodeURIComponent(keyword)}&context=${encodeURIComponent(context)}`, {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/image.jpg' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // Mock Fetch for image
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
        headers: { get: () => 'image/jpeg' },
      });

      // Mock AI response with tags
      const seoMockResponse = {
        ...JSON.parse(mockAIResponse.response),
        tags: ['lamp', 'vintage', 'light', 'decor', 'antique'],
      };
      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({ response: JSON.stringify(seoMockResponse) });

      const ctx = createExecutionContext();
      await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      // Verify AI.run was called with prompt containing keyword and context
      // @ts-ignore
      const calls = env.AI.run.mock.calls;
      const lastCall = calls[calls.length - 1]; // [model, options]
      const messages = lastCall[1].messages;
      const userPrompt = messages.find((m: any) => m.role === 'user')?.content;

      expect(userPrompt).toContain(keyword);
      expect(userPrompt).toContain(context);
      expect(userPrompt).toContain('tags');
    });

    it('should include prefix, suffix, and tone in the AI prompt', async () => {
      const prefix = 'Look at this';
      const suffix = 'end.';
      const tone = 'excited';

      const request = new Request(`http://example.com/optimize?prefix=${encodeURIComponent(prefix)}&suffix=${encodeURIComponent(suffix)}&tone=${encodeURIComponent(tone)}`, {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/image.jpg' }),
        headers: { 'Content-Type': 'application/json' },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
        headers: { get: () => 'image/jpeg' },
      });

      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({ response: mockAIResponse.response });

      const ctx = createExecutionContext();
      await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      // Verify AI.run was called with prompt containing new fields
      // @ts-ignore
      const calls = env.AI.run.mock.calls;
      const lastCall = calls[calls.length - 1];
      const messages = lastCall[1].messages;
      const userPrompt = messages.find((m: any) => m.role === 'user')?.content;

      expect(userPrompt).toContain(prefix);
      expect(userPrompt).toContain(suffix);
      expect(userPrompt).toContain(tone);
    });

    it('should return tags in the response', async () => {
      const request = new Request('http://example.com/optimize', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/image.jpg' }),
        headers: { 'Content-Type': 'application/json' },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
        headers: { get: () => 'image/jpeg' },
      });

      // Mock AI parsing returning tags
      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({
        response: JSON.stringify({
          ...JSON.parse(mockAIResponse.response),
          tags: ['test', 'tag']
        })
      });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      const json = (await response.json()) as any;

      expect(json).toHaveProperty('tags');
      expect(Array.isArray(json.tags)).toBe(true);
      expect(json.tags).toContain('test');
    });

    it('should handle .jpeg extension by normalizing to .jpg', async () => {
      // Mock AI response with filename having .jpeg (simulating AI behavior or user input logic if we relied on it, 
      // but here we check getExtension logic mainly)
      // Actually we check that if we input a file with content-type image/jpeg, output filename ends in .jpg

      const request = new Request('http://example.com/filename', {
        method: 'POST',
        body: new ArrayBuffer(10),
        headers: { 'Content-Type': 'image/jpeg' }, // Explicitly jpeg
      });

      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({ response: 'test-file' });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      const json = (await response.json()) as any;

      expect(json.result).toBe('test-file.jpg');
    });

    it('should handle uppercase Content-Type headers', async () => {
      const request = new Request('http://example.com/filename', {
        method: 'POST',
        body: new ArrayBuffer(10),
        headers: { 'Content-Type': 'IMAGE/PNG' }, // Uppercase
      });

      // @ts-ignore
      env.AI.run.mockResolvedValueOnce({ response: 'test-file-upper' });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      const json = (await response.json()) as any;

      expect(json.result).toBe('test-file-upper.png');
    });
  });
});
