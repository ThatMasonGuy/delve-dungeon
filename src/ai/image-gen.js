// ═══════════════════════════════════════════════════════════════
// IMAGE GEN — Generate dungeon artwork via DALL-E 3
// ═══════════════════════════════════════════════════════════════

import OpenAI from 'openai';
import { config } from '../config.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const IMAGE_DIR = './data/images';

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}

/**
 * Generate a dungeon artwork image via DALL-E 3.
 * Downloads the result and saves it locally.
 *
 * @param {object} dungeon - Dungeon row from DB
 * @returns {string|null} Local file path, or null on failure
 */
export async function generateDungeonImage(dungeon) {
  try {
    // Ensure directory exists
    if (!existsSync(IMAGE_DIR)) {
      mkdirSync(IMAGE_DIR, { recursive: true });
    }

    const filename = `dungeon-${dungeon.id}-${Date.now()}.png`;
    const filepath = join(IMAGE_DIR, filename);

    const prompt = buildImagePrompt(dungeon);
    console.log(`[IMAGE] Generating image for "${dungeon.name}"...`);

    const response = await getClient().images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      style: 'vivid',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      console.error('[IMAGE] No URL returned from DALL-E');
      return null;
    }

    // Download the image (DALL-E URLs expire after ~1hr)
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`[IMAGE] Failed to download: ${imageResponse.status}`);
      return null;
    }

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    writeFileSync(filepath, buffer);

    console.log(`[IMAGE] ✅ Saved: ${filepath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return filepath;

  } catch (err) {
    console.error('[IMAGE] Generation failed:', err.message);
    return null;
  }
}

/**
 * Build a DALL-E prompt from dungeon data.
 */
function buildImagePrompt(dungeon) {
  return `Dark fantasy dungeon illustration in a painterly digital art style. Top-down isometric view of a multi-level underground dungeon.

Setting: ${dungeon.theme}

The image should show a cross-section or bird's-eye view of the dungeon with ${dungeon.floor_count} distinct floor levels connected by stairs or passages going deeper. Each floor should have visible rooms connected by corridors. The deeper floors should feel more dangerous and oppressive.

Style: dark, atmospheric, detailed environment art. Muted colors with accent lighting from torches, bioluminescent elements, or magical sources. No text, no UI elements, no characters. Think dark souls concept art meets old-school D&D dungeon maps. Painterly, moody, high detail.`;
}
