import { ensureWasm } from "../goban/init-wasm";
import { readFileAsText, type SgfMeta } from "./sgf";

const VALID_SIZES = [9, 13, 19];

export type ParsedSgf = {
  meta: SgfMeta;
  size: number;
  text: string;
};

export type ParseSgfResult =
  { ok: true; value: ParsedSgf } | { ok: false; error: string };

// Pure validation of parsed SGF metadata; parseSgfFile feeds it the output of
// the WASM parser. Split out so the branching can be unit-tested without WASM.
export function validateSgfMeta(
  meta: SgfMeta,
): { ok: true; size: number } | { ok: false; error: string } {
  if (meta.error) {
    return { ok: false, error: `SGF error: ${meta.error}` };
  }

  if (meta.cols !== meta.rows) {
    return { ok: false, error: "Non-square boards are not supported." };
  }

  if (!VALID_SIZES.includes(meta.cols)) {
    return {
      ok: false,
      error: `Unsupported board size: ${meta.cols}×${meta.cols}`,
    };
  }

  return { ok: true, size: meta.cols };
}

export async function parseSgfFile(file: File): Promise<ParseSgfResult> {
  let text: string;

  try {
    text = await readFileAsText(file);
  } catch {
    return { ok: false, error: "Could not read the SGF file." };
  }

  const wasm = await ensureWasm();
  const metaJson = wasm.parse_sgf(text);
  const meta: SgfMeta = JSON.parse(metaJson);
  const validated = validateSgfMeta(meta);

  if (!validated.ok) {
    return validated;
  }

  return { ok: true, value: { meta, size: validated.size, text } };
}
