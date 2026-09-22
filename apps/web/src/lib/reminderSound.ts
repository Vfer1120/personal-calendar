let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  audioContext ??= new Constructor();
  return audioContext;
}

export async function unlockReminderSound(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return false;
  try { if (context.state === "suspended") await context.resume(); return context.state === "running"; } catch { return false; }
}

export async function playReminderSound(): Promise<boolean> {
  const context = getAudioContext();
  if (!context || !(await unlockReminderSound())) return false;
  const start = context.currentTime;
  for (const [offset, frequency] of [[0, 880], [0.18, 660]] as const) {
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start + offset); oscillator.stop(start + offset + 0.18);
  }
  return true;
}