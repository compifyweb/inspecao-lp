// Layout do relatório em PDF: cada inspeção seguida das suas fotos.
import { A4, DocumentoPdf, dimensoesJpeg, larguraTexto, quebrarLinhas } from './pdf.js';
import { STATUS, cabecalho, dataCompleta, descricaoPeca, nomeArquivoPdf, rotuloEtapa, textoOf, textoStatus } from './relatorio.js';

const MARGEM = 36;
const LARGURA = A4.largura - MARGEM * 2;
const LIMITE = A4.altura - MARGEM - 28;
const VAO = 8;
const LARGURA_FOTO = (LARGURA - VAO) / 2;
const ALTURA_MAX_FOTO = 225;
const TAG_ALTURA = 20;
const TAG_RECUO = 8;
const RAIO = 8;
const RAIO_INTERNO = 4;

// Mesma escala das telas: 14px na interface equivalem a 10,5pt no papel.
const TIPO = {
  pagina: { tamanho: 24, linha: 34 },
  titulo: { tamanho: 15, linha: 21 },
  corpo: { tamanho: 12, linha: 18 },
  legenda: { tamanho: 10.5, linha: 15 },
};

const linhaBase = (y, tipo) => y + (tipo.linha + tipo.tamanho * 0.7) / 2;
const porCriacao = (a, b) => a.criadoEm - b.criadoEm;
const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// As cores vêm dos tokens do tema, as mesmas das telas (DSY-01).
export function lerCoresDoTema() {
  const estilo = getComputedStyle(document.documentElement);
  const ler = (nome) => estilo.getPropertyValue(nome).trim();
  const tag = (cor) => ({ fundo: ler(`--tag-${cor}-bg`), cor: ler(`--tag-${cor}-text`) });
  return {
    texto: ler('--fgColor-default'),
    apoio: ler('--fgColor-muted'),
    sutil: ler('--fgColor-subtle'),
    faixa: ler('--bgColor-canvas'),
    fio: ler('--bgColor-selected'),
    tags: Object.fromEntries(['verde', 'amarelo', 'laranja', 'neutro'].map((cor) => [cor, tag(cor)])),
  };
}

function medirFoto(foto) {
  const escala = Math.min(LARGURA_FOTO / foto.largura, ALTURA_MAX_FOTO / foto.altura);
  return { indice: foto.indice, largura: foto.largura * escala, altura: foto.altura * escala };
}

// Sem cortar a foto: duas deitadas ou três em pé por linha.
function montarLinhasDeFotos(fotos) {
  const linhas = [];
  let linha = [];
  let usado = 0;
  for (const foto of fotos.map(medirFoto)) {
    if (linha.length && usado + VAO + foto.largura > LARGURA) {
      linhas.push(linha);
      linha = [];
      usado = 0;
    }
    usado += (linha.length ? VAO : 0) + foto.largura;
    linha.push(foto);
  }
  if (linha.length) linhas.push(linha);
  return linhas;
}

const alturaDaLinha = (linha) => Math.max(...linha.map((foto) => foto.altura));

async function registrarFotos(doc, fotos) {
  const porItem = new Map();
  let falhas = 0;
  for (const foto of [...fotos].sort(porCriacao)) {
    try {
      const { largura, altura } = await dimensoesJpeg(foto.blob);
      const indice = doc.registrarImagem(foto.blob, largura, altura);
      porItem.set(foto.itemId, [...(porItem.get(foto.itemId) || []), { indice, largura, altura }]);
    } catch {
      falhas += 1;
    }
  }
  return { porItem, falhas };
}

function etiquetaDoItem(item, cores) {
  if (!item.status) return { rotulo: 'Sem status', ...cores.tags.neutro };
  const meta = STATUS.find((s) => s.valor === item.status);
  return { rotulo: capitalizar(textoStatus(item)), ...cores.tags[meta ? meta.cor : 'neutro'] };
}

const larguraDaTag = ({ rotulo }) => larguraTexto(rotulo, TIPO.legenda.tamanho) + TAG_RECUO * 2;

function desenharTag(doc, x, y, etiqueta) {
  doc.retangulo(x, y, larguraDaTag(etiqueta), TAG_ALTURA, { cor: etiqueta.fundo, raio: RAIO_INTERNO });
  doc.texto(x + TAG_RECUO, y + (TAG_ALTURA + TIPO.legenda.tamanho * 0.7) / 2, etiqueta.rotulo, { tamanho: TIPO.legenda.tamanho, cor: etiqueta.cor });
}

export async function gerarRelatorioPdf({ turno, itens, fotos, cores, resumo }) {
  const doc = new DocumentoPdf({ titulo: `Relatório de inspeção, ${cabecalho(turno)}` });
  const { porItem, falhas } = await registrarFotos(doc, fotos);
  const ordenados = [...itens].sort(porCriacao);
  let y = MARGEM;

  const novaPagina = () => {
    doc.novaPagina();
    y = MARGEM;
  };
  const escrever = (texto, tipo, cor) => {
    doc.texto(MARGEM, linhaBase(y, tipo), texto, { tamanho: tipo.tamanho, cor });
    y += tipo.linha;
  };

  /* Abertura */
  novaPagina();
  escrever('Relatório de inspeção', TIPO.pagina, cores.texto);
  escrever('Líquido penetrante', TIPO.corpo, cores.apoio);
  y += 12;

  const colunaRotulo = 64;
  const larguraValor = LARGURA - RAIO * 3 - colunaRotulo;
  const campos = [
    ['Empresa', turno.cliente],
    ['Data', dataCompleta(turno.data)],
    ['Equipe', turno.equipe],
  ]
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => ({ rotulo, linhas: quebrarLinhas(valor, larguraValor, TIPO.corpo.tamanho) }));
  const alturaFaixa = 24 + campos.reduce((soma, campo) => soma + campo.linhas.length * TIPO.corpo.linha, 0);
  doc.retangulo(MARGEM, y, LARGURA, alturaFaixa, { cor: cores.faixa, raio: RAIO });
  let yCampo = y + 12;
  for (const campo of campos) {
    doc.texto(MARGEM + 12, linhaBase(yCampo, TIPO.corpo), campo.rotulo, { tamanho: TIPO.corpo.tamanho, cor: cores.apoio });
    for (const linha of campo.linhas) {
      doc.texto(MARGEM + 12 + colunaRotulo, linhaBase(yCampo, TIPO.corpo), linha, { tamanho: TIPO.corpo.tamanho, cor: cores.texto });
      yCampo += TIPO.corpo.linha;
    }
  }
  y += alturaFaixa + 16;

  escrever(resumo, TIPO.corpo, cores.texto);
  y += 4;
  const contagens = [
    ...STATUS.map((s) => ({ nome: s.valor, cor: s.cor, total: ordenados.filter((i) => i.status === s.valor).length })),
    { nome: 'Sem status', cor: 'neutro', total: ordenados.filter((i) => !i.status).length },
  ].filter((c) => c.total);
  let xTag = MARGEM;
  for (const contagem of contagens) {
    const etiqueta = { rotulo: `${contagem.nome}: ${contagem.total}`, ...cores.tags[contagem.cor] };
    if (xTag + larguraDaTag(etiqueta) > MARGEM + LARGURA) {
      xTag = MARGEM;
      y += TAG_ALTURA + 4;
    }
    desenharTag(doc, xTag, y, etiqueta);
    xTag += larguraDaTag(etiqueta) + 4;
  }
  y += TAG_ALTURA + 24;

  /* Inspeções */
  ordenados.forEach((item, indice) => {
    const numero = indice + 1;
    const nome = descricaoPeca(item);
    const titulo = quebrarLinhas(nome, LARGURA, TIPO.titulo.tamanho);
    const obs = item.obs ? quebrarLinhas(`Obs: ${item.obs}`, LARGURA, TIPO.corpo.tamanho) : [];
    const linhasDeFotos = montarLinhasDeFotos(porItem.get(item.id) || []);
    const alturaTexto = TAG_ALTURA + 4 + titulo.length * TIPO.titulo.linha + TIPO.corpo.linha + (obs.length ? 4 + obs.length * TIPO.corpo.linha : 0);
    const alturaPrimeiraFoto = linhasDeFotos.length ? VAO + alturaDaLinha(linhasDeFotos[0]) : 0;

    // A inspeção nunca fica separada da primeira linha de fotos.
    if (y + 24 + alturaTexto + alturaPrimeiraFoto > LIMITE) novaPagina();
    else if (indice > 0) {
      y += 12;
      doc.linha(MARGEM, y, MARGEM + LARGURA, { cor: cores.fio });
      y += 12;
    }

    const etiqueta = etiquetaDoItem(item, cores);
    doc.texto(MARGEM, y + (TAG_ALTURA + TIPO.legenda.tamanho * 0.7) / 2, `${numero}. ${rotuloEtapa(item)}`, { tamanho: TIPO.legenda.tamanho, cor: cores.apoio });
    desenharTag(doc, MARGEM + LARGURA - larguraDaTag(etiqueta), y, etiqueta);
    y += TAG_ALTURA + 4;

    titulo.forEach((linha) => escrever(linha, TIPO.titulo, cores.texto));
    escrever(textoOf(item), TIPO.corpo, cores.apoio);
    if (obs.length) {
      y += 4;
      obs.forEach((linha) => escrever(linha, TIPO.corpo, cores.texto));
    }

    for (const linha of linhasDeFotos) {
      const altura = alturaDaLinha(linha);
      y += VAO;
      if (y + altura > LIMITE) {
        novaPagina();
        escrever(`${numero}. ${nome} (continuação)`, TIPO.legenda, cores.apoio);
        y += VAO;
      }
      let x = MARGEM;
      for (const foto of linha) {
        doc.imagem(foto.indice, x, y, foto.largura, foto.altura, { raio: RAIO_INTERNO });
        x += foto.largura + VAO;
      }
      y += altura;
    }
  });

  /* Rodapé de cada página */
  const total = doc.totalDePaginas;
  for (let i = 0; i < total; i += 1) {
    doc.irParaPagina(i);
    const pagina = `Página ${i + 1} de ${total}`;
    const larguraPagina = larguraTexto(pagina, TIPO.legenda.tamanho);
    const [identificacao] = quebrarLinhas(cabecalho(turno), LARGURA - larguraPagina - 16, TIPO.legenda.tamanho);
    const base = A4.altura - MARGEM;
    doc.texto(MARGEM, base, identificacao || '', { tamanho: TIPO.legenda.tamanho, cor: cores.sutil });
    doc.texto(MARGEM + LARGURA - larguraPagina, base, pagina, { tamanho: TIPO.legenda.tamanho, cor: cores.sutil });
  }

  return { arquivo: new File([doc.gerarBlob()], nomeArquivoPdf(turno), { type: 'application/pdf' }), falhas };
}
