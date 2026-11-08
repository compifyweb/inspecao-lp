// Ícones em um sprite único (ICO-04). Três tamanhos: 16, 24 e 32 (ICO-03).
const SPRITE = new URL('../icons/sprite.svg', import.meta.url).href;

export function icone(nome, tamanho = 16, { bold = false } = {}) {
  return `<svg class="i i-${tamanho}${bold ? ' i-bold' : ''}" aria-hidden="true"><use href="${SPRITE}#${nome}"></use></svg>`;
}
