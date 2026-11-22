import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'GEMINI_API_KEY is not configured. Open Settings > Secrets to attach an API key.'
    ) as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusProp = (err as { status?: number })?.status;
  if (statusProp && statusProp >= 400 && statusProp < 600) {
    return { status: statusProp, message: raw };
  }
  if (/429|RESOURCE_EXHAUSTED/i.test(raw)) {
    return {
      status: 429,
      message:
        'Gemini API quota exhausted or a billing-enabled API key is required for this model. Check Settings > Secrets.',
    };
  }
  if (/403|PERMISSION_DENIED|API_KEY_INVALID|401/i.test(raw)) {
    return {
      status: 403,
      message:
        'Gemini API key is missing or unauthorized for this model. Check Settings > Secrets.',
    };
  }
  return { status: 500, message: raw };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  // Public Firebase web app config served at runtime so client source & built JS bundles contain no hardcoded keys
  app.get('/api/firebase-config', (_req, res) => {
    let fileConfig: Record<string, unknown> = {};
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      } catch {
        fileConfig = {};
      }
    }

    const apiKey = process.env.FIREBASE_API_KEY || String(fileConfig.apiKey || '');
    const projectId = process.env.FIREBASE_PROJECT_ID || String(fileConfig.projectId || '');
    const appId = process.env.FIREBASE_APP_ID || String(fileConfig.appId || '');
    const authDomain = process.env.FIREBASE_AUTH_DOMAIN || String(fileConfig.authDomain || '');
    const firestoreDatabaseId =
      process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
      String(fileConfig.firestoreDatabaseId || '(default)');
    const storageBucket =
      process.env.FIREBASE_STORAGE_BUCKET || String(fileConfig.storageBucket || '');
    const messagingSenderId =
      process.env.FIREBASE_MESSAGING_SENDER_ID || String(fileConfig.messagingSenderId || '');

    if (!apiKey || !projectId || !appId) {
      return res.status(503).json({
        error: 'Firebase web configuration is not configured on the server.',
      });
    }

    return res.json({
      apiKey,
      authDomain,
      projectId,
      appId,
      firestoreDatabaseId,
      storageBucket,
      messagingSenderId,
    });
  });

  // 1. Deep Narrative & Dynamic Quest Synthesis (gemini-4-carbon + ThinkingLevel.HIGH)
  app.post('/api/narrative/quest', async (req, res) => {
    try {
      const { contextText, shrineId, shrineName } = req.body as {
        contextText?: string;
        shrineId?: string;
        shrineName?: string;
      };
      if (!contextText || typeof contextText !== 'string') {
        return res.status(400).json({ error: 'contextText is required.' });
      }

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-carbon',
        contents: `Generate an emergent, atmospheric 3D RPG quest anchored to the player's vector memory and world state:\n\n${contextText}`,
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
          systemInstruction:
            'You are the Narrative Architect for Aethern: Echoes of the Living Atlas. Craft a concise, evocative emergent quest (premise under 55 words) with exactly 3 branching choices representing the three factions: order, verdant, and unbound. Explicitly weave the player recalled memory into the premise and make consequences distinct and meaningful.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              premise: { type: Type.STRING },
              memoryAnchor: { type: Type.STRING },
              choices: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    label: { type: Type.STRING },
                    stance: { type: Type.STRING },
                    consequencePreview: { type: Type.STRING },
                    narrativeOutcome: { type: Type.STRING },
                    memoryImprint: { type: Type.STRING },
                    orderDelta: { type: Type.INTEGER },
                    verdantDelta: { type: Type.INTEGER },
                    unboundDelta: { type: Type.INTEGER },
                    stabilityDelta: { type: Type.INTEGER },
                    shardReward: { type: Type.INTEGER },
                    healAmount: { type: Type.INTEGER },
                    moodShift: { type: Type.STRING },
                    spawnSentinelWave: { type: Type.BOOLEAN },
                  },
                  required: [
                    'id',
                    'label',
                    'stance',
                    'consequencePreview',
                    'narrativeOutcome',
                    'memoryImprint',
                    'orderDelta',
                    'verdantDelta',
                    'unboundDelta',
                    'stabilityDelta',
                    'shardReward',
                    'healAmount',
                    'moodShift',
                  ],
                },
              },
            },
            required: ['title', 'premise', 'memoryAnchor', 'choices'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      const validMoods = ['wonder', 'mystery', 'tension', 'melancholy', 'triumph'];
      const validStances = ['order', 'verdant', 'unbound', 'neutral'];

      const quest = {
        id: `carbon-${Date.now()}`,
        title: String(parsed.title || 'Echo of the Living Atlas').slice(0, 90),
        shrineId: shrineId || 'shrine-astrolabe',
        shrineName: shrineName || 'Astrolabe Spire',
        premise: String(parsed.premise || '').slice(0, 420),
        memoryAnchor: String(parsed.memoryAnchor || '').slice(0, 220),
        source: 'gemini-carbon' as const,
        status: 'active' as const,
        createdAt: Date.now(),
        choices: Array.isArray(parsed.choices)
          ? parsed.choices.slice(0, 3).map((c: Record<string, unknown>, idx: number) => {
              const stance = validStances.includes(String(c.stance))
                ? String(c.stance)
                : (['order', 'verdant', 'unbound'][idx] ?? 'neutral');
              const moodShift = validMoods.includes(String(c.moodShift))
                ? String(c.moodShift)
                : 'wonder';
              return {
                id: String(c.id || `choice-${idx}`).slice(0, 40),
                label: String(c.label || `Path ${idx + 1}`).slice(0, 72),
                stance,
                consequencePreview: String(c.consequencePreview || 'Shifts world balance').slice(0, 96),
                narrativeOutcome: String(c.narrativeOutcome || 'The sanctuary answers your decree.').slice(0, 260),
                memoryImprint: String(c.memoryImprint || 'Shaped the sanctuary meridian.').slice(0, 260),
                effects: {
                  orderDelta: Math.max(-30, Math.min(30, Number(c.orderDelta || 0))),
                  verdantDelta: Math.max(-30, Math.min(30, Number(c.verdantDelta || 0))),
                  unboundDelta: Math.max(-30, Math.min(30, Number(c.unboundDelta || 0))),
                  stabilityDelta: Math.max(-25, Math.min(25, Number(c.stabilityDelta || 0))),
                  shardReward: Math.max(10, Math.min(80, Number(c.shardReward || 25))),
                  healAmount: Math.max(0, Math.min(50, Number(c.healAmount || 15))),
                  moodShift,
                  spawnSentinelWave: Boolean(c.spawnSentinelWave),
                },
              };
            })
          : [],
      };

      return res.json({ quest });
    } catch (err) {
      const { status, message } = extractApiError(err);
      return res.status(status).json({ error: message });
    }
  });

  // 2. Semantic Vector Embeddings (gemini-embedding-2)
  app.post('/api/embeddings', async (req, res) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required.' });
      }
      const ai = getGenAIClient();
      const result = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: [text.slice(0, 600)],
      });
      const values = result.embeddings?.[0]?.values ?? [];
      return res.json({ embedding: values });
    } catch (err) {
      const { status, message } = extractApiError(err);
      return res.status(status).json({ error: message });
    }
  });

  // 3. Adaptive Music Generation (lyria-3-clip-preview / lyria-3-pro-preview)
  app.post('/api/music/generate', async (req, res) => {
    try {
      const { prompt, mode } = req.body as {
        prompt?: string;
        mode?: 'clip' | 'pro';
      };
      const cleanPrompt = (
        prompt ||
        'Atmospheric sunlit fantasy highland sanctuary orchestral ambient track with bronze bells, cello, and warm wooden flutes.'
      ).slice(0, 500);
      const model =
        mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

      const ai = getGenAIClient();
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: cleanPrompt,
      });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (audioChunks.length === 0) {
        return res.status(502).json({
          error: 'Lyria returned no audio stream chunks for this prompt.',
        });
      }

      const audioBase64 = Buffer.concat(audioChunks).toString('base64');
      const audioDataUrl = `data:${mimeType};base64,${audioBase64}`;
      return res.json({ audioDataUrl, lyrics: lyrics.trim(), model });
    } catch (err) {
      const { status, message } = extractApiError(err);
      return res.status(status).json({ error: message });
    }
  });

  // Vite middleware in dev; static dist serving in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // 4. Real-Time Voice Oracle WebSocket Bridge (gemini-3.8-live)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url?.split('?')[0];
    if (urlPath === '/api/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;

    try {
      const ai = getGenAIClient();
      const parsedUrl = new URL(req.url || '/api/live', `http://localhost:${PORT}`);
      const worldContext = (
        parsedUrl.searchParams.get('context') ||
        'The player stands in the Sunlit Highland Observatory of Aethern.'
      ).slice(0, 600);

      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          },
          systemInstruction: `You are the Living Atlas Oracle inside the 3D game Aethern. Speak concisely (1-3 evocative sentences) to guide the player based on their vector memories and choices. Current state: ${worldContext}`,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ inputTranscript: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ outputTranscript: content.outputTranscription.text })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onerror: (e: unknown) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error: e instanceof Error ? e.message : 'Live session error',
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ closed: true }));
            }
          },
        },
      });

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ ready: true }));
      }
    } catch (err) {
      const { message } = extractApiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: message }));
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (rawData) => {
      if (!liveSession) return;
      try {
        const payload = JSON.parse(rawData.toString()) as {
          audio?: string;
          text?: string;
        };
        if (payload.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (payload.text) {
          liveSession.sendRealtimeInput({ text: payload.text });
        }
      } catch {
        // Ignore malformed frame
      }
    });

    clientWs.on('close', () => {
      try {
        liveSession?.close();
      } catch {
        // Already closed
      }
      liveSession = null;
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Aethern server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
