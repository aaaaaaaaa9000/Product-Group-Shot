import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { installLogin } from './login';
import { GoogleGenAI } from '@google/genai';

// ---- Config (all from env) ----
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
// Used for the "2K" / "4K" quality options (the lite model only makes ~1K images).
const HQ_IMAGE_MODEL = process.env.GEMINI_HQ_IMAGE_MODEL || 'gemini-3.1-flash-image';
const TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const APP_USERNAME = process.env.APP_USERNAME || 'user';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 30;
const MAX_PROMPT_CHARS = Number(process.env.MAX_PROMPT_CHARS) || 4000;
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB) || 12;
const MAX_GROUP_IMAGES = Number(process.env.MAX_GROUP_IMAGES) || 8;
const MAX_IMAGE_BASE64 = Math.ceil((MAX_IMAGE_MB * 1024 * 1024 * 4) / 3);
const ALLOWED_ASPECT = new Set(['1:1', '4:5', '3:4', '9:16', '16:9']);
type Quality = 'standard' | '2K' | '4K';
const ALLOWED_QUALITY = new Set<Quality>(['standard', '2K', '4K']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
];

// ---- Gemini client (created once, lazily) ----
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error('GEMINI_API_KEY is not set'), { status: 'NO_KEY' });
  }
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return aiClient;
}

// ---- Helpers ----
type ImageInput = { base64: string; mimeType: string };

/** Returns an Arabic error message if the image is invalid, otherwise null. */
function validateImage(img: unknown, label: string): string | null {
  const i = img as Partial<ImageInput> | undefined;
  if (!i || typeof i.base64 !== 'string' || !i.base64) return `ارفع ${label} الأول.`;
  if (typeof i.mimeType !== 'string' || !ALLOWED_MIME.has(i.mimeType)) {
    return `نوع ${label} غير مدعوم. استخدم صورة عادية (جي بي جي أو بي إن جي).`;
  }
  if (i.base64.length > MAX_IMAGE_BASE64) return `${label} كبيرة جدًا. الحد الأقصى ${MAX_IMAGE_MB} ميجا.`;
  return null;
}

function parseQuality(value: unknown): Quality | null {
  if (value === undefined || value === null || value === '') return 'standard';
  return ALLOWED_QUALITY.has(value as Quality) ? (value as Quality) : null;
}

/** Maps a Gemini SDK error to an HTTP status and an Arabic message; logs details server-side. */
function sendGeminiError(res: Response, error: any, context: string) {
  console.error(`[${context}]`, error?.status, error?.message);
  const msg = String(error?.message || '');
  if (error?.status === 'NO_KEY') {
    return res.status(500).json({ error: 'مفتاح جيميناي مش متضبط على السيرفر.' });
  }
  if (error?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return res.status(429).json({ error: 'تم تجاوز حد الاستخدام للمفتاح. جرّب تاني بعد شوية.' });
  }
  if (error?.status === 403 || /PERMISSION_DENIED|API_KEY_INVALID|API key/i.test(msg)) {
    return res.status(502).json({ error: 'مفتاح جيميناي مرفوض. راجع المفتاح في إعدادات السيرفر.' });
  }
  return res.status(500).json({ error: 'حصلت مشكلة أثناء المعالجة. جرّب تاني.' });
}

/** Calls the image model and returns the first image, or an Arabic error. */
async function generateAndSend(
  res: Response,
  parts: any[],
  context: string,
  quality: Quality,
  aspectRatio?: string,
) {
  const imageConfig: Record<string, string> = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (quality !== 'standard') imageConfig.imageSize = quality;
  try {
    const response = await getAI().models.generateContent({
      model: quality === 'standard' ? IMAGE_MODEL : HQ_IMAGE_MODEL,
      contents: { parts },
      config: {
        safetySettings: SAFETY_SETTINGS as any,
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        return res.json({
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
          name: 'generated-image',
        });
      }
    }

    const reason = response.candidates?.[0]?.finishReason;
    console.warn(`[${context}] no image returned, finishReason:`, reason);
    if (reason && reason !== 'STOP') {
      return res.status(422).json({ error: 'الموديل رفض يولّد الصورة دي. جرّب صورة أو وصف تاني.' });
    }
    return res.status(502).json({ error: 'الموديل ماطلّعش صورة. جرّب تاني.' });
  } catch (error) {
    return sendGeminiError(res, error, context);
  }
}

// ---- Rate limit (per IP, fixed 1-minute window, in memory) ----
const hits = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (h.reset <= now) hits.delete(ip);
}, 60_000).unref();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.reset <= now) {
    h = { count: 0, reset: now + 60_000 };
    hits.set(ip, h);
  }
  h.count++;
  if (h.count > RATE_LIMIT_PER_MINUTE) {
    res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
    return res.status(429).json({ error: 'طلبات كتير في وقت قصير. استنى دقيقة وجرّب تاني.' });
  }
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Health check (before auth so Docker/Traefik can reach it)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // In-page login form + session cookie (only when APP_PASSWORD is set)
  installLogin(app, { appName: 'استوديو صور المنتجات', username: APP_USERNAME, password: APP_PASSWORD, accent: '#9C3548' });

  // Several (already downscaled) product photos plus a style image, or one 4K result for the blur tool.
  app.use(express.json({ limit: `${Math.max(50, MAX_IMAGE_MB * 3)}mb` }));

  app.post('/api/generate-image', rateLimit, async (req, res) => {
    const { productImages, prompt, styleImage, aspectRatio } = req.body || {};
    const quality = parseQuality(req.body?.quality);
    if (!quality) return res.status(400).json({ error: 'الجودة المطلوبة غير مدعومة.' });

    if (!Array.isArray(productImages) || productImages.length === 0) {
      return res.status(400).json({ error: 'ارفع صورة منتج واحدة على الأقل.' });
    }
    if (productImages.length > MAX_GROUP_IMAGES) {
      return res.status(400).json({ error: `أقصى عدد منتجات في الصورة الواحدة ${MAX_GROUP_IMAGES}.` });
    }
    for (const img of productImages) {
      const productError = validateImage(img, 'صورة المنتج');
      if (productError) return res.status(400).json({ error: productError });
    }
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'الوصف فاضي.' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(413).json({ error: `الوصف طويل جدًا. الحد الأقصى ${MAX_PROMPT_CHARS} حرف.` });
    }
    const hasStyle = styleImage && styleImage.base64;
    if (hasStyle) {
      const styleError = validateImage(styleImage, 'صورة الستايل');
      if (styleError) return res.status(400).json({ error: styleError });
    }

    if (aspectRatio !== undefined && aspectRatio !== null && !ALLOWED_ASPECT.has(aspectRatio)) {
      return res.status(400).json({ error: 'مقاس الصورة غير مدعوم.' });
    }

    const parts: any[] = productImages.map((img: ImageInput) => ({
      inlineData: { data: img.base64, mimeType: img.mimeType },
    }));
    parts.push({ text: prompt });
    if (hasStyle) {
      // Label the reference so the model doesn't paste its objects into the shot as extra products.
      parts.push({
        text: 'The next image is a STYLE REFERENCE ONLY. Copy its mood, colors and lighting; do not include any of its objects or people.',
      });
      parts.push({ inlineData: { data: styleImage.base64, mimeType: styleImage.mimeType } });
    }
    return generateAndSend(res, parts, 'generate-image', quality, aspectRatio || undefined);
  });

  app.post('/api/blur-background', rateLimit, async (req, res) => {
    const { image, intensity } = req.body || {};
    const quality = parseQuality(req.body?.quality);
    if (!quality) return res.status(400).json({ error: 'الجودة المطلوبة غير مدعومة.' });
    const imageError = validateImage(image, 'الصورة');
    if (imageError) return res.status(400).json({ error: imageError });
    const px = Math.round(Number(intensity));
    if (!Number.isFinite(px) || px < 2 || px > 50) {
      return res.status(400).json({ error: 'درجة التغبيش لازم تكون بين 2 و 50.' });
    }
    const prompt = `Keeping the main subject in sharp focus, apply a photographic gaussian blur effect to the background of this image. The blur intensity should be equivalent to a ${px}px radius. Ensure a natural, soft fall-off (bokeh). Do not change the product, its colors, shape, or any text on it. Return only the modified image.`;
    return generateAndSend(
      res,
      [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }],
      'blur-background',
      quality,
    );
  });

  app.post('/api/analyze-style', rateLimit, async (req, res) => {
    const { styleImage } = req.body || {};
    const styleError = validateImage(styleImage, 'صورة الستايل');
    if (styleError) return res.status(400).json({ error: styleError });

    try {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: {
          parts: [
            { inlineData: { data: styleImage.base64, mimeType: styleImage.mimeType } },
            {
              text: "Analyze this image and describe its aesthetic, color palette, and mood in a concise phrase suitable for a prompt. For example: 'A vibrant, high-contrast style with bold neon colors and a futuristic mood.'",
            },
          ],
        },
        config: { safetySettings: SAFETY_SETTINGS as any },
      });

      if (!response.text) {
        console.warn('[analyze-style] no text, finishReason:', response.candidates?.[0]?.finishReason);
        return res.status(502).json({ error: 'ماقدرتش أحلل صورة الستايل. جرّب صورة تانية.' });
      }
      return res.json({ description: response.text.trim() });
    } catch (error) {
      return sendGeminiError(res, error, 'analyze-style');
    }
  });

  // Unknown API routes → JSON 404 (instead of the SPA page)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (IS_PROD) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(
      '/assets',
      express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }),
    );
    app.use(express.static(distPath, { index: false }));
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Server on :${PORT} | image model: ${IMAGE_MODEL} | HQ image model: ${HQ_IMAGE_MODEL} | text model: ${TEXT_MODEL} | ` +
        `auth: ${APP_PASSWORD ? 'on' : 'off'} | rate limit: ${RATE_LIMIT_PER_MINUTE}/min | ` +
        `key: ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'}`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
