# Cloudflare AI Image Optimizer

Generate SEO-optimized metadata (alt text, captions, filenames) for images using Cloudflare’s AI. Upload images or provide image URLs, and receive structured JSON or text responses in multiple languages.

## Features
- **Comprehensive Metadata**: Generates `alt-text`, `caption`, `description`, `focus-keyword`, and SEO-friendly `filename`.
- **Formats Supported**: JPG, PNG, GIF, WEBP, **AVIF**.
- **Languages**: English, German, French, Italian, Portuguese, Hindi, Spanish, Thai, Japanese, Korean, Chinese.
- **Input Modes**: JSON (URL) or Binary Upload.
- **Robustness**: 10MB size limit, Zod validation, CORS enabled.
- **Stack**: Cloudflare Workers, Hono, TypeScript.

## API Endpoints

### 1. `/optimize` (POST)
Generates a full JSON object with all metadata fields.
**Query Params**: `?lang=en` (default: en)

**Example Request:**
```bash
curl -X POST https://your-worker-url/optimize?lang=en \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/image.jpg"}'
```

**Response:**
```json
{
  "language": "English",
  "alt-text": "A close up of a cat...",
  "caption": "Cute cat taking a nap",
  "description": "...",
  "filename": "cute-cat-nap.jpg",
  "focus-keyword": "cat nap"
}
```

### 2. Single Field Endpoints (POST)
Return a simple JSON object `{ "result": "text..." }`.
- `/alt-text`: SEO-optimized alt text.
- `/caption`: Social media caption.
- `/description`: Detailed description.
- `/focus-keyword`: Main subject keyword.
- `/filename`: SEO-friendly filename (e.g., `my-image.jpg`).

## Getting Started

### Prerequisites
- [Cloudflare Workers](https://workers.cloudflare.com/) account
- Node.js and npm installed

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/alt-text-ai
   cd alt-text-ai
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Development
1. Run local server:
   ```bash
   npm run dev
   ```
2. Run tests:
   ```bash
   npm test
   ```
3. Lint and Format:
   ```bash
   npm run lint
   npm run format
   ```

## Configuration
- **Model**: Uses `@cf/meta/llama-3.2-11b-vision-instruct`.
- **Size Limit**: 10MB.

## License
MIT
