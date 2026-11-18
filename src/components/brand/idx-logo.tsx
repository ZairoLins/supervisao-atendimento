/**
 * Logo IDX redesenhado em vetor (nítido em qualquer tamanho).
 * "i" com ponto azul, "D" branco e "X" com a diagonal azul à frente do traço branco.
 * Sempre sobre fundo preto, como no original.
 */

export const IDX_BLUE = "#1A8CFF";

/** Letras do logo no sistema de coordenadas original (área útil 108–446 × 186–366). */
export function IdxGlyphs() {
  return (
    <>
      {/* i */}
      <rect x="108" y="216" width="27" height="26" fill={IDX_BLUE} />
      <rect x="108" y="252" width="27" height="84" fill="#fff" />
      {/* D */}
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M152 216H206C240 216 263 243 263 276C263 309 240 336 206 336H152Z M178 242V310H205C225 310 237 295 237 276C237 257 225 242 205 242Z"
      />
      {/* X: traço branco atrás, diagonal azul à frente (contorno preto separa as duas) */}
      <path fill="#fff" d="M320 216H352L435 336H403Z" />
      <path fill={IDX_BLUE} stroke="#000" strokeWidth="7" strokeLinejoin="miter" paintOrder="stroke" d="M226 366H263L447 186H410Z" />
    </>
  );
}

/** Ícone quadrado (fundo preto arredondado), para o menu e a aba do navegador. */
export function IdxMark({ className = "size-8", title = "IDX" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 554 554" className={className} role="img" aria-label={title}>
      <rect width="554" height="554" rx="120" fill="#000" />
      <g transform="translate(-96.8 -95.6) scale(1.35)">
        <IdxGlyphs />
      </g>
    </svg>
  );
}
