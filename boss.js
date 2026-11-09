// The nightly pests. Original characters, drawn as inline SVG and recoloured per boss number.

const ROSTER = [
  { name: "Gnawgrub", title: "the Root Eater", body: "#7FB24A", spot: "#4E7F2B", belly: "#CDE6A2" },
  { name: "Mildew Matron", title: "of the Damp Shed", body: "#9AA0B5", spot: "#666C82", belly: "#DADDE8" },
  { name: "Baron Blight", title: "Lord of Brown Leaves", body: "#9A6240", spot: "#5E3A26", belly: "#D9AA82" },
  { name: "Frostmoth", title: "the Night Chill", body: "#86C3E6", spot: "#4F8FB8", belly: "#E1F2FB" },
  { name: "Aphid Empress", title: "Queen of a Thousand", body: "#C64F8E", spot: "#8C2C60", belly: "#F3B6D5" },
  { name: "Rotroot", title: "the Patient", body: "#6E4F92", spot: "#47306A", belly: "#C6AEE3" },
];

export function bossInfo(id) {
  const n = Number(id);
  const r = ROSTER[n % ROSTER.length];
  const gen = Math.floor(n / ROSTER.length);
  return { ...r, name: gen ? `${r.name} ${["", "II", "III", "IV", "V", "VI"][gen] ?? `#${gen + 1}`}` : r.name, crowned: n % ROSTER.length === 4 || gen > 0 };
}

export function bossSvg(id) {
  const b = bossInfo(id);
  const crown = b.crowned
    ? `<path d="M128 46 L138 22 L150 40 L160 16 L170 40 L182 22 L192 46 Z" fill="#F2C14E" stroke="#8A6414" stroke-width="3" stroke-linejoin="round"/>`
    : "";
  return `<svg viewBox="0 0 320 260" class="boss-svg" role="img" aria-label="${b.name}">
    <ellipse cx="160" cy="238" rx="110" ry="14" fill="#000" opacity=".28"/>
    <g class="legs" stroke="#2b2118" stroke-width="7" stroke-linecap="round" fill="none">
      <path d="M78 196 Q52 214 46 236"/><path d="M104 214 Q92 230 90 242"/>
      <path d="M242 196 Q268 214 274 236"/><path d="M216 214 Q228 230 230 242"/>
    </g>
    <g class="antennae" stroke="#2b2118" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M128 66 Q108 30 90 26"/><path d="M192 66 Q212 30 230 26"/>
    </g>
    <circle cx="90" cy="26" r="9" fill="${b.spot}"/><circle cx="230" cy="26" r="9" fill="${b.spot}"/>
    ${crown}
    <ellipse cx="160" cy="150" rx="124" ry="96" fill="${b.body}" stroke="#2b2118" stroke-width="5"/>
    <ellipse cx="160" cy="184" rx="78" ry="48" fill="${b.belly}"/>
    <g fill="${b.spot}" opacity=".85">
      <circle cx="70" cy="128" r="14"/><circle cx="252" cy="122" r="11"/><circle cx="94" cy="88" r="9"/>
      <circle cx="232" cy="176" r="12"/><circle cx="84" cy="182" r="8"/>
    </g>
    <g class="eyes">
      <g class="eye-open">
        <ellipse cx="124" cy="118" rx="24" ry="27" fill="#fff" stroke="#2b2118" stroke-width="4"/>
        <ellipse cx="196" cy="118" rx="24" ry="27" fill="#fff" stroke="#2b2118" stroke-width="4"/>
        <circle class="pupil" cx="130" cy="124" r="10" fill="#2b2118"/>
        <circle class="pupil" cx="190" cy="124" r="10" fill="#2b2118"/>
        <circle cx="134" cy="119" r="3" fill="#fff"/><circle cx="194" cy="119" r="3" fill="#fff"/>
      </g>
      <g class="eye-hit" stroke="#2b2118" stroke-width="6" stroke-linecap="round">
        <path d="M110 104 L138 132 M138 104 L110 132"/><path d="M182 104 L210 132 M210 104 L182 132"/>
      </g>
      <path d="M98 86 L146 100 M222 86 L174 100" stroke="#2b2118" stroke-width="7" stroke-linecap="round"/>
    </g>
    <path class="mouth" d="M118 170 Q160 200 202 170 Q160 186 118 170 Z" fill="#2b2118"/>
    <path d="M136 176 L142 188 L148 178 M172 178 L178 188 L184 176" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}
