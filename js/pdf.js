// Gerador de PDF sem dependências, para rodar no celular e sem internet.
// As fotos entram como JPEG direto no arquivo: sem recomprimir e sem carregar tudo na memória.

export const A4 = { largura: 595.28, altura: 841.89 };
const TRACO_PESO_MEDIO = 0.015;

// Larguras da Helvetica, de 32 a 126, em milésimos do tamanho da fonte.
const LARGURAS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Caracteres do intervalo 0x80 a 0x9F da codificação usada pelas fontes padrão do PDF.
const WINDOWS_1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function textoEmHex(texto) {
  let hex = '';
  for (const letra of texto.normalize('NFC')) {
    const codigo = letra.codePointAt(0);
    let byte = 0x3f; // Fora da fonte padrão sai como interrogação, nunca como quadrado preto.
    if ((codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff)) byte = codigo;
    else if (WINDOWS_1252.has(codigo)) byte = WINDOWS_1252.get(codigo);
    else if (/\s/.test(letra)) byte = 0x20;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function larguraTexto(texto, tamanho) {
  let total = 0;
  for (const letra of texto.normalize('NFC')) {
    const base = letra.normalize('NFD').charCodeAt(0);
    total += base >= 32 && base <= 126 ? LARGURAS[base - 32] : 556;
  }
  return (total * tamanho) / 1000;
}

export function quebrarLinhas(texto, largura, tamanho) {
  const cabe = (t) => larguraTexto(t, tamanho) <= largura;
  const linhas = [];
  let atual = '';
  for (const palavra of texto.trim().split(/\s+/)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (cabe(tentativa)) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    let resto = palavra;
    while (!cabe(resto)) {
      let n = resto.length - 1;
      while (n > 1 && !cabe(resto.slice(0, n))) n -= 1;
      linhas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export async function dimensoesJpeg(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 131072).arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Arquivo não é JPEG');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marca = bytes[i + 1];
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { altura: (bytes[i + 5] << 8) | bytes[i + 6], largura: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  throw new Error('JPEG sem dimensões');
}

const n = (valor) => Number(valor.toFixed(2)).toString();

function corEmRgb(hex) {
  return [1, 3, 5].map((i) => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
}

export class DocumentoPdf {
  constructor({ titulo }) {
    this.titulo = titulo;
    this.paginas = [];
    this.imagens = [];
    this.atual = null;
  }

  get totalDePaginas() {
    return this.paginas.length;
  }

  novaPagina() {
    this.atual = { ops: [], imagens: new Set() };
    this.paginas.push(this.atual);
  }

  irParaPagina(indice) {
    this.atual = this.paginas[indice];
  }

  registrarImagem(blob, largura, altura) {
    this.imagens.push({ blob, largura, altura });
    return this.imagens.length - 1;
  }

  // Coordenadas com origem no canto superior esquerdo, como na tela.
  // A Helvetica padrão só tem regular e negrito: o peso 500 sai de um traço fino na cor da letra.
  texto(x, y, conteudo, { tamanho, cor, peso = 400, tracking = 0 }) {
    const rgb = corEmRgb(cor);
    const texto = `BT /F1 ${n(tamanho)} Tf ${rgb} rg ${n(x)} ${n(A4.altura - y)} Td <${textoEmHex(conteudo)}> Tj ET`;
    const ajustes = [peso === 500 && `${rgb} RG ${n(tamanho * TRACO_PESO_MEDIO)} w 2 Tr`, tracking && `${n(tamanho * tracking)} Tc`].filter(Boolean);
    this.atual.ops.push(ajustes.length ? `q ${ajustes.join(' ')} ${texto} Q` : texto);
  }

  caminhoRetangulo(x, y, largura, altura, raio) {
    const base = A4.altura - y - altura;
    if (!raio) return `${n(x)} ${n(base)} ${n(largura)} ${n(altura)} re`;
    const k = raio * 0.5523;
    const dir = x + largura;
    const topo = base + altura;
    return [
      `${n(x + raio)} ${n(base)} m`,
      `${n(dir - raio)} ${n(base)} l`,
      `${n(dir - raio + k)} ${n(base)} ${n(dir)} ${n(base + raio - k)} ${n(dir)} ${n(base + raio)} c`,
      `${n(dir)} ${n(topo - raio)} l`,
      `${n(dir)} ${n(topo - raio + k)} ${n(dir - raio + k)} ${n(topo)} ${n(dir - raio)} ${n(topo)} c`,
      `${n(x + raio)} ${n(topo)} l`,
      `${n(x + raio - k)} ${n(topo)} ${n(x)} ${n(topo - raio + k)} ${n(x)} ${n(topo - raio)} c`,
      `${n(x)} ${n(base + raio)} l`,
      `${n(x)} ${n(base + raio - k)} ${n(x + raio - k)} ${n(base)} ${n(x + raio)} ${n(base)} c h`,
    ].join(' ');
  }

  retangulo(x, y, largura, altura, { cor, raio = 0 }) {
    this.atual.ops.push(`${corEmRgb(cor)} rg ${this.caminhoRetangulo(x, y, largura, altura, raio)} f`);
  }

  contorno(x, y, largura, altura, { cor, raio = 0, espessura = 0.75 }) {
    this.atual.ops.push(`${corEmRgb(cor)} RG ${n(espessura)} w ${this.caminhoRetangulo(x, y, largura, altura, raio)} S`);
  }

  linha(x1, y, x2, { cor, espessura = 0.75 }) {
    const base = A4.altura - y;
    this.atual.ops.push(`${corEmRgb(cor)} RG ${n(espessura)} w ${n(x1)} ${n(base)} m ${n(x2)} ${n(base)} l S`);
  }

  imagem(indice, x, y, largura, altura, { raio = 0 } = {}) {
    this.atual.imagens.add(indice);
    const recorte = raio ? `${this.caminhoRetangulo(x, y, largura, altura, raio)} W n` : '';
    this.atual.ops.push(`q ${recorte} ${n(largura)} 0 0 ${n(altura)} ${n(x)} ${n(A4.altura - y - altura)} cm /Im${indice} Do Q`);
  }

  gerarBlob() {
    const partes = [];
    const posicoes = [];
    let posicao = 0;
    const escrever = (ascii) => {
      partes.push(ascii);
      posicao += ascii.length;
    };
    const objeto = (numero, conteudo) => {
      posicoes[numero] = posicao;
      escrever(`${numero} 0 obj\n${conteudo}\nendobj\n`);
    };

    // Numeração: 1 catálogo, 2 páginas, 3 fonte, 4 informações, depois imagens e páginas.
    const primeiraImagem = 5;
    const primeiraPagina = primeiraImagem + this.imagens.length;
    const numeroDaPagina = (i) => primeiraPagina + i * 2;

    escrever('%PDF-1.4\n');
    partes.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    posicao += 6;

    objeto(1, '<< /Type /Catalog /Pages 2 0 R /Lang (pt-BR) /ViewerPreferences << /DisplayDocTitle true >> >>');
    const filhos = this.paginas.map((_, i) => `${numeroDaPagina(i)} 0 R`).join(' ');
    objeto(2, `<< /Type /Pages /Kids [${filhos}] /Count ${this.paginas.length} >>`);
    objeto(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objeto(4, `<< /Title <FEFF${[...this.titulo].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}> /Producer (Inspecao LP) >>`);

    this.imagens.forEach((imagem, i) => {
      const numero = primeiraImagem + i;
      posicoes[numero] = posicao;
      escrever(
        `${numero} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imagem.largura} /Height ${imagem.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imagem.blob.size} >>\nstream\n`,
      );
      partes.push(imagem.blob);
      posicao += imagem.blob.size;
      escrever('\nendstream\nendobj\n');
    });

    this.paginas.forEach((pagina, i) => {
      const numero = numeroDaPagina(i);
      const usadas = [...pagina.imagens].map((indice) => `/Im${indice} ${primeiraImagem + indice} 0 R`).join(' ');
      objeto(
        numero,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] /Contents ${numero + 1} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << ${usadas} >> >> >>`,
      );
      const conteudo = pagina.ops.join('\n');
      objeto(numero + 1, `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
    });

    const inicioXref = posicao;
    const total = primeiraPagina + this.paginas.length * 2;
    const entradas = ['0000000000 65535 f \n'];
    for (let numero = 1; numero < total; numero += 1) entradas.push(`${String(posicoes[numero]).padStart(10, '0')} 00000 n \n`);
    escrever(`xref\n0 ${total}\n${entradas.join('')}trailer\n<< /Size ${total} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

    return new Blob(partes, { type: 'application/pdf' });
  }
}
