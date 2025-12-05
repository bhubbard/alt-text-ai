import { Hono, Context } from 'hono';

const app = new Hono<{ Bindings: CloudflareBindings }>();

// This Map contains the supported languages by the AI model.
// Note: Some languages may not generate accurate results.
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

    // Validate URL
    let url: URL;
    try {
      url = new URL(body.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      throw new Error('Invalid URL provided');
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

/**
 * POST /describe
 *
 * This API route generates an SEO-optimized alt text for a given image. The image can be provided
 * either via a URL in a JSON body or as binary data (JPEG, PNG). The alt text is concise and optimized
 * for accessibility and SEO. The user can specify the language of the alt text via a query parameter,
 * with English as the default.
 *
 * @queryParam {string} [lang="en"] - The target language for the alt text. Supported languages: en (English),
 * de (German), fr (French), it (Italian), pt (Portuguese), hi (Hindi), es (Spanish), th (Thai).
 *
 * @requestBody {application/json} [url]
 * @requestBody {application/octet-stream} [binary] - Binary image data (JPEG, PNG) sent directly.
 */
app.post('/describe', async (c) => {
  const langQuery = c.req.query('lang') || 'en';
  const lang = languages.has(langQuery) ? langQuery : 'en';

  try {
    const { buffer: imgBuffer } = await loadImage(c);

    if (!imgBuffer || imgBuffer.byteLength === 0) {
      return c.text('Invalid image data', 400);
    }

    const messages = [
      {
        role: 'system',
        content:
          'You are a friendly assistant who specializes in generating SEO-optimized content.',
      },
      {
        role: 'user',
        content: `
          Please generate a concise, SEO-optimized alt text for this image, and output only the alt text itself with no additional commentary. 
          The alt tag should describe the content of the image clearly for accessibility, include relevant keywords, and be under 125 characters.
          Provide the alt text in the following language: ${languages.get(lang)}.
        `,
      },
    ];

    const aiResponse = await c.env.AI.run(
      // @ts-ignore - We know that the AI binding exists / BETA
      '@cf/meta/llama-3.2-11b-vision-instruct',
      {
        messages,
        image: Array.from(new Uint8Array(imgBuffer)),
      }
    );

    // @ts-ignore - We know that the response property exists / BETA
    let response: string = aiResponse.response || '';
    response = response.trim();

    return c.json({ result: response });

  } catch (error: any) {
    console.error('Error processing request:', error);
    const status = error.message.startsWith('Invalid') || error.message.startsWith('Failed') ? 400 : 500;
    return c.text(error.message || 'Internal Server Error', status);
  }
});

/**
 * POST /filename
 *
 * Generates an SEO-friendly filename for the provided image.
 */
app.post('/filename', async (c) => {
  try {
    const { buffer: imgBuffer, contentType } = await loadImage(c);

    if (!imgBuffer || imgBuffer.byteLength === 0) {
      return c.text('Invalid image data', 400);
    }

    const messages = [
      {
        role: 'system',
        content:
          'You are a helpful assistant that generates SEO-friendly filenames.',
      },
      {
        role: 'user',
        content: `
          Generate a short, descriptive filename for this image. 
          It should be 3-5 words long, describing the main subject.
          Output ONLY the filename as space-separated words.
          Do NOT include the file extension.
          Do NOT use underscores or dashes, just spaces.
        `,
      },
    ];

    const aiResponse = await c.env.AI.run(
      // @ts-ignore - We know that the AI binding exists / BETA
      '@cf/meta/llama-3.2-11b-vision-instruct',
      {
        messages,
        image: Array.from(new Uint8Array(imgBuffer)),
      }
    );

    // @ts-ignore
    let response: string = aiResponse.response || '';

    // Determine extension
    let extension = 'jpg'; // Default
    if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('webp')) extension = 'webp';
    else if (contentType.includes('gif')) extension = 'gif';

    // Post-processing for SEO filename
    const filename = response
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')  // Remove special chars (keep spaces)
      .replace(/\s+/g, '-')         // Replace spaces with dashes
      .replace(/-+/g, '-');         // Remove duplicate dashes

    return c.json({ result: `${filename}.${extension}` });

  } catch (error: any) {
    console.error('Error processing request:', error);
    const status = error.message.startsWith('Invalid') || error.message.startsWith('Failed') ? 400 : 500;
    return c.text(error.message || 'Internal Server Error', status);
  }
});

export default app;
