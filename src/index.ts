import { Hono, Context } from 'hono';

const app = new Hono<{ Bindings: CloudflareBindings }>();

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

async function loadImage(c: Context): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('application/json')) {
    const body = await c.req.json();
    if (!body.url) {
      throw new Error('Invalid request body: "url" is required');
    }

    try {
      const url = new URL(body.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
      const imgResponse = await fetch(url.toString());
      if (!imgResponse.ok) {
        throw new Error(`Failed to fetch image: ${imgResponse.statusText}`);
      }
      const imgType = imgResponse.headers.get('content-type');
      if (!imgType || (!imgType.startsWith('image/') && !imgType.includes('application/octet-stream'))) {
        throw new Error('Fetched URL is not a valid image');
      }
      return {
        buffer: await imgResponse.arrayBuffer(),
        contentType: imgType
      };
    } catch (e: any) {
      throw new Error(e.message || 'Invalid URL provided');
    }
  } else if (
    contentType.includes('application/octet-stream') ||
    contentType.startsWith('image/')
  ) {
    return {
      buffer: await c.req.arrayBuffer(),
      contentType: contentType
    };
  } else {
    throw new Error('Invalid content type. Expected application/json or image binary');
  }
}

async function runAI(c: Context, systemPrompt: string, userPrompt: string, imgBuffer: ArrayBuffer) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const aiResponse = await c.env.AI.run(
    // @ts-ignore - Beta binding
    '@cf/meta/llama-3.2-11b-vision-instruct',
    {
      messages,
      image: Array.from(new Uint8Array(imgBuffer)),
    }
  );

  // @ts-ignore
  const rawResponse = aiResponse.response;

  // Handle direct object response
  if (typeof rawResponse === 'object' && rawResponse !== null) {
    return rawResponse;
  }

  // Handle string response
  return String(rawResponse || '').trim();
}

/**
 * POST /optimize
 * Generates full SEO metadata package as JSON.
 */
app.post('/optimize', async (c) => {
  const langQuery = c.req.query('lang') || 'en';
  const lang = languages.has(langQuery) ? langQuery : 'en';

  try {
    const { buffer: imgBuffer } = await loadImage(c);
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

    const result = await runAI(c, systemPrompt, userPrompt, imgBuffer);

    // If result is already an object, return it (likely handled by runAI for direct object responses)
    if (typeof result === 'object') {
      return c.json(result);
    }

    // Parse string result with robust extraction
    let responseText = result as string;
    const jsonStart = responseText.indexOf('{');
    const jsonEnd = responseText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      responseText = responseText.substring(jsonStart, jsonEnd + 1);
    }

    try {
      return c.json(JSON.parse(responseText));
    } catch (e) {
      throw new Error(`AI generation failed to produce valid JSON. Raw output: ${responseText.substring(0, 500)}`);
    }

  } catch (error: any) {
    console.error('Error in /optimize:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /alt-text
 */
app.post('/alt-text', async (c) => {
  return handleSingleFieldRequest(c, 'alt-text', 'Generate a concise, SEO-optimized alt text for this image. Under 125 characters. Output ONLY the text.');
});

/**
 * POST /caption
 */
app.post('/caption', async (c) => {
  return handleSingleFieldRequest(c, 'caption', 'Generate a short, engaging caption for this image suitable for social media. Output ONLY the text.');
});

/**
 * POST /description
 */
app.post('/description', async (c) => {
  return handleSingleFieldRequest(c, 'description', 'Generate a detailed description of the image content. Output ONLY the text.');
});

/**
 * POST /focus-keyword
 */
app.post('/focus-keyword', async (c) => {
  return handleSingleFieldRequest(c, 'focus-keyword', 'Identify the main subject or focus keyword of this image. Output ONLY the keyword/phrase.');
});

/**
 * Helper for single field endpoints
 */
async function handleSingleFieldRequest(c: Context, fieldName: string, promptInstruction: string) {
  const langQuery = c.req.query('lang') || 'en';
  const lang = languages.has(langQuery) ? langQuery : 'en';

  try {
    const { buffer: imgBuffer } = await loadImage(c);
    if (!imgBuffer || imgBuffer.byteLength === 0) return c.text('Invalid image data', 400);

    const systemPrompt = 'You are a helpful assistant.';
    const userPrompt = `${promptInstruction} Language: ${languages.get(lang)}.`;

    const result = await runAI(c, systemPrompt, userPrompt, imgBuffer);

    // If it's an object (unexpected for plain text prompt but possible), stringify it
    const textResult = typeof result === 'object' ? JSON.stringify(result) : result;

    return c.json({ result: textResult });
  } catch (error: any) {
    console.error(`Error in /${fieldName}:`, error);
    return c.json({ error: error.message }, 500);
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

    const result = await runAI(c, systemPrompt, userPrompt, imgBuffer);
    const textResult = typeof result === 'object' ? JSON.stringify(result) : result; // Should be string

    // Determine extension
    let extension = 'jpg';
    if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('webp')) extension = 'webp';
    else if (contentType.includes('gif')) extension = 'gif';

    // Post-processing
    const filename = (textResult as string)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    return c.json({ result: `${filename}.${extension}` });

  } catch (error: any) {
    console.error('Error in /filename:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
