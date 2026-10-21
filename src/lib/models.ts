/**
 * Konfigurasi model AI.
 *
 * PENTING: pastikan ID model masih valid di https://openrouter.ai/models
 * (daftar model OpenRouter berkembang dan beberapa model pensiun).
 *
 * Urutannya bisa diubah lewat environment variable MODEL_CHAIN dan
 * FALLBACK_MODEL tanpa mengedit kode (lihat .env.example).
 */
export interface ModelInfo {
  /** ID model OpenRouter. */
  id: string;
  /** Nama aman untuk tampil di UI ("x/..." -> "X ..."). */
  label: string;
}

const DEFAULT_CHAIN: ModelInfo[] = [
  { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini" },
  { id: "google/gemini-2.0-flash-001", label: "Google Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
];

export function getModelChain(): ModelInfo[] {
  const raw = (process.env.MODEL_CHAIN ?? "").trim();
  if (!raw) return DEFAULT_CHAIN;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = ids.map((id) => parseModelEntry(id));
  return list.length > 0 ? list : DEFAULT_CHAIN;
}

export function getFallbackModel(): ModelInfo {
  const raw = (process.env.FALLBACK_MODEL ?? "").trim() || "openrouter/auto";
  return parseModelEntry(raw);
}

function parseModelEntry(id: string): ModelInfo {
  // Izinkan format "id|Label Tampilan" agar kredensial config mudah diedit.
  const [modelId, ...rest] = id.split("|");
  const clean = modelId.trim();
  return { id: clean, label: rest.join("|").trim() || prettyName(clean) };
}

function prettyName(id: string): string {
  const [vendor, model] = id.split("/");
  const name = (model ?? id).replace(/[-:]/g, " ");
  const vendorPretty = (vendor ?? "").replace(/-/g, " ");
  return vendorPretty
    ? `${capitalize(vendorPretty)} — ${titleCase(name)}`
    : titleCase(name);
}

function capitalize(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}
