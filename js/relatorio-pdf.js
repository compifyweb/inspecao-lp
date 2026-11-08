// Layout do relatório em PDF: abertura com os dados do turno e uma moldura por inspeção.
import { A4, DocumentoPdf, dimensoesJpeg, larguraTexto, quebrarLinhas } from './pdf.js';
import { STATUS, cabecalho, dataCompleta, descricaoPeca, nomeArquivoPdf, rotuloEtapa, textoOf, textoStatus } from './relatorio.js';

const MARGEM = 36;
const LARGURA = A4.largura - MARGEM * 2;
const LIMITE = A4.altura - MARGEM - 28;
const RECUO = 12; // O padding de 16px do card, no papel.
const INTERIOR = MARGEM + RECUO;
const LARGURA_INTERNA = LARGURA - RECUO * 2;
const VAO = 8;
const VAO_CARDS = 12;
const VAO_COLUNAS = 16;
const LARGURA_COLUNA = (LARGURA_INTERNA - VAO_COLUNAS * 2) / 3;
const LARGURA_FOTO = (LARGURA_INTERNA - VAO) / 2;
const ALTURA_MAX_FOTO = 214.79; // Três fotos em pé, de 3 por 4, preenchem a linha.
const MAIOR_VAZIO_NA_PAGINA = 300;
const TAG_ALTURA = 20;
const TAG_RECUO = 8;
const RAIO = 8;
const RAIO_INTERNO = 4;

// Escala das telas no celular: 14px na interface equivalem a 10,5pt no papel.
const TIPO = {
  pagina: { tamanho: 18, linha: 25, tracking: -0.01 },
  titulo: { tamanho: 13.5, linha: 19, peso: 500 },
  corpo: { tamanho: 12, linha: 17 },
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
    moldura: ler('--borderColor-control'),
    fio: ler('--tag-neutro-border'),
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
    if (linha.length && usado + VAO + foto.largura > LARGURA_INTERNA) {
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

export async function gerarRelatorioPdf({ turno, itens, fotos, cores }) {
  const doc = new DocumentoPdf({ titulo: `Relatório de inspeção, ${cabecalho(turno)}` });
  const { porItem, falhas } = await registrarFotos(doc, fotos);
  const ordenados = [...itens].sort(porCriacao);
  let y = MARGEM;

  const novaPagina = () => {
    doc.novaPagina();
    y = MARGEM;
  };
  const escrever = (texto, tipo, cor) => {
    doc.texto(INTERIOR, linhaBase(y, tipo), texto, { tamanho: tipo.tamanho, peso: tipo.peso, tracking: tipo.tracking, cor });
    y += tipo.linha;
  };
  const desenharMoldura = (topo, altura) => doc.contorno(MARGEM, topo, LARGURA, altura, { cor: cores.moldura, raio: RAIO });

  /* Abertura */
  novaPagina();
  const campos = [
    ['Empresa', turno.cliente],
    ['Data', dataCompleta(turno.data)],
    ['Equipe', turno.equipe],
  ]
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => ({ rotulo, linhas: quebrarLinhas(valor, LARGURA_COLUNA, TIPO.corpo.tamanho) }));
  const linhasDeValor = Math.max(...campos.map((campo) => campo.linhas.length));
  const alturaAbertura = RECUO * 2 + TIPO.pagina.linha + VAO * 2 + TIPO.legenda.linha + linhasDeValor * TIPO.corpo.linha;
  doc.retangulo(MARGEM, y, LARGURA, alturaAbertura, { cor: cores.faixa, raio: RAIO });
  desenharMoldura(y, alturaAbertura);
  const fimDaAbertura = y + alturaAbertura + VAO_COLUNAS;

  y += RECUO;
  const subtitulo = 'Líquido penetrante';
  doc.texto(INTERIOR + LARGURA_INTERNA - larguraTexto(subtitulo, TIPO.corpo.tamanho), linhaBase(y, TIPO.pagina), subtitulo, { tamanho: TIPO.corpo.tamanho, cor: cores.apoio });
  escrever('Relatório de inspeção', TIPO.pagina, cores.texto);
  y += VAO;
  doc.linha(INTERIOR, y, INTERIOR + LARGURA_INTERNA, { cor: cores.fio });
  y += VAO;
  campos.forEach((campo, coluna) => {
    const x = INTERIOR + coluna * (LARGURA_COLUNA + VAO_COLUNAS);
    doc.texto(x, linhaBase(y, TIPO.legenda), campo.rotulo, { tamanho: TIPO.legenda.tamanho, cor: cores.apoio });
    campo.linhas.forEach((linha, i) => {
      doc.texto(x, linhaBase(y + TIPO.legenda.linha + i * TIPO.corpo.linha, TIPO.corpo), linha, { tamanho: TIPO.corpo.tamanho, cor: cores.texto });
    });
  });
  y = fimDaAbertura;

  /* Inspeções */
  ordenados.forEach((item, indice) => {
    const nome = `${indice + 1}. ${descricaoPeca(item)}`;
    const etiqueta = etiquetaDoItem(item, cores);
    const titulo = quebrarLinhas(nome, LARGURA_INTERNA - larguraDaTag(etiqueta) - RECUO, TIPO.titulo.tamanho);
    const dados = quebrarLinhas(`${rotuloEtapa(item)} · ${textoOf(item)}`, LARGURA_INTERNA, TIPO.corpo.tamanho);
    const obs = item.obs ? quebrarLinhas(`Obs: ${item.obs}`, LARGURA_INTERNA, TIPO.corpo.tamanho) : [];
    const linhasDeFotos = montarLinhasDeFotos(porItem.get(item.id) || []);

    const alturaTexto = titulo.length * TIPO.titulo.linha + dados.length * TIPO.corpo.linha + (obs.length ? VAO + obs.length * TIPO.corpo.linha : 0);
    const alturasDasFotos = linhasDeFotos.map((linha) => VAO + alturaDaLinha(linha));
    const alturaInteira = RECUO * 2 + alturaTexto + alturasDasFotos.reduce((soma, altura) => soma + altura, 0);
    // Inspeção inteira na página seguinte, se isso não deixar um vazio grande nesta.
    // Se a moldura precisar dividir, o texto fica sempre com a primeira linha de fotos.
    const manterInteira = alturaInteira <= LIMITE - MARGEM && LIMITE - y <= MAIOR_VAZIO_NA_PAGINA;
    const alturaMinima = manterInteira ? alturaInteira : RECUO * 2 + alturaTexto + (alturasDasFotos[0] || 0);
    if (y > MARGEM && y + alturaMinima > LIMITE) novaPagina();

    let topoDaMoldura = y;
    const fecharMoldura = () => {
      y += RECUO;
      desenharMoldura(topoDaMoldura, y - topoDaMoldura);
    };
    const garantirEspaco = (altura) => {
      if (y + altura + RECUO <= LIMITE) return;
      fecharMoldura();
      novaPagina();
      topoDaMoldura = y;
      y += RECUO;
      const sufixo = ' (continuação)';
      const [nomeCurto] = quebrarLinhas(nome, LARGURA_INTERNA - larguraTexto(sufixo, TIPO.legenda.tamanho), TIPO.legenda.tamanho);
      escrever(`${nomeCurto}${sufixo}`, TIPO.legenda, cores.apoio);
    };

    y += RECUO;
    desenharTag(doc, INTERIOR + LARGURA_INTERNA - larguraDaTag(etiqueta), y + (TIPO.titulo.linha - TAG_ALTURA) / 2, etiqueta);
    titulo.forEach((linha) => escrever(linha, TIPO.titulo, cores.texto));
    dados.forEach((linha) => escrever(linha, TIPO.corpo, cores.apoio));
    if (obs.length) y += VAO;
    obs.forEach((linha) => {
      garantirEspaco(TIPO.corpo.linha);
      escrever(linha, TIPO.corpo, cores.texto);
    });

    for (const linha of linhasDeFotos) {
      const altura = alturaDaLinha(linha);
      garantirEspaco(VAO + altura);
      y += VAO;
      let x = INTERIOR;
      for (const foto of linha) {
        doc.imagem(foto.indice, x, y, foto.largura, foto.altura, { raio: RAIO_INTERNO });
        x += foto.largura + VAO;
      }
      y += altura;
    }
    fecharMoldura();
    y += VAO_CARDS;
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
