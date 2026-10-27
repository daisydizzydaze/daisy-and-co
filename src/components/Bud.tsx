export type Mood = 'happy' | 'cheer' | 'think' | 'worried';

const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];

const MOUTH: Record<Mood, string> = {
  happy: 'M52 66 Q60 74 68 66',
  cheer: 'M51 65 Q60 79 69 65 Z',
  think: 'M54 69 L66 68',
  worried: 'M56.5 70 a3.5 3.5 0 1 0 7 0 a3.5 3.5 0 1 0 -7 0',
};

const LABEL: Record<Mood, string> = {
  happy: 'Bud is smiling',
  cheer: 'Bud is cheering',
  think: 'Bud is thinking',
  worried: 'Bud looks a little worried',
};

/** Bud, the daisy. Draws itself in once with ink, then stays still. */
export function Bud({ mood = 'happy', size = 88, coin = false }: { mood?: Mood; size?: number; coin?: boolean }) {
  const eyesOpen = mood !== 'cheer';
  const lx = mood === 'think' ? 55 : 52;
  const rx = mood === 'think' ? 71 : 68;
  return (
    <svg className="ink" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={LABEL[mood]}>
      <g fill="#FFFFFF" stroke="var(--ink)" strokeWidth="2">
        {PETALS.map((r) => (
          <ellipse key={r} cx="60" cy="35" rx="11" ry="18" transform={`rotate(${r} 60 62)`} />
        ))}
      </g>
      <circle cx="60" cy="62" r="23" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="2" />
      {eyesOpen ? (
        <g>
          <circle cx={lx} cy="58" r="3" fill="var(--ink)" />
          <circle cx={rx} cy="58" r="3" fill="var(--ink)" />
        </g>
      ) : (
        <path d="M49 58 Q52 52 55 58 M65 58 Q68 52 71 58" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      )}
      {mood === 'worried' && <path d="M48 49 L56 52 M72 49 L64 52" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />}
      <circle cx="46" cy="67" r="3.6" fill="var(--pink)" />
      <circle cx="74" cy="67" r="3.6" fill="var(--pink)" />
      <path d={MOUTH[mood]} fill={mood === 'cheer' ? 'var(--ink)' : 'none'} stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {mood === 'cheer' && (
        <g fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round">
          <path d="M12 8 V20 M6 14 H18" />
          <path d="M106 8 V18 M101 13 H111" />
        </g>
      )}
      {mood === 'think' && (
        <g>
          <circle cx="104" cy="16" r="12" fill="#FFFFFF" stroke="var(--ink)" strokeWidth="2" />
          <path d="M100 12 Q100 7 104 7 Q109 7 109 12 Q109 15 104 17 V19" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="104" cy="23" r="1.4" fill="var(--ink)" />
        </g>
      )}
      {coin && (
        <g>
          <circle cx="100" cy="100" r="13" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="100" cy="100" r="8.5" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
          <path d="M100 95 V105" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
