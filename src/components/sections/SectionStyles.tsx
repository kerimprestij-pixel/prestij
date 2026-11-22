// Keyframes and reveal styles used by the sections. React 19 hoists a <style> with `href` +
// `precedence` into <head> and de-duplicates it, so any section can render this safely.
// Hero entrance: the copy lines fade up one after another, 0.1 s apart. A page-title hero puts its
// eyebrow and headline inside one <h1> (Hero.tsx): those two spans animate as their own steps and the
// lines after the <h1> move one step later, so the timing is the same as with separate elements.
const css = `
@keyframes prestij-hero-zoom { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes prestij-fade-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.prestij-hero-media { transform-origin: 50% 40%; animation: prestij-hero-zoom 3.2s cubic-bezier(.16,1,.3,1) both; }
.prestij-hero-copy > *, .prestij-hero-copy > h1 > span { animation: prestij-fade-up .9s cubic-bezier(.16,1,.3,1) both; }
.prestij-hero-copy > :nth-child(2) { animation-delay: .1s; }
.prestij-hero-copy > :nth-child(3) { animation-delay: .2s; }
.prestij-hero-copy > :nth-child(4) { animation-delay: .3s; }
.prestij-hero-copy > h1 { animation: none; }
.prestij-hero-copy > h1 > span + span { animation-delay: .1s; }
.prestij-hero-copy > h1:has(> span + span) ~ :nth-child(2) { animation-delay: .2s; }
.prestij-hero-copy > h1:has(> span + span) ~ :nth-child(3) { animation-delay: .3s; }
[data-reveal] { transition: opacity 1s cubic-bezier(.16,1,.3,1), transform 1s cubic-bezier(.16,1,.3,1); transition-delay: var(--reveal-delay, 0ms); }
[data-reveal="pending"] { opacity: 0; transform: translateY(28px); }
@media (prefers-reduced-motion: reduce) {
  .prestij-hero-media, .prestij-hero-copy > *, .prestij-hero-copy > h1 > span { animation: none; }
  [data-reveal] { transition: none; }
  [data-reveal="pending"] { opacity: 1; transform: none; }
}
`;

export default function SectionStyles() {
  return (
    <style href="prestij-sections" precedence="default">
      {css}
    </style>
  );
}
