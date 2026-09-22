function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value)) return null;
  const expanded = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16)];
}

function relativeLuminance(color: [number, number, number]): number {
  const channels = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(left: string, right: string): number {
  const first = parseHex(left); const second = parseHex(right);
  if (!first || !second) return 0;
  const firstLuminance = relativeLuminance(first); const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance); const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextColor(background: string, light = "#ffffff", dark = "#1c1917"): string {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}