export type SgfMeta = {
  cols: number;
  rows: number;
  komi?: number;
  handicap?: number;
  black_name?: string;
  white_name?: string;
  game_name?: string;
  result?: string;
  time_limit_secs?: number;
  overtime?: string;
  error?: string;
};

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadSgf(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/x-go-sgf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
