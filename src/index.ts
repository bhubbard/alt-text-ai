import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';

// Define Cloudflare AI Binding Interface
interface Ai {
  run(model: string, inputs: { messages: { role: string; content: string }[]; image?: number[] | number[][] }): Promise<unknown>;
}

interface CloudflareBindings {
  AI: Ai;
}

// Define expected response structure
interface OptimizeResponse {
  language?: string;
  'alt-text'?: string;
  caption?: string;
  description?: string;
  filename?: string;
  'focus-keyword'?: string;
  // Allow for loose matching during parsing before validation
  [key: string]: string | null | undefined;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Middleware
app.use('*', logger());
app.use('/*', cors());

// This Map contains the supported languages by the AI model.
const languages = new Map([
  ['en', 'English'],
  ['de', 'German'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['th', 'Thai'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
]);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

function getExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  return 'jpg'; // Default
}

async function loadImage(c: Context): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const contentType = c.req.header('Content-Type') || '';
  let buffer: ArrayBuffer;
  let type: string;

  if (contentType.includes('application/json')) {
    try {
      const body = await c.req.json();
      const schema = z.object({
        url: z.string().url(),
      });
      const { url } = schema.parse(body);

      if (url.startsWith('https://') || url.startsWith('http://')) {
        // Double check protocol just in case, though Zod .url() covers valid URI structure, 
        // it allows other protocols like ftp if not restricted? 
        // Zod validation is: "https://zod.dev/?id=string" -> url() checks for valid URL.
        // It does not strictly enforce http/https by default, so we keep the check or add regex.
        // Actually, let's trust Zod's .url() is good enough for structure, but check protocol specifically.
      } else {
        throw new Error('Invalid protocol. Only http and https are allowed.');
      }

      // We still use URL object for strict protocol check or rely on regex
      // Note: schema.parse throws ZodError if invalid.

      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }

      const imgResponse = await fetch(url);
      if (!imgResponse.ok) {
        throw new Error(`Failed to fetch image: ${imgResponse.statusText}`);
      }
      const imgType = imgResponse.headers.get('content-type');
      if (
        !imgType ||
        (!imgType.startsWith('image/') && !imgType.includes('application/octet-stream'))
      ) {
        throw new Error('Fetched URL is not a valid image');
      }
      buffer = await imgResponse.arrayBuffer();
      type = imgType;
    } catch (e: unknown) {
      // Handle Zod Error specifically for better messages?
      if (e instanceof z.ZodError) {
        throw new Error(`Invalid Input: ${e.errors.map((err: z.ZodIssue) => err.message).join(', ')}`);
      }
      const msg = e instanceof Error ? e.message : 'Invalid URL provided';
      throw new Error(msg);
    }
  } else if (contentType.includes('application/octet-stream') || contentType.startsWith('image/')) {
    buffer = await c.req.arrayBuffer();
    type = contentType;
  } else {
    throw new Error('Invalid content type. Expected application/json or image binary');
  }

  // Size Limit Check
  if (buffer.byteLength > MAX_IMAGE_SIZE) {
    throw new Error(
      `Image size exceeds limit of 10MB. Received: ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB`
    );
  }

  return { buffer, contentType: type };
}

async function runAI<T = string>(
  c: Context<{ Bindings: CloudflareBindings }>,
  systemPrompt: string,
  userPrompt: string,
  imgBuffer: ArrayBuffer
): Promise<T> {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const aiResponse = await c.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
    messages,
    image: Array.from(new Uint8Array(imgBuffer)),
  });

  // Handle direct object response (if the binding returns structured data directly)
  if (aiResponse && typeof aiResponse === 'object' && !('response' in aiResponse)) {
    return aiResponse as T;
  }

  // Standard response wrapper
  // Safe cast because we checked it's an object above, or we just treat it as unknown for property access
  const rawResponse = (aiResponse as { response?: unknown })?.response;

  // Handle if nested response is object
  if (typeof rawResponse === 'object' && rawResponse !== null) {
    return rawResponse as T;
  }

  // Handle string response
  return String(rawResponse || '').trim() as unknown as T;
}

/**
 * POST /optimize
 * Generates full SEO metadata package as JSON.
 */
app.post('/optimize', async (c) => {
  const langQuery = c.req.query('lang') || 'en';
  const lang = languages.has(langQuery) ? langQuery : 'en';

  try {
    const { buffer: imgBuffer, contentType } = await loadImage(c);
    if (!imgBuffer || imgBuffer.byteLength === 0) return c.text('Invalid image data', 400);

    const systemPrompt = 'You are an SEO expert. You output valid JSON only.';
    const userPrompt = `
      Analyze the image and generate a structured JSON response with the following fields:
      - "language": The language code used (e.g., "${languages.get(lang)}").
      - "alt-text": A concise, SEO-optimized alt text (under 125 chars).
      - "caption": A short, engaging caption for social media.
      - "description": A detailed description of the image content.
      - "filename": A short, SEO-friendly filename (lowercase, dashes, no extension).
      - "focus-keyword": The main subject or keyword of the image.

      Output ONLY valid JSON. No markdown formatting, no code blocks, no intro/outro text.
      Language for all text fields: ${languages.get(lang)}.
    `;

    // Use generic to type the response
    const result = await runAI<OptimizeResponse | string>(c, systemPrompt, userPrompt, imgBuffer);

    let parsedResult: OptimizeResponse;

    // If result is already an object, allow it
    if (typeof result === 'object') {
      parsedResult = result as OptimizeResponse;
    } else {
      // Parse string result with robust extraction
      let responseText = result as string;
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        responseText = responseText.substring(jsonStart, jsonEnd + 1);
      }

      try {
        parsedResult = JSON.parse(responseText);
      } catch {
        throw new Error(
          `AI generation failed to produce valid JSON. Raw output: ${responseText.substring(0, 500)}`
        );
      }
    }

    // Append extension to filename if present
    if (parsedResult.filename) {
      const ext = getExtension(contentType);
      // Ensure we don't double append if AI somehow added it
      if (!parsedResult.filename.endsWith(`.${ext}`)) {
        parsedResult.filename = `${parsedResult.filename}.${ext}`;
      }
    }

    // Ensure focus-keyword is present (handle potential AI variations like underscore)
    if (!parsedResult['focus-keyword']) {
      parsedResult['focus-keyword'] =
        parsedResult['focus_keyword'] || parsedResult['keyword'] || undefined;
      // Clean up legacy/malformed keys
      delete parsedResult['focus_keyword'];
      delete parsedResult['keyword'];
    }

    return c.json(parsedResult);
  } catch (error: unknown) {
    console.error('Error in /optimize:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /alt-text
 */
app.post('/alt-text', async (c) => {
  return handleSingleFieldRequest(
    c,
    'alt-text',
    'Generate a concise, SEO-optimized alt text for this image. Under 125 characters. Output ONLY the text.'
  );
});

/**
 * POST /caption
 */
app.post('/caption', async (c) => {
  return handleSingleFieldRequest(
    c,
    'caption',
    'Generate a short, engaging caption for this image suitable for social media. Output ONLY the text.'
  );
});

/**
 * POST /description
 */
app.post('/description', async (c) => {
  return handleSingleFieldRequest(
    c,
    'description',
    'Generate a detailed description of the image content. Output ONLY the text.'
  );
});

/**
 * POST /focus-keyword
 */
app.post('/focus-keyword', async (c) => {
  return handleSingleFieldRequest(
    c,
    'focus-keyword',
    'Identify the main subject or focus keyword of this image. Output ONLY the keyword/phrase.'
  );
});

/**
 * Helper for single field endpoints
 */
async function handleSingleFieldRequest(
  c: Context<{ Bindings: CloudflareBindings }>,
  fieldName: string,
  promptInstruction: string
) {
  const langQuery = c.req.query('lang') || 'en';
  const lang = languages.has(langQuery) ? langQuery : 'en';

  try {
    const { buffer: imgBuffer } = await loadImage(c);
    if (!imgBuffer || imgBuffer.byteLength === 0) return c.text('Invalid image data', 400);

    const systemPrompt = 'You are a helpful assistant.';
    const userPrompt = `${promptInstruction} Language: ${languages.get(lang)}.`;

    // Request a string response
    const result = await runAI<string>(c, systemPrompt, userPrompt, imgBuffer);

    const textResult = typeof result === 'object' ? JSON.stringify(result) : result;

    return c.json({ result: textResult });
  } catch (error: unknown) {
    console.error(`Error in /${fieldName}:`, error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
}

/**
 * POST /filename
 * Special handling for filename generation
 */
app.post('/filename', async (c) => {
  try {
    const { buffer: imgBuffer, contentType } = await loadImage(c);
    if (!imgBuffer || imgBuffer.byteLength === 0) return c.text('Invalid image data', 400);

    const systemPrompt = 'You are a helpful assistant that generates SEO-friendly filenames.';
    const userPrompt = `
          Generate a short, descriptive filename for this image. 
          It should be 3-5 words long, describing the main subject.
          Output ONLY the filename as space-separated words.
          Do NOT include the file extension.
          Do NOT use underscores or dashes, just spaces.
        `;

    // Expect string
    const result = await runAI<string>(c, systemPrompt, userPrompt, imgBuffer);
    const textResult = typeof result === 'object' ? JSON.stringify(result) : result;

    const ext = getExtension(contentType);

    // Post-processing for SEO filename
    const filename = (textResult as string)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    return c.json({ result: `${filename}.${ext}` });
  } catch (error: unknown) {
    console.error('Error in /filename:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export default app;
