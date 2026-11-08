// Reduz as fotos para guardar e acrescenta a legenda na hora de enviar.

const LADO_MAXIMO = 1920;
const LADO_MINIATURA = 240;
const FONTE = '"Segoe UI", Roboto, system-ui, sans-serif';

async function abrirImagem(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (erro) {
    URL.revokeObjectURL(url);
    throw erro;
  }
  return { img, liberar: () => URL.revokeObjectURL(url) };
}

function paraBlob(canvas, qualidade) {
  return new Promise((resolver, rejeitar) => {
    canvas.toBlob(
      (blob) => (blob ? resolver(blob) : rejeitar(new Error('Falha ao gerar imagem'))),
      'image/jpeg',
      qualidade,
    );
  });
}

function reduzir(img, ladoMaximo) {
  const escala = Math.min(1, ladoMaximo / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function processarFoto(arquivo) {
  const { img, liberar } = await abrirImagem(arquivo);
  try {
    const blob = await paraBlob(reduzir(img, LADO_MAXIMO), 0.85);
    const miniatura = await paraBlob(reduzir(img, LADO_MINIATURA), 0.7);
    return { blob, miniatura };
  } finally {
    liberar();
  }
}

function escreverAjustado(ctx, texto, x, y, larguraMaxima, tamanho, peso) {
  ctx.font = `${peso} ${tamanho}px ${FONTE}`;
  const largura = ctx.measureText(texto).width;
  if (largura > larguraMaxima) {
    const reduzido = Math.max(tamanho * 0.7, tamanho * (larguraMaxima / largura));
    ctx.font = `${peso} ${reduzido}px ${FONTE}`;
  }
  let final = texto;
  while (final.length > 1 && ctx.measureText(final).width > larguraMaxima) {
    final = `${final.slice(0, -2)}…`;
  }
  ctx.fillText(final, x, y);
}

// A faixa fica abaixo da foto, para não cobrir nenhuma indicação.
export async function carimbarFoto(blob, [linha1, linha2], nomeArquivo) {
  const { img, liberar } = await abrirImagem(blob);
  try {
    const largura = img.naturalWidth;
    const altura = img.naturalHeight;
    const tamanho = Math.round(Math.max(26, Math.min(largura, altura) * 0.04));
    const respiro = Math.round(tamanho * 0.6);
    const faixa = Math.round(tamanho * 2.3 + respiro * 2);

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura + faixa;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, altura, largura, faixa);
    ctx.textBaseline = 'top';

    const larguraUtil = largura - respiro * 2;
    ctx.fillStyle = '#ffffff';
    escreverAjustado(ctx, linha1, respiro, altura + respiro, larguraUtil, tamanho, 500);
    ctx.fillStyle = '#c8cfcc';
    escreverAjustado(ctx, linha2, respiro, altura + respiro + tamanho * 1.3, larguraUtil, tamanho * 0.82, 400);

    const final = await paraBlob(canvas, 0.88);
    return new File([final], nomeArquivo, { type: 'image/jpeg' });
  } finally {
    liberar();
  }
}
