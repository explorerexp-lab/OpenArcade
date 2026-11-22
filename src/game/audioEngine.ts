import type { SoundMood } from './types';

const SCALES: Record<SoundMood, number[]> = {
  wonder: [220, 246.94, 277.18, 311.13, 329.63, 369.99, 440], // A Lydian
  mystery: [196, 220, 233.08, 261.63, 293.66, 329.63, 392], // G Dorian
  tension: [164.81, 174.61, 196, 220, 246.94, 261.63, 329.63], // E Phrygian
  melancholy: [174.61, 196, 207.65, 233.08, 261.63, 277.18, 349.23], // F Aeolian
  triumph: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33], // C Pentatonic Bright
};

/**
 * 100% On-device procedural Web Audio adaptive soundscape & weight-scaled SFX engine.
 * Morphs harmonic modes, drone filtering, and arpeggio cadence in real time based on
 * narrative mood and enemy threat proximity without external audio assets.
 */
export class AdaptiveAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private sequencerTimer: number | null = null;

  private muted = false;
  private ducked = false;
  private mood: SoundMood = 'wonder';
  private threat = 0;
  private stepIdx = 0;

  public start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.45;
    this.masterGain.connect(this.ctx.destination);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.28;

    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 520;
    this.droneFilter.Q.value = 1.6;
    this.droneFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);

    // Warm dual-detuned harmonic drone pad
    this.droneOsc1 = this.ctx.createOscillator();
    this.droneOsc1.type = 'triangle';
    this.droneOsc1.frequency.value = 110;
    this.droneOsc1.connect(this.droneFilter);
    this.droneOsc1.start();

    this.droneOsc2 = this.ctx.createOscillator();
    this.droneOsc2.type = 'sine';
    this.droneOsc2.frequency.value = 164.81;
    this.droneOsc2.connect(this.droneFilter);
    this.droneOsc2.start();

    this.sequencerTimer = window.setInterval(() => this.tickGenerativeNote(), 680);
  }

  public setMood(mood: SoundMood): void {
    this.mood = mood;
    if (!this.ctx || !this.droneOsc1 || !this.droneOsc2) return;
    const scale = SCALES[mood];
    const now = this.ctx.currentTime;
    this.droneOsc1.frequency.setTargetAtTime(scale[0] * 0.5, now, 1.2);
    this.droneOsc2.frequency.setTargetAtTime(scale[4] * 0.5, now, 1.2);
  }

  public setThreat(threat: number): void {
    this.threat = Math.max(0, Math.min(1, threat));
    if (!this.ctx || !this.droneFilter) return;
    const targetFreq = 420 + this.threat * 950;
    this.droneFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.35);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.08);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setDucked(ducked: boolean): void {
    this.ducked = ducked;
    if (this.ctx && this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime(ducked ? 0.04 : 0.28, this.ctx.currentTime, 0.25);
    }
  }

  private tickGenerativeNote(): void {
    if (!this.ctx || !this.ambientGain || this.muted || this.ducked || this.ctx.state !== 'running') {
      return;
    }
    const activeMood: SoundMood = this.threat > 0.55 ? 'tension' : this.mood;
    const scale = SCALES[activeMood];
    const now = this.ctx.currentTime;

    // Gentle modal chime / harp plucks
    const pattern = [0, 2, 4, 3, 5, 4, 6, 2];
    const noteFreq = scale[pattern[this.stepIdx % pattern.length]];
    this.stepIdx++;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = this.threat > 0.5 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(noteFreq, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this.threat > 0.5 ? 1100 : 1800, now);

    const peak = this.threat > 0.5 ? 0.09 : 0.07;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.ambientGain);
    osc.start(now);
    osc.stop(now + 1.2);

    // Subtle percussive tension heartbeat when sentinels are close
    if (this.threat > 0.35 && this.stepIdx % 2 === 0) {
      const kick = this.ctx.createOscillator();
      const kEnv = this.ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(98, now);
      kick.frequency.exponentialRampToValueAtTime(38, now + 0.14);
      kEnv.gain.setValueAtTime(0.18 * this.threat, now);
      kEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      kick.connect(kEnv);
      kEnv.connect(this.ambientGain);
      kick.start(now);
      kick.stop(now + 0.18);
    }
  }

  public playSfx(
    kind:
      | 'jump'
      | 'land'
      | 'dash'
      | 'strike'
      | 'enemy_telegraph'
      | 'enemy_hit'
      | 'enemy_ko'
      | 'player_hurt'
      | 'quest_complete',
    weight = 0.5
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    const jitter = 0.92 + Math.random() * 0.16; // ±8% pitch variation

    if (kind === 'quest_complete') {
      const chord = [329.63, 440, 554.37, 659.25];
      chord.forEach((freq, idx) => {
        if (!this.ctx || !this.masterGain) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, now + idx * 0.08);
        g.gain.setValueAtTime(0.001, now + idx * 0.08);
        g.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.08 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.65);
        o.connect(g);
        g.connect(this.masterGain);
        o.start(now + idx * 0.08);
        o.stop(now + idx * 0.08 + 0.7);
      });
      return;
    }

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.connect(env);
    env.connect(this.masterGain);

    switch (kind) {
      case 'jump':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(210 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(420 * jitter, now + 0.14);
        env.gain.setValueAtTime(0.14, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      case 'land':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(48, now + 0.09);
        env.gain.setValueAtTime(0.16, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.11);
        break;
      case 'dash':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.16);
        env.gain.setValueAtTime(0.13, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
        break;
      case 'strike':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(640 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(260 * jitter, now + 0.18);
        env.gain.setValueAtTime(0.22, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.21);
        break;
      case 'enemy_telegraph':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.35);
        env.gain.setValueAtTime(0.09, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.start(now);
        osc.stop(now + 0.39);
        break;
      case 'enemy_hit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(190 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(65, now + 0.14);
        env.gain.setValueAtTime(0.22 * Math.max(0.5, weight), now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      case 'enemy_ko':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.36);
        env.gain.setValueAtTime(0.28, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
      case 'player_hurt':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(52, now + 0.26);
        env.gain.setValueAtTime(0.28, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
    }
  }

  public dispose(): void {
    if (this.sequencerTimer !== null) {
      window.clearInterval(this.sequencerTimer);
      this.sequencerTimer = null;
    }
    try {
      this.droneOsc1?.stop();
      this.droneOsc2?.stop();
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
  }
}
