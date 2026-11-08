// Reduz as fotos antes de guardar. Reescrever a imagem também remove os metadados, como o GPS.

const LADO_MAXIMO = 1920;
const LADO_MINIATURA = 240;

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
